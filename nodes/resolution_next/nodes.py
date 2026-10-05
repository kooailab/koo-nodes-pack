import math

import torch


RATIO_DEFAULTS = {
    "1:1": (1024, 1024),
    "16:9": (1536, 864),
    "9:16": (864, 1536),
    "4:3": (1152, 864),
    "3:4": (864, 1152),
    "3:2": (1248, 832),
    "2:3": (832, 1248),
    "21:9": (1344, 576),
    "4:5": (1024, 1280),
}

RATIOS = tuple([*RATIO_DEFAULTS.keys(), "Custom"])
MAX_SIDES = (1024, 1536, 2048, 2560, 4096)
SCALES = ("x1", "x2")
LATENT_MODES = (
    "Resolution Only",
    "Standard SD / SDXL",
    "SD3 / Flux 1 / Qwen",
    "Flux 2",
)


def _snap_to_multiple(value, multiple=8):
    value = int(round(float(value) / multiple) * multiple)
    return max(multiple, value)


def _clamp_dimension(value):
    return max(8, min(16384, _snap_to_multiple(value)))


def _locked_dimensions(ratio, max_side, fallback_width, fallback_height):
    max_side = _clamp_dimension(max_side)

    if ratio in RATIO_DEFAULTS:
        ratio_width, ratio_height = RATIO_DEFAULTS[ratio]
    else:
        ratio_width = max(8, float(fallback_width))
        ratio_height = max(8, float(fallback_height))

    if ratio_width >= ratio_height:
        width = max_side
        height = _snap_to_multiple(max_side * (ratio_height / ratio_width))
    else:
        width = _snap_to_multiple(max_side * (ratio_width / ratio_height))
        height = max_side

    return _clamp_dimension(width), _clamp_dimension(height)


def _latent_channels(latent_mode):
    if latent_mode in ("SD3 / Flux 1 / Qwen", "Flux 2"):
        return 16
    return 4


def _intermediate_device():
    try:
        import comfy.model_management

        return comfy.model_management.intermediate_device()
    except Exception:
        return torch.device("cpu")


class KoOResolutionNext:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "base_width": ("INT", {"default": 1536, "min": 8, "max": 16384, "step": 8}),
                "base_height": ("INT", {"default": 864, "min": 8, "max": 16384, "step": 8}),
                "ratio": (RATIOS, {"default": "16:9"}),
                "max_side": ("INT", {"default": 2048, "min": 8, "max": 16384, "step": 8}),
                "max_side_lock": ("BOOLEAN", {"default": False}),
                "scale": (SCALES, {"default": "x1"}),
                "latent_mode": (LATENT_MODES, {"default": "Standard SD / SDXL"}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 4096, "step": 1}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "STRING", "LATENT")
    RETURN_NAMES = ("width", "height", "resolution_label", "latent")
    FUNCTION = "generate"
    CATEGORY = "KoO Tools / Resolution"

    def generate(
        self,
        base_width,
        base_height,
        ratio,
        max_side,
        max_side_lock,
        scale,
        latent_mode,
        batch_size,
    ):
        if max_side_lock:
            base_width, base_height = _locked_dimensions(ratio, max_side, base_width, base_height)
        else:
            base_width = _clamp_dimension(base_width)
            base_height = _clamp_dimension(base_height)

        scale_multiplier = 2 if scale == "x2" else 1
        width = _clamp_dimension(base_width * scale_multiplier)
        height = _clamp_dimension(base_height * scale_multiplier)
        batch_size = max(1, int(batch_size))

        channels = _latent_channels(latent_mode)
        latent_height = max(1, height // 8)
        latent_width = max(1, width // 8)
        latent = torch.zeros(
            [batch_size, channels, latent_height, latent_width],
            device=_intermediate_device(),
        )

        megapixels = (width * height) / 1_000_000
        label = f"{width} x {height} | {ratio} | {megapixels:.2f} MP | Batch {batch_size}"
        return (width, height, label, {"samples": latent})


NODE_CLASS_MAPPINGS = {
    "KoOResolutionNext": KoOResolutionNext,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KoOResolutionNext": "KoO.Resolution Next",
}
