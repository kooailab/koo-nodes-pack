import torch

from .noise_utils import EPS, normalize_minmax, safe_float_tensor


def image_to_luminance(image: torch.Tensor) -> torch.Tensor:
    if not isinstance(image, torch.Tensor) or image.ndim != 4:
        raise ValueError("IMAGE must be a 4D tensor shaped [B, H, W, C].")
    img = image.float().clamp(0.0, 1.0)
    channels = img.shape[-1]
    if channels == 1:
        lum = img[..., 0]
    else:
        rgb = img[..., :3]
        weights = torch.tensor([0.2126, 0.7152, 0.0722], device=img.device, dtype=img.dtype)
        lum = (rgb * weights).sum(dim=-1)
    return lum.unsqueeze(1)


def tensor_to_channel_map(tensor: torch.Tensor, channel_mode: str) -> torch.Tensor:
    if tensor.ndim == 3:
        tensor = tensor.unsqueeze(1)
    if tensor.ndim != 4:
        raise ValueError("Preview tensor must be shaped [B, C, H, W] or [B, H, W].")

    if channel_mode == "first":
        return tensor[:, :1]
    if channel_mode == "average":
        return tensor.mean(dim=1, keepdim=True)
    if channel_mode == "maximum":
        return tensor.abs().amax(dim=1, keepdim=True)
    if channel_mode == "rgb_projection":
        if tensor.shape[1] >= 3:
            return tensor[:, :3]
        return tensor[:, :1].expand(tensor.shape[0], 3, tensor.shape[2], tensor.shape[3])
    raise ValueError(f"Unknown channel_mode: {channel_mode}")


def diagnostic_image(
    tensor: torch.Tensor,
    channel_mode: str = "average",
    contrast: float = 1.0,
    normalize: bool = True,
    signed_visualization: bool = True,
) -> torch.Tensor:
    mapped = tensor_to_channel_map(tensor, channel_mode)
    work = safe_float_tensor(mapped)
    contrast = float(contrast)

    if signed_visualization:
        if normalize:
            max_abs = work.abs().amax(dim=(1, 2, 3), keepdim=True).clamp_min(EPS)
            work = work / max_abs
        work = (0.5 + work * 0.5 * contrast).clamp(0.0, 1.0)
    else:
        if normalize:
            work = normalize_minmax(work, dims=(1, 2, 3))
        work = ((work - 0.5) * contrast + 0.5).clamp(0.0, 1.0)

    if work.shape[1] == 1:
        work = work.expand(work.shape[0], 3, work.shape[2], work.shape[3])
    return work.permute(0, 2, 3, 1).contiguous().float()


def heatmap_image(tensor: torch.Tensor, channel_mode: str = "maximum", contrast: float = 1.0, normalize: bool = True) -> torch.Tensor:
    magnitude = tensor.abs()
    return diagnostic_image(
        magnitude,
        channel_mode=channel_mode,
        contrast=contrast,
        normalize=normalize,
        signed_visualization=False,
    )


def mask_to_image(mask: torch.Tensor) -> torch.Tensor:
    if mask.ndim == 4:
        mask = mask[:, :1]
    elif mask.ndim == 3:
        mask = mask.unsqueeze(1)
    else:
        raise ValueError("Mask preview expects [B, H, W] or [B, 1, H, W].")
    return mask.clamp(0.0, 1.0).expand(mask.shape[0], 3, mask.shape[2], mask.shape[3]).permute(0, 2, 3, 1).contiguous().float()

