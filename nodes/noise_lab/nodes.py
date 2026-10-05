import math

import torch
import torch.nn.functional as F

from .noise_utils import (
    EPS,
    clamp_like_reference,
    clone_latent_with_samples,
    extract_noise_tensor,
    gaussian_blur_2d,
    gaussian_random,
    generate_noise,
    make_noise_object,
    mask_for_output,
    normalize_mean_std,
    normalize_minmax,
    prepare_mask,
    prepare_noise,
    require_latent_samples,
    restore_latent_stats,
    safe_float_tensor,
    tensor_stats_text,
)
from .preview_utils import diagnostic_image, heatmap_image, image_to_luminance


NOISE_TYPES = ["gaussian", "uniform", "pink", "blue", "high_frequency", "low_frequency"]
BLEND_MODES = ["add", "normalized_add", "lerp", "variance_preserving"]
BATCH_SEED_MODES = ["fixed", "increment", "random"]


def _smooth_threshold(x: torch.Tensor, low: float, high: float) -> torch.Tensor:
    low = float(low)
    high = float(high)
    if high <= low:
        return x.clamp(0.0, 1.0)
    return ((x - low) / max(high - low, EPS)).clamp(0.0, 1.0)


def _morph_mask(mask: torch.Tensor, amount: int) -> torch.Tensor:
    if amount == 0:
        return mask
    kernel = abs(int(amount)) * 2 + 1
    padding = kernel // 2
    if amount > 0:
        return F.max_pool2d(mask, kernel_size=kernel, stride=1, padding=padding)
    return -F.max_pool2d(-mask, kernel_size=kernel, stride=1, padding=padding)


def _sobel_edges(luma: torch.Tensor) -> torch.Tensor:
    work = safe_float_tensor(luma)
    device = work.device
    dtype = work.dtype
    kx = torch.tensor([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], device=device, dtype=dtype).view(1, 1, 3, 3)
    ky = torch.tensor([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], device=device, dtype=dtype).view(1, 1, 3, 3)
    padded = F.pad(work, (1, 1, 1, 1), mode="replicate")
    gx = F.conv2d(padded, kx)
    gy = F.conv2d(padded, ky)
    return torch.sqrt(gx * gx + gy * gy + EPS)


def _local_variance(luma: torch.Tensor, sigma: float = 2.0) -> torch.Tensor:
    work = safe_float_tensor(luma)
    mean = gaussian_blur_2d(work, sigma)
    mean_sq = gaussian_blur_2d(work * work, sigma)
    return (mean_sq - mean * mean).clamp_min(0.0)


def _report_lines(*lines: str) -> str:
    return "\n".join(lines)


class KoOLatentNoiseInjector:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "latent": ("LATENT",),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF}),
                "strength": ("FLOAT", {"default": 0.08, "min": 0.0, "max": 1.0, "step": 0.005}),
                "noise_type": (NOISE_TYPES, {"default": "gaussian"}),
                "blend_mode": (BLEND_MODES, {"default": "variance_preserving"}),
                "preserve_mean": ("BOOLEAN", {"default": True}),
                "preserve_std": ("BOOLEAN", {"default": True}),
                "clamp_output": ("BOOLEAN", {"default": False}),
                "normalize_noise": ("BOOLEAN", {"default": True}),
                "noise_scale": ("FLOAT", {"default": 1.0, "min": 0.01, "max": 4.0, "step": 0.01}),
                "mask_blur": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 64.0, "step": 0.25}),
                "invert_mask": ("BOOLEAN", {"default": False}),
                "batch_seed_mode": (BATCH_SEED_MODES, {"default": "fixed"}),
            },
            "optional": {
                "noise": ("NOISE",),
                "mask": ("MASK",),
            },
        }

    RETURN_TYPES = ("LATENT", "NOISE", "MASK", "STRING")
    RETURN_NAMES = ("latent", "injected_noise", "noise_mask", "report")
    FUNCTION = "inject"
    CATEGORY = "KoO/Noise Lab"

    def inject(
        self,
        latent,
        seed,
        strength,
        noise_type,
        blend_mode,
        preserve_mean,
        preserve_std,
        clamp_output,
        normalize_noise,
        noise_scale,
        mask_blur,
        invert_mask,
        batch_seed_mode,
        noise=None,
        mask=None,
    ):
        with torch.no_grad():
            samples = require_latent_samples(latent)
            incoming_noise = extract_noise_tensor(noise, latent, samples)
            if incoming_noise is None:
                noise_tensor = generate_noise(samples, seed, noise_type, batch_seed_mode)
                source = f"generated {noise_type}"
            else:
                noise_tensor = prepare_noise(incoming_noise, samples)
                source = "input NOISE"

            if normalize_noise:
                noise_tensor = normalize_mean_std(noise_tensor)
            noise_tensor = noise_tensor * float(noise_scale)

            mask_4d = prepare_mask(mask, samples, mask_blur=mask_blur, invert=invert_mask)
            strength = float(strength)

            if blend_mode == "add" or blend_mode == "normalized_add":
                blended = samples + strength * noise_tensor
            elif blend_mode == "lerp":
                blended = samples * (1.0 - strength) + noise_tensor * strength
            elif blend_mode == "variance_preserving":
                latent_weight = math.sqrt(max(0.0, 1.0 - strength * strength))
                blended = samples * latent_weight + noise_tensor * strength
            else:
                raise ValueError(f"Unknown blend_mode: {blend_mode}")

            if preserve_mean or preserve_std:
                blended = restore_latent_stats(blended, samples, bool(preserve_mean), bool(preserve_std))

            output_samples = samples * (1.0 - mask_4d) + blended * mask_4d
            injected_noise = output_samples - samples

            if clamp_output:
                clamped = clamp_like_reference(output_samples, samples)
                output_samples = samples * (1.0 - mask_4d) + clamped * mask_4d
                injected_noise = output_samples - samples

            out_latent = clone_latent_with_samples(latent, output_samples)
            out_noise = make_noise_object(injected_noise, kind="injected_noise", source=source, seed=int(seed), strength=strength)
            out_mask = mask_for_output(mask_4d)

            report = _report_lines(
                "KoO Latent Noise Injector",
                f"source={source}, blend_mode={blend_mode}, strength={strength:.6f}, noise_scale={float(noise_scale):.6f}",
                f"normalize_noise={bool(normalize_noise)}, preserve_mean={bool(preserve_mean)}, preserve_std={bool(preserve_std)}, clamp_output={bool(clamp_output)}",
                f"mask mean coverage={mask_4d.mean().item() * 100.0:.2f}%, mask_blur={float(mask_blur):.3f}, invert_mask={bool(invert_mask)}",
                tensor_stats_text("latent_before", samples),
                tensor_stats_text("latent_after", output_samples),
                tensor_stats_text("injected_noise", injected_noise),
            )
            return (out_latent, out_noise, out_mask, report)


class KoONoiseMaskBuilder:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "mode": (["edges", "local_variance", "high_frequency", "combined"], {"default": "combined"}),
                "edge_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 4.0, "step": 0.05}),
                "texture_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 4.0, "step": 0.05}),
                "flat_surface_suppression": ("FLOAT", {"default": 0.75, "min": 0.0, "max": 1.0, "step": 0.01}),
                "threshold_low": ("FLOAT", {"default": 0.05, "min": 0.0, "max": 1.0, "step": 0.01}),
                "threshold_high": ("FLOAT", {"default": 0.95, "min": 0.0, "max": 1.0, "step": 0.01}),
                "blur_radius": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 64.0, "step": 0.25}),
                "expand_mask": ("INT", {"default": 0, "min": -64, "max": 64}),
                "gamma": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 4.0, "step": 0.05}),
                "invert": ("BOOLEAN", {"default": False}),
                "normalize": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("MASK", "MASK", "MASK", "MASK", "STRING")
    RETURN_NAMES = ("mask", "edge_map", "texture_map", "flat_map", "report")
    FUNCTION = "build"
    CATEGORY = "KoO/Noise Lab"

    def build(
        self,
        image,
        mode,
        edge_strength,
        texture_strength,
        flat_surface_suppression,
        threshold_low,
        threshold_high,
        blur_radius,
        expand_mask,
        gamma,
        invert,
        normalize,
    ):
        with torch.no_grad():
            luma = image_to_luminance(image)
            edge = _sobel_edges(luma)
            variance = _local_variance(luma, sigma=2.0)
            highpass = (luma - gaussian_blur_2d(luma, 2.0)).abs()

            edge_map = normalize_minmax(edge, dims=(1, 2, 3))
            variance_map = normalize_minmax(variance, dims=(1, 2, 3))
            highpass_map = normalize_minmax(highpass, dims=(1, 2, 3))

            if mode == "edges":
                texture_map = variance_map
                detail = float(edge_strength) * edge_map
            elif mode == "local_variance":
                texture_map = variance_map
                detail = float(texture_strength) * variance_map
            elif mode == "high_frequency":
                texture_map = highpass_map
                detail = float(texture_strength) * highpass_map
            elif mode == "combined":
                texture_map = (variance_map + highpass_map) * 0.5
                detail = float(edge_strength) * edge_map + float(texture_strength) * texture_map
            else:
                raise ValueError(f"Unknown mask mode: {mode}")

            if normalize:
                detail_map = normalize_minmax(detail, dims=(1, 2, 3))
            else:
                detail_map = detail.clamp(0.0, 1.0)

            flat_raw = (1.0 - edge_map.clamp(0.0, 1.0)) * (1.0 - texture_map.clamp(0.0, 1.0))
            flat_map = normalize_minmax(flat_raw, dims=(1, 2, 3)) if normalize else flat_raw.clamp(0.0, 1.0)

            mask = detail_map * (1.0 - float(flat_surface_suppression) * flat_map)
            mask = _smooth_threshold(mask, threshold_low, threshold_high)
            mask = mask.clamp(0.0, 1.0).pow(float(gamma))
            if float(blur_radius) > 0.0:
                mask = gaussian_blur_2d(mask, float(blur_radius)).clamp(0.0, 1.0)
            mask = _morph_mask(mask, int(expand_mask)).clamp(0.0, 1.0)
            if invert:
                mask = 1.0 - mask

            report = _report_lines(
                "KoO Noise Mask Builder",
                f"mode={mode}, edge_strength={float(edge_strength):.3f}, texture_strength={float(texture_strength):.3f}",
                f"flat_surface_suppression={float(flat_surface_suppression):.3f}, threshold=[{float(threshold_low):.3f}, {float(threshold_high):.3f}]",
                f"blur_radius={float(blur_radius):.3f}, expand_mask={int(expand_mask)}, gamma={float(gamma):.3f}, invert={bool(invert)}, normalize={bool(normalize)}",
                f"mask mean={mask.mean().item():.6f}, edge mean={edge_map.mean().item():.6f}, texture mean={texture_map.mean().item():.6f}, flat mean={flat_map.mean().item():.6f}",
                "This mask is frequency-based only. It does not perform semantic material detection.",
            )
            return (mask[:, 0], edge_map[:, 0], texture_map[:, 0], flat_map[:, 0], report)


class KoONoisePreview:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "noise": ("NOISE",),
                "preview_mode": (["noise_only", "masked_noise", "latent_before", "latent_after_estimate", "difference_heatmap"], {"default": "noise_only"}),
                "channel_mode": (["first", "average", "maximum", "rgb_projection"], {"default": "average"}),
                "contrast": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.1}),
                "normalize": ("BOOLEAN", {"default": True}),
                "signed_visualization": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "latent": ("LATENT",),
                "mask": ("MASK",),
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("image", "report")
    FUNCTION = "preview"
    CATEGORY = "KoO/Noise Lab"

    def preview(self, noise, preview_mode, channel_mode, contrast, normalize, signed_visualization, latent=None, mask=None):
        with torch.no_grad():
            if latent is not None:
                samples = require_latent_samples(latent)
            else:
                samples = None

            fallback_latent = latent if latent is not None else {"samples": torch.empty(0)}
            noise_tensor = extract_noise_tensor(noise, fallback_latent, samples if samples is not None else torch.empty(0))
            if noise_tensor is None:
                raise ValueError("Noise Preview requires a NOISE input containing tensor data.")
            if samples is not None:
                noise_tensor = prepare_noise(noise_tensor, samples)

            if preview_mode == "latent_before":
                if samples is None:
                    raise ValueError("latent_before preview requires the optional LATENT input.")
                source = samples
                image = diagnostic_image(source, channel_mode, contrast, normalize, signed_visualization)
            elif preview_mode == "latent_after_estimate":
                if samples is None:
                    raise ValueError("latent_after_estimate preview requires the optional LATENT input.")
                mask_4d = prepare_mask(mask, samples) if mask is not None else torch.ones((samples.shape[0], 1, samples.shape[2], samples.shape[3]), device=samples.device, dtype=samples.dtype)
                source = samples + noise_tensor * mask_4d
                image = diagnostic_image(source, channel_mode, contrast, normalize, signed_visualization)
            elif preview_mode == "masked_noise":
                if samples is None:
                    if noise_tensor.ndim != 4:
                        raise ValueError("masked_noise without LATENT requires noise shaped [B, C, H, W].")
                    mask_4d = prepare_mask(mask, noise_tensor) if mask is not None else torch.ones((noise_tensor.shape[0], 1, noise_tensor.shape[2], noise_tensor.shape[3]), device=noise_tensor.device, dtype=noise_tensor.dtype)
                else:
                    mask_4d = prepare_mask(mask, samples)
                source = noise_tensor * mask_4d
                image = diagnostic_image(source, channel_mode, contrast, normalize, signed_visualization)
            elif preview_mode == "difference_heatmap":
                source = noise_tensor
                if samples is not None and mask is not None:
                    source = source * prepare_mask(mask, samples)
                image = heatmap_image(source, channel_mode, contrast, normalize)
            elif preview_mode == "noise_only":
                source = noise_tensor
                image = diagnostic_image(source, channel_mode, contrast, normalize, signed_visualization)
            else:
                raise ValueError(f"Unknown preview_mode: {preview_mode}")

            report = _report_lines(
                "KoO Noise Preview",
                f"preview_mode={preview_mode}, channel_mode={channel_mode}, contrast={float(contrast):.3f}, normalize={bool(normalize)}, signed_visualization={bool(signed_visualization)}",
                "Preview is a diagnostic visualization of latent/noise tensors, not a VAE decode.",
                tensor_stats_text("preview_source", source),
            )
            return (image, report)


class KoOFrequencyNoiseMixer:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "latent": ("LATENT",),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF}),
                "low_frequency": ("FLOAT", {"default": 0.05, "min": 0.0, "max": 2.0, "step": 0.01}),
                "mid_frequency": ("FLOAT", {"default": 0.3, "min": 0.0, "max": 2.0, "step": 0.01}),
                "high_frequency": ("FLOAT", {"default": 0.6, "min": 0.0, "max": 2.0, "step": 0.01}),
                "very_high_frequency": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 2.0, "step": 0.01}),
                "frequency_balance": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 4.0, "step": 0.05}),
                "normalize_output": ("BOOLEAN", {"default": True}),
                "batch_seed_mode": (BATCH_SEED_MODES, {"default": "fixed"}),
            }
        }

    RETURN_TYPES = ("NOISE", "IMAGE", "IMAGE", "IMAGE", "IMAGE", "STRING")
    RETURN_NAMES = ("noise", "low_band_preview", "mid_band_preview", "high_band_preview", "combined_preview", "report")
    FUNCTION = "mix"
    CATEGORY = "KoO/Noise Lab"

    def mix(
        self,
        latent,
        seed,
        low_frequency,
        mid_frequency,
        high_frequency,
        very_high_frequency,
        frequency_balance,
        normalize_output,
        batch_seed_mode,
    ):
        with torch.no_grad():
            samples = require_latent_samples(latent)
            base = gaussian_random(tuple(samples.shape), seed, samples.device, samples.dtype, batch_seed_mode)
            balance = float(frequency_balance)
            large_sigma = max(0.5, 8.0 * balance)
            small_sigma = max(0.25, 2.0 * balance)
            tiny_sigma = max(0.10, 0.75 * balance)

            low = gaussian_blur_2d(base, large_sigma)
            mid = gaussian_blur_2d(base, small_sigma) - low
            high = base - gaussian_blur_2d(base, small_sigma)
            very_high = base - gaussian_blur_2d(base, tiny_sigma)

            combined = (
                float(low_frequency) * low
                + float(mid_frequency) * mid
                + float(high_frequency) * high
                + float(very_high_frequency) * very_high
            )
            if normalize_output:
                combined = normalize_mean_std(combined)

            noise = make_noise_object(
                combined,
                kind="frequency_mixed_noise",
                seed=int(seed),
                low_frequency=float(low_frequency),
                mid_frequency=float(mid_frequency),
                high_frequency=float(high_frequency),
                very_high_frequency=float(very_high_frequency),
                frequency_balance=balance,
            )

            report = _report_lines(
                "KoO Frequency Noise Mixer",
                f"weights: low={float(low_frequency):.3f}, mid={float(mid_frequency):.3f}, high={float(high_frequency):.3f}, very_high={float(very_high_frequency):.3f}",
                f"frequency_balance={balance:.3f}, sigmas: large={large_sigma:.3f}, small={small_sigma:.3f}, tiny={tiny_sigma:.3f}",
                f"normalize_output={bool(normalize_output)}, seed={int(seed)}, batch_seed_mode={batch_seed_mode}",
                tensor_stats_text("combined_noise", combined),
            )
            return (
                noise,
                diagnostic_image(low, "average", 1.0, True, True),
                diagnostic_image(mid, "average", 1.0, True, True),
                diagnostic_image(high, "average", 1.0, True, True),
                diagnostic_image(combined, "average", 1.0, True, True),
                report,
            )


class KoONoiseStatistics:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "latent_before": ("LATENT",),
                "latent_after": ("LATENT",),
            },
            "optional": {
                "noise": ("NOISE",),
                "mask": ("MASK",),
            },
        }

    RETURN_TYPES = ("STRING", "FLOAT", "FLOAT", "FLOAT", "FLOAT", "FLOAT", "FLOAT")
    RETURN_NAMES = (
        "report",
        "mean_absolute_difference",
        "root_mean_square_difference",
        "latent_std_before",
        "latent_std_after",
        "effective_noise_strength",
        "masked_area_ratio",
    )
    FUNCTION = "measure"
    CATEGORY = "KoO/Noise Lab"

    def measure(self, latent_before, latent_after, noise=None, mask=None):
        with torch.no_grad():
            before = require_latent_samples(latent_before)
            after = require_latent_samples(latent_after)
            if before.shape != after.shape:
                raise ValueError(f"latent_before shape {tuple(before.shape)} must match latent_after shape {tuple(after.shape)}.")

            diff = safe_float_tensor(after - before)
            before_f = safe_float_tensor(before)
            after_f = safe_float_tensor(after)
            mad = diff.abs().mean().item()
            rms = torch.sqrt((diff * diff).mean().clamp_min(EPS)).item()
            std_before = before_f.std(unbiased=False).item()
            std_after = after_f.std(unbiased=False).item()
            effective = rms / max(std_before, EPS)

            if mask is None:
                mask_ratio = 1.0
                mask_line = "mask coverage=100.00% (no mask supplied)"
            else:
                mask_4d = prepare_mask(mask, before)
                mask_ratio = mask_4d.mean().item()
                mask_line = f"mask coverage={mask_ratio * 100.0:.2f}%"

            noise_line = "noise input not supplied"
            if noise is not None:
                noise_tensor = extract_noise_tensor(noise, latent_before, before)
                if noise_tensor is not None:
                    noise_tensor = prepare_noise(noise_tensor, before)
                    noise_rms = torch.sqrt((safe_float_tensor(noise_tensor) ** 2).mean().clamp_min(EPS)).item()
                    noise_line = f"noise RMS={noise_rms:.6f}, diff/noise RMS={rms / max(noise_rms, EPS):.6f}"

            report = _report_lines(
                "KoO Noise Statistics",
                f"latent shape={tuple(before.shape)}",
                f"before: mean={before_f.mean().item():.6f}, std={std_before:.6f}, min={before_f.min().item():.6f}, max={before_f.max().item():.6f}",
                f"after: mean={after_f.mean().item():.6f}, std={std_after:.6f}, min={after_f.min().item():.6f}, max={after_f.max().item():.6f}",
                f"mean absolute difference={mad:.6f}",
                f"root mean square difference={rms:.6f}",
                f"effective noise strength={effective:.6f} (RMS difference divided by latent_before std)",
                mask_line,
                noise_line,
            )
            return (report, float(mad), float(rms), float(std_before), float(std_after), float(effective), float(mask_ratio))


NODE_CLASS_MAPPINGS = {
    "KoOLatentNoiseInjector": KoOLatentNoiseInjector,
    "KoONoiseMaskBuilder": KoONoiseMaskBuilder,
    "KoONoisePreview": KoONoisePreview,
    "KoOFrequencyNoiseMixer": KoOFrequencyNoiseMixer,
    "KoONoiseStatistics": KoONoiseStatistics,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KoOLatentNoiseInjector": "KoO Latent Noise Injector",
    "KoONoiseMaskBuilder": "KoO Noise Mask Builder",
    "KoONoisePreview": "KoO Noise Preview",
    "KoOFrequencyNoiseMixer": "KoO Frequency Noise Mixer",
    "KoONoiseStatistics": "KoO Noise Statistics",
}
