from __future__ import annotations

import math
from typing import Iterable, Sequence

import torch

import comfy.sample


BAND_NAMES = ("Structure", "Shapes", "Texture", "Detail", "Microdetail")

PRESET_GAINS_DB = {
    "Neutral": (0.0, 0.0, 0.0, 0.0, 0.0),
    "Natural Detail": (0.0, 0.0, 1.0, 3.0, 2.0),
    "Archviz Materials": (0.0, 0.5, 3.0, 5.0, 2.0),
    "Aggressive Microdetail": (-1.0, 0.0, 4.0, 7.0, 5.0),
}

SPECTRAL_CENTERS = (0.04, 0.15, 0.34, 0.60, 0.86)
SPECTRAL_WIDTHS = (0.070, 0.120, 0.160, 0.180, 0.160)

SIGMA_CENTERS = (0.06, 0.27, 0.52, 0.76, 0.93)
SIGMA_WIDTHS = (0.100, 0.150, 0.170, 0.140, 0.100)

GAIN_MIN_DB = -12.0
GAIN_MAX_DB = 12.0
EPS = 1.0e-8
_NESTED_WARNING_PRINTED = False


def clamp_db(value: float) -> float:
    """Clamp a gain value to the supported dB range."""
    return max(GAIN_MIN_DB, min(GAIN_MAX_DB, float(value)))


def effective_gains_db(preset: str, trims_db: Sequence[float]) -> tuple[float, float, float, float, float]:
    """Combine preset baseline gains with manual trim gains."""
    baseline = PRESET_GAINS_DB.get(str(preset), PRESET_GAINS_DB["Neutral"])
    return tuple(clamp_db(base + float(trim)) for base, trim in zip(baseline, trims_db))


def gains_are_neutral(gains_db: Sequence[float], tolerance: float = 1.0e-6) -> bool:
    """Return True when every band gain is effectively 0 dB."""
    return all(abs(float(gain)) <= tolerance for gain in gains_db)


def db_to_amplitude(gains_db: Sequence[float], *, device=None, dtype=torch.float32) -> torch.Tensor:
    """Convert dB gains to linear amplitude multipliers."""
    values = [10.0 ** (float(gain) / 20.0) for gain in gains_db]
    return torch.tensor(values, device=device, dtype=dtype)


def gaussian_windows(coord: torch.Tensor, centers: Sequence[float], widths: Sequence[float]) -> torch.Tensor:
    """Build normalized overlapping Gaussian windows over a 0-1 coordinate."""
    center_tensor = torch.tensor(centers, device=coord.device, dtype=coord.dtype)
    width_tensor = torch.tensor(widths, device=coord.device, dtype=coord.dtype).clamp_min(EPS)
    view_shape = (len(centers),) + (1,) * coord.ndim
    deltas = (coord.unsqueeze(0) - center_tensor.reshape(view_shape)) / width_tensor.reshape(view_shape)
    windows = torch.exp(-0.5 * deltas.square())
    return windows / windows.sum(dim=0, keepdim=True).clamp_min(EPS)


def radial_frequency_grid(height: int, width: int, *, device=None, dtype=torch.float32) -> torch.Tensor:
    """Create a normalized radial FFT frequency grid for rfft2 output."""
    fy = torch.fft.fftfreq(height, device=device, dtype=dtype)
    fx = torch.fft.rfftfreq(width, device=device, dtype=dtype)
    radius = torch.sqrt(fy[:, None].square() + fx[None, :].square())
    return (radius / math.sqrt(0.5)).clamp(0.0, 1.0)


def spectral_filter_curve(height: int, width: int, gains_db: Sequence[float], *, device=None) -> torch.Tensor:
    """Build the five-band spectral EQ curve for rfft2 frequencies."""
    radius = radial_frequency_grid(height, width, device=device, dtype=torch.float32)
    windows = gaussian_windows(radius, SPECTRAL_CENTERS, SPECTRAL_WIDTHS)
    amplitudes = db_to_amplitude(gains_db, device=device, dtype=torch.float32)
    return (windows * amplitudes[:, None, None]).sum(dim=0)


def rms_per_batch(tensor: torch.Tensor) -> torch.Tensor:
    """Compute RMS independently for each batch sample."""
    if tensor.ndim <= 1:
        return tensor.float().square().mean().sqrt().reshape(1)
    dims = tuple(range(1, tensor.ndim))
    return tensor.float().square().mean(dim=dims, keepdim=True).sqrt()


def apply_spectral_eq(
    noise: torch.Tensor,
    gains_db: Sequence[float],
    spectral_mix: float,
    master_intensity: float,
    normalize_noise: bool,
) -> torch.Tensor:
    """Apply five-band spatial-frequency EQ to the last two tensor dimensions."""
    if noise.ndim < 4:
        return noise

    effective_mix = float(spectral_mix) * float(master_intensity)
    if effective_mix <= 0.0 or gains_are_neutral(gains_db):
        return noise

    original_dtype = noise.dtype
    original_device = noise.device
    working = noise.to(device=original_device, dtype=torch.float32)
    original_rms = rms_per_batch(working)

    height = int(working.shape[-2])
    width = int(working.shape[-1])
    if height < 2 or width < 2:
        return noise

    spectrum = torch.fft.rfft2(working, dim=(-2, -1), norm="ortho")
    eq_curve = spectral_filter_curve(height, width, gains_db, device=original_device)
    final_filter = 1.0 + effective_mix * (eq_curve - 1.0)
    final_filter[0, 0] = 1.0

    filtered = torch.fft.irfft2(spectrum * final_filter, s=(height, width), dim=(-2, -1), norm="ortho")
    filtered = torch.nan_to_num(filtered, nan=0.0, posinf=0.0, neginf=0.0)

    if normalize_noise:
        filtered_rms = rms_per_batch(filtered)
        filtered = filtered * (original_rms / filtered_rms.clamp_min(EPS))

    filtered = torch.nan_to_num(filtered, nan=0.0, posinf=0.0, neginf=0.0)
    return filtered.to(device=original_device, dtype=original_dtype)


def _interp_1d(x: torch.Tensor, xp: torch.Tensor, fp: torch.Tensor) -> torch.Tensor:
    """Linearly interpolate fp sampled at ascending xp for query coordinates x."""
    x = x.clamp(float(xp[0]), float(xp[-1]))
    indices = torch.searchsorted(xp, x, right=False)
    indices = indices.clamp(1, xp.numel() - 1)
    x0 = xp[indices - 1]
    x1 = xp[indices]
    y0 = fp[indices - 1]
    y1 = fp[indices]
    weight = (x - x0) / (x1 - x0).clamp_min(EPS)
    return y0 + weight * (y1 - y0)


def _terminal_zero_count(sigmas: torch.Tensor) -> int:
    """Count contiguous non-positive terminal sigma entries."""
    count = 0
    for value in reversed(sigmas.detach().cpu().flatten().tolist()):
        if float(value) <= 0.0:
            count += 1
        else:
            break
    return count


def redistribute_sigmas(
    reference_sigmas: torch.Tensor,
    gains_db: Sequence[float],
    sigma_mix: float,
    master_intensity: float,
    bypass: bool = False,
) -> torch.Tensor:
    """Redistribute existing sigma samples by density in log-sigma progress space."""
    if bypass or float(sigma_mix) <= 0.0 or float(master_intensity) <= 0.0 or gains_are_neutral(gains_db):
        return reference_sigmas
    if not isinstance(reference_sigmas, torch.Tensor) or reference_sigmas.ndim != 1 or reference_sigmas.numel() < 3:
        return reference_sigmas

    terminal_count = _terminal_zero_count(reference_sigmas)
    positive_count = reference_sigmas.numel() - terminal_count
    if positive_count < 3:
        return reference_sigmas

    positive_sigmas = reference_sigmas[:positive_count]
    if torch.any(positive_sigmas <= 0.0) or not torch.all(positive_sigmas[:-1] >= positive_sigmas[1:]):
        return reference_sigmas

    device = reference_sigmas.device
    work = positive_sigmas.to(dtype=torch.float32)
    if not torch.all(torch.isfinite(work)):
        return reference_sigmas

    log_sigmas = torch.log(work.clamp_min(EPS))
    log_hi = log_sigmas[0]
    log_lo = log_sigmas[-1]
    span = (log_hi - log_lo).abs()
    if float(span) <= EPS:
        return reference_sigmas

    n = positive_count
    u_original = torch.linspace(0.0, 1.0, n, device=device, dtype=torch.float32)
    grid_count = max(257, n * 8)
    u_grid = torch.linspace(0.0, 1.0, grid_count, device=device, dtype=torch.float32)
    log_grid = _interp_1d(u_grid, u_original, log_sigmas)
    progress = ((log_hi - log_grid) / (log_hi - log_lo).clamp_min(EPS)).clamp(0.0, 1.0)

    windows = gaussian_windows(progress, SIGMA_CENTERS, SIGMA_WIDTHS)
    amplitudes = db_to_amplitude(gains_db, device=device, dtype=torch.float32)
    density_mod = (windows * amplitudes[:, None]).sum(dim=0).clamp(0.25, 4.0)
    effective_mix = max(0.0, min(1.0, float(sigma_mix) * float(master_intensity)))
    density = (1.0 - effective_mix) + effective_mix * density_mod
    density = torch.nan_to_num(density, nan=1.0, posinf=1.0, neginf=1.0).clamp(0.25, 4.0)

    increments = 0.5 * (density[1:] + density[:-1]) * (u_grid[1:] - u_grid[:-1])
    cumulative = torch.cat([torch.zeros(1, device=device), torch.cumsum(increments, dim=0)])
    total = cumulative[-1]
    if not torch.isfinite(total) or float(total) <= EPS:
        return reference_sigmas
    cumulative = cumulative / total

    quantiles = torch.linspace(0.0, 1.0, n, device=device, dtype=torch.float32)
    source_u = _interp_1d(quantiles, cumulative, u_grid)
    new_log_sigmas = _interp_1d(source_u, u_original, log_sigmas)
    new_positive = torch.exp(new_log_sigmas).to(dtype=reference_sigmas.dtype)
    new_positive[0] = positive_sigmas[0]
    new_positive[-1] = positive_sigmas[-1]

    if terminal_count:
        result = torch.cat([new_positive, reference_sigmas[positive_count:]])
    else:
        result = new_positive

    if result.numel() != reference_sigmas.numel():
        return reference_sigmas
    if not torch.all(torch.isfinite(result)):
        return reference_sigmas
    if not torch.all(result[:-1] >= result[1:]):
        return reference_sigmas
    return result.to(device=reference_sigmas.device, dtype=reference_sigmas.dtype)


class KoOSpectralNoise:
    def __init__(
        self,
        seed: int,
        gains_db: Sequence[float],
        master_intensity: float,
        spectral_mix: float,
        normalize_noise: bool,
        bypass: bool,
    ) -> None:
        self.seed = int(seed)
        self.gains_db = tuple(float(gain) for gain in gains_db)
        self.master_intensity = float(master_intensity)
        self.spectral_mix = float(spectral_mix)
        self.normalize_noise = bool(normalize_noise)
        self.bypass = bool(bypass)

    def generate_noise(self, input_latent):
        latent_samples = input_latent["samples"]
        batch_indices = input_latent["batch_index"] if "batch_index" in input_latent else None
        base_noise = comfy.sample.prepare_noise(latent_samples, self.seed, batch_indices)

        if (
            self.bypass
            or self.spectral_mix <= 0.0
            or self.master_intensity <= 0.0
            or gains_are_neutral(self.gains_db)
        ):
            return base_noise

        if getattr(base_noise, "is_nested", False):
            global _NESTED_WARNING_PRINTED
            if not _NESTED_WARNING_PRINTED:
                print("KoO Diffusion EQ [Experimental]: nested latent noise detected; using standard ComfyUI noise.")
                _NESTED_WARNING_PRINTED = True
            return base_noise

        return apply_spectral_eq(
            base_noise,
            self.gains_db,
            self.spectral_mix,
            self.master_intensity,
            self.normalize_noise,
        )


def configuration_report(
    preset: str,
    gains_db: Sequence[float],
    master_intensity: float,
    spectral_mix: float,
    sigma_mix: float,
    normalize_noise: bool,
    bypass: bool,
    input_sigma_count: int,
    output_sigma_count: int,
) -> str:
    """Create the user-visible multiline configuration summary."""
    gain_text = ", ".join(f"{name}: {gain:+.1f} dB" for name, gain in zip(BAND_NAMES, gains_db))
    return "\n".join(
        [
            "KoO Diffusion EQ [Experimental]",
            f"Preset: {preset}",
            f"Effective gains: {gain_text}",
            f"Master intensity: {float(master_intensity):.2f}",
            f"Spectral mix: {float(spectral_mix):.2f}",
            f"Sigma mix: {float(sigma_mix):.2f}",
            f"Normalize noise: {bool(normalize_noise)}",
            f"Bypass: {bool(bypass)}",
            f"Sigmas: input {int(input_sigma_count)}, output {int(output_sigma_count)}",
            "Experimental: latent frequency bands are not identical to RGB pixel frequencies.",
        ]
    )


class KoODiffusionEQ:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "reference_sigmas": ("SIGMAS",),
                "preset": (tuple(PRESET_GAINS_DB.keys()), {"default": "Neutral"}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff, "control_after_generate": True}),
                "structure_db": ("FLOAT", {"default": 0.0, "min": -12.0, "max": 12.0, "step": 0.5}),
                "shapes_db": ("FLOAT", {"default": 0.0, "min": -12.0, "max": 12.0, "step": 0.5}),
                "texture_db": ("FLOAT", {"default": 0.0, "min": -12.0, "max": 12.0, "step": 0.5}),
                "detail_db": ("FLOAT", {"default": 0.0, "min": -12.0, "max": 12.0, "step": 0.5}),
                "microdetail_db": ("FLOAT", {"default": 0.0, "min": -12.0, "max": 12.0, "step": 0.5}),
                "master_intensity": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01}),
                "spectral_mix": ("FLOAT", {"default": 0.65, "min": 0.0, "max": 1.0, "step": 0.01}),
                "sigma_mix": ("FLOAT", {"default": 0.40, "min": 0.0, "max": 1.0, "step": 0.01}),
                "normalize_noise": ("BOOLEAN", {"default": True}),
                "bypass": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ("NOISE", "SIGMAS", "STRING")
    RETURN_NAMES = ("eq_noise", "eq_sigmas", "configuration_report")
    FUNCTION = "build_eq"
    CATEGORY = "KoO Tools / Sampling"
    DESCRIPTION = "Experimental five-band EQ for generated diffusion noise and reference sigma sample density."
    SEARCH_ALIASES = ["koo diffusion eq", "noise eq", "sigma eq", "spectral noise"]

    def build_eq(
        self,
        reference_sigmas,
        preset="Neutral",
        seed=0,
        structure_db=0.0,
        shapes_db=0.0,
        texture_db=0.0,
        detail_db=0.0,
        microdetail_db=0.0,
        master_intensity=0.5,
        spectral_mix=0.65,
        sigma_mix=0.40,
        normalize_noise=True,
        bypass=False,
    ):
        trims = (structure_db, shapes_db, texture_db, detail_db, microdetail_db)
        gains_db = effective_gains_db(preset, trims)
        noise = KoOSpectralNoise(seed, gains_db, master_intensity, spectral_mix, normalize_noise, bypass)
        eq_sigmas = redistribute_sigmas(reference_sigmas, gains_db, sigma_mix, master_intensity, bypass)
        report = configuration_report(
            preset,
            gains_db,
            master_intensity,
            spectral_mix,
            sigma_mix,
            normalize_noise,
            bypass,
            int(reference_sigmas.numel()) if isinstance(reference_sigmas, torch.Tensor) else 0,
            int(eq_sigmas.numel()) if isinstance(eq_sigmas, torch.Tensor) else 0,
        )
        return (noise, eq_sigmas, report)

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True


NODE_CLASS_MAPPINGS = {
    "KoODiffusionEQ": KoODiffusionEQ,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KoODiffusionEQ": "KoO Diffusion EQ [Experimental]",
}
