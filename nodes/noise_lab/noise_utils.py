import math
from typing import Any, Dict, Optional, Tuple

import torch
import torch.nn.functional as F


EPS = 1e-6


def require_latent_samples(latent: Dict[str, Any]) -> torch.Tensor:
    if not isinstance(latent, dict) or "samples" not in latent:
        raise ValueError("Expected a ComfyUI LATENT dictionary containing a 'samples' tensor.")
    samples = latent["samples"]
    if not isinstance(samples, torch.Tensor) or samples.ndim != 4:
        raise ValueError("latent['samples'] must be a 4D tensor shaped [batch, channels, height, width].")
    return samples


def clone_latent_with_samples(latent: Dict[str, Any], samples: torch.Tensor) -> Dict[str, Any]:
    out = dict(latent)
    out["samples"] = samples
    return out


def safe_float_tensor(x: torch.Tensor) -> torch.Tensor:
    if x.dtype in (torch.float16, torch.bfloat16):
        return x.float()
    return x


def generator_for_seed(seed: int, device: torch.device) -> torch.Generator:
    try:
        gen = torch.Generator(device=device)
    except (TypeError, RuntimeError):
        gen = torch.Generator()
    gen.manual_seed(int(seed) & 0xFFFFFFFFFFFFFFFF)
    return gen


def _derived_batch_seeds(seed: int, batch: int, mode: str) -> Optional[torch.Tensor]:
    if mode == "fixed":
        return None
    if mode == "increment":
        return torch.tensor([(int(seed) + i) & 0xFFFFFFFFFFFFFFFF for i in range(batch)], dtype=torch.long)
    if mode == "random":
        gen = torch.Generator()
        gen.manual_seed(int(seed) & 0xFFFFFFFFFFFFFFFF)
        return torch.randint(0, 2**31 - 1, (batch,), generator=gen, dtype=torch.long)
    raise ValueError(f"Unknown batch_seed_mode: {mode}")


def gaussian_random(
    shape: Tuple[int, int, int, int],
    seed: int,
    device: torch.device,
    dtype: torch.dtype,
    batch_seed_mode: str = "fixed",
) -> torch.Tensor:
    batch = shape[0]
    batch_seeds = _derived_batch_seeds(seed, batch, batch_seed_mode)
    if batch_seeds is None:
        gen = generator_for_seed(seed, device)
        return torch.randn(shape, generator=gen, device=device, dtype=dtype)

    chunks = []
    for i, batch_seed in enumerate(batch_seeds.tolist()):
        gen = generator_for_seed(int(batch_seed), device)
        chunks.append(torch.randn((1, shape[1], shape[2], shape[3]), generator=gen, device=device, dtype=dtype))
    return torch.cat(chunks, dim=0)


def uniform_random(
    shape: Tuple[int, int, int, int],
    seed: int,
    device: torch.device,
    dtype: torch.dtype,
    batch_seed_mode: str = "fixed",
) -> torch.Tensor:
    batch = shape[0]
    batch_seeds = _derived_batch_seeds(seed, batch, batch_seed_mode)
    if batch_seeds is None:
        gen = generator_for_seed(seed, device)
        return torch.rand(shape, generator=gen, device=device, dtype=dtype) * 2.0 - 1.0

    chunks = []
    for batch_seed in batch_seeds.tolist():
        gen = generator_for_seed(int(batch_seed), device)
        chunks.append(torch.rand((1, shape[1], shape[2], shape[3]), generator=gen, device=device, dtype=dtype) * 2.0 - 1.0)
    return torch.cat(chunks, dim=0)


def gaussian_kernel1d(sigma: float, device: torch.device, dtype: torch.dtype) -> torch.Tensor:
    sigma = float(sigma)
    radius = max(1, int(math.ceil(sigma * 3.0)))
    x = torch.arange(-radius, radius + 1, device=device, dtype=torch.float32)
    kernel = torch.exp(-(x * x) / max(2.0 * sigma * sigma, EPS))
    kernel = kernel / kernel.sum().clamp_min(EPS)
    return kernel.to(dtype=dtype)


def gaussian_blur_2d(x: torch.Tensor, sigma: float) -> torch.Tensor:
    sigma = float(sigma)
    if sigma <= 0.0:
        return x
    if x.ndim != 4:
        raise ValueError("gaussian_blur_2d expects a 4D tensor [B, C, H, W].")

    original_dtype = x.dtype
    work = safe_float_tensor(x)
    kernel = gaussian_kernel1d(sigma, work.device, work.dtype)
    radius = kernel.numel() // 2
    channels = work.shape[1]

    horizontal = kernel.view(1, 1, 1, -1).expand(channels, 1, 1, -1)
    vertical = kernel.view(1, 1, -1, 1).expand(channels, 1, -1, 1)

    work = F.pad(work, (radius, radius, 0, 0), mode="replicate")
    work = F.conv2d(work, horizontal, groups=channels)
    work = F.pad(work, (0, 0, radius, radius), mode="replicate")
    work = F.conv2d(work, vertical, groups=channels)
    return work.to(dtype=original_dtype)


def normalize_mean_std(x: torch.Tensor, dims=(1, 2, 3), target_std: float = 1.0) -> torch.Tensor:
    work = safe_float_tensor(x)
    mean = work.mean(dim=dims, keepdim=True)
    std = work.std(dim=dims, keepdim=True, unbiased=False).clamp_min(EPS)
    out = (work - mean) / std * float(target_std)
    return out.to(dtype=x.dtype)


def normalize_minmax(x: torch.Tensor, dims, eps: float = EPS) -> torch.Tensor:
    work = safe_float_tensor(x)
    mn = work.amin(dim=dims, keepdim=True)
    mx = work.amax(dim=dims, keepdim=True)
    return ((work - mn) / (mx - mn).clamp_min(eps)).clamp(0.0, 1.0)


def restore_latent_stats(
    output: torch.Tensor,
    reference: torch.Tensor,
    preserve_mean: bool,
    preserve_std: bool,
) -> torch.Tensor:
    if not preserve_mean and not preserve_std:
        return output

    out = safe_float_tensor(output)
    ref = safe_float_tensor(reference)
    dims = (1, 2, 3)
    out_mean = out.mean(dim=dims, keepdim=True)
    out_std = out.std(dim=dims, keepdim=True, unbiased=False).clamp_min(EPS)
    ref_mean = ref.mean(dim=dims, keepdim=True)
    ref_std = ref.std(dim=dims, keepdim=True, unbiased=False).clamp_min(EPS)

    if preserve_std:
        centered = out - out_mean
        out = centered * (ref_std / out_std)
        out = out + (ref_mean if preserve_mean else out_mean)
    elif preserve_mean:
        out = out - out_mean + ref_mean
    return out.to(dtype=output.dtype)


def clamp_like_reference(x: torch.Tensor, reference: torch.Tensor) -> torch.Tensor:
    dims = (1, 2, 3)
    ref = safe_float_tensor(reference)
    mn = ref.amin(dim=dims, keepdim=True)
    mx = ref.amax(dim=dims, keepdim=True)
    return safe_float_tensor(x).clamp(min=mn, max=mx).to(dtype=x.dtype)


def resize_channels(tensor: torch.Tensor, channels: int) -> torch.Tensor:
    if tensor.shape[1] == channels:
        return tensor
    if tensor.shape[1] == 1:
        return tensor.expand(tensor.shape[0], channels, tensor.shape[2], tensor.shape[3])
    if channels == 1:
        return tensor.mean(dim=1, keepdim=True)
    raise ValueError(f"Cannot broadcast {tensor.shape[1]} channels to {channels} channels.")


def resize_batch(tensor: torch.Tensor, batch: int) -> torch.Tensor:
    if tensor.shape[0] == batch:
        return tensor
    if tensor.shape[0] == 1:
        return tensor.expand(batch, tensor.shape[1], tensor.shape[2], tensor.shape[3])
    raise ValueError(f"Cannot broadcast batch size {tensor.shape[0]} to latent batch size {batch}.")


def resize_spatial(tensor: torch.Tensor, height: int, width: int, mode: str = "bilinear") -> torch.Tensor:
    if tensor.shape[-2:] == (height, width):
        return tensor
    work = safe_float_tensor(tensor)
    resized = F.interpolate(work, size=(height, width), mode=mode, align_corners=False if mode in ("bilinear", "bicubic") else None)
    return resized.to(dtype=tensor.dtype)


def prepare_mask(
    mask: Optional[torch.Tensor],
    samples: torch.Tensor,
    mask_blur: float = 0.0,
    invert: bool = False,
) -> torch.Tensor:
    batch, _, height, width = samples.shape
    if mask is None:
        prepared = torch.ones((batch, 1, height, width), device=samples.device, dtype=samples.dtype)
    else:
        if not isinstance(mask, torch.Tensor):
            raise ValueError("mask must be a torch.Tensor when supplied.")
        prepared = mask.to(device=samples.device, dtype=samples.dtype)
        if prepared.ndim == 2:
            prepared = prepared.unsqueeze(0).unsqueeze(0)
        elif prepared.ndim == 3:
            prepared = prepared.unsqueeze(1)
        elif prepared.ndim == 4:
            if prepared.shape[-1] == 1 and prepared.shape[1] != 1:
                prepared = prepared.permute(0, 3, 1, 2)
        else:
            raise ValueError("MASK must be shaped [H, W], [B, H, W], or [B, 1, H, W].")

        prepared = resize_batch(prepared, batch)
        prepared = resize_channels(prepared, 1)
        prepared = resize_spatial(prepared, height, width, mode="bilinear")

    prepared = prepared.clamp(0.0, 1.0)
    if float(mask_blur) > 0.0:
        prepared = gaussian_blur_2d(prepared, float(mask_blur)).clamp(0.0, 1.0)
    if invert:
        prepared = 1.0 - prepared
    return prepared.clamp(0.0, 1.0)


def mask_for_output(mask_4d: torch.Tensor) -> torch.Tensor:
    return mask_4d[:, 0, :, :].contiguous()


def frequency_filter_noise(noise: torch.Tensor, mode: str) -> torch.Tensor:
    if mode not in ("pink", "blue"):
        return noise

    original_dtype = noise.dtype
    work = safe_float_tensor(noise)
    _, _, height, width = work.shape
    fy = torch.fft.fftfreq(height, device=work.device, dtype=torch.float32).view(1, 1, height, 1)
    fx = torch.fft.rfftfreq(width, device=work.device, dtype=torch.float32).view(1, 1, 1, width // 2 + 1)
    radius = torch.sqrt(fx * fx + fy * fy).clamp_min(1.0 / max(height, width, 1))
    if mode == "pink":
        scale = radius.rsqrt()
    else:
        scale = torch.sqrt(radius)
    scale = scale / scale.mean().clamp_min(EPS)

    spectrum = torch.fft.rfftn(work, dim=(-2, -1))
    filtered = torch.fft.irfftn(spectrum * scale, s=(height, width), dim=(-2, -1))
    return filtered.to(dtype=original_dtype)


def generate_noise(
    samples: torch.Tensor,
    seed: int,
    noise_type: str = "gaussian",
    batch_seed_mode: str = "fixed",
) -> torch.Tensor:
    shape = tuple(samples.shape)
    if noise_type == "uniform":
        noise = uniform_random(shape, seed, samples.device, samples.dtype, batch_seed_mode)
    else:
        noise = gaussian_random(shape, seed, samples.device, samples.dtype, batch_seed_mode)

    if noise_type in ("pink", "blue"):
        noise = frequency_filter_noise(noise, noise_type)
    elif noise_type == "high_frequency":
        noise = noise - gaussian_blur_2d(noise, 1.5)
    elif noise_type == "low_frequency":
        noise = gaussian_blur_2d(noise, 4.0)
    elif noise_type not in ("gaussian", "uniform"):
        raise ValueError(f"Unknown noise_type: {noise_type}")
    return noise


def extract_noise_tensor(noise: Any, latent: Dict[str, Any], samples: torch.Tensor) -> Optional[torch.Tensor]:
    if noise is None:
        return None
    if isinstance(noise, torch.Tensor):
        return noise
    if isinstance(noise, dict):
        if "samples" in noise:
            return noise["samples"]
        if "noise" in noise:
            return noise["noise"]
    if hasattr(noise, "generate_noise"):
        generated = noise.generate_noise(latent)
        return extract_noise_tensor(generated, latent, samples)
    if callable(noise):
        generated = noise(latent)
        return extract_noise_tensor(generated, latent, samples)
    raise ValueError("Unsupported NOISE input. Expected a tensor, dict with 'samples', or generate_noise object.")


def prepare_noise(noise: torch.Tensor, samples: torch.Tensor) -> torch.Tensor:
    if not isinstance(noise, torch.Tensor):
        raise ValueError("Noise data must be a torch.Tensor.")
    prepared = noise.to(device=samples.device, dtype=samples.dtype)
    if prepared.ndim == 3:
        prepared = prepared.unsqueeze(1)
    if prepared.ndim != 4:
        raise ValueError("Noise tensor must be shaped [B, C, H, W] or [B, H, W].")
    prepared = resize_batch(prepared, samples.shape[0])
    prepared = resize_channels(prepared, samples.shape[1])
    prepared = resize_spatial(prepared, samples.shape[2], samples.shape[3], mode="bilinear")
    return prepared


def make_noise_object(samples: torch.Tensor, **metadata: Any) -> Dict[str, Any]:
    return {"samples": samples, "metadata": metadata}


def tensor_stats_text(name: str, tensor: torch.Tensor) -> str:
    work = safe_float_tensor(tensor)
    return (
        f"{name}: shape={tuple(tensor.shape)}, "
        f"mean={work.mean().item():.6f}, std={work.std(unbiased=False).item():.6f}, "
        f"min={work.min().item():.6f}, max={work.max().item():.6f}"
    )

