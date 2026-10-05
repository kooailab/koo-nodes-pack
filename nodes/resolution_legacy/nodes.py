import math

import comfy.model_management
import torch

try:
    import nodes as comfy_nodes
    MAX_RESOLUTION = int(getattr(comfy_nodes, "MAX_RESOLUTION", 16384))
except Exception:
    MAX_RESOLUTION = 16384


CUSTOM_KEY = "custom"
DEFAULT_PRESET = "1024x1024"
DEFAULT_WIDTH = 1024
DEFAULT_HEIGHT = 1024
MIN_RESOLUTION = 64
ROUND_MULTIPLE = 8
DEFAULT_BATCH_SIZE = 1
MAX_BATCH_SIZE = 4096

PRESETS = [
    ("512x512", 512, 512),
    ("768x768", 768, 768),
    ("1024x1024", 1024, 1024),
    ("1344x768", 1344, 768),
    ("1536x864", 1536, 864),
    ("1920x1080", 1920, 1080),
    ("2560x1440", 2560, 1440),
    ("3840x2160", 3840, 2160),
    ("1536x1024", 1536, 1024),
    ("2048x1024", 2048, 1024),
    ("1080x1920", 1080, 1920),
    ("768x1344", 768, 1344),
    ("1024x1536", 1024, 1536),
    ("1080x1350", 1080, 1350),
    ("1350x1080", 1350, 1080),
]

ASPECT_RATIOS = ("1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "4:5", "Custom")
MULTIPLIERS = ("1x", "2x")
LATENT_MODES = (
    "Resolution Only",
    "Standard SD / SDXL",
    "SD3 / Flux 1 / Qwen Image",
    "Flux 2",
)

PRESET_BY_KEY = {key: (width, height) for key, width, height in PRESETS}
PRESET_KEYS = [key for key, _width, _height in PRESETS] + [CUSTOM_KEY]


def _finite_float(value, default=None):
    if value is None or isinstance(value, bool):
        return default
    if isinstance(value, str):
        value = value.strip().lower().replace("x", "")
        if not value:
            return default
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(number):
        return default
    return number


def _choice(value, allowed, default):
    text = str(value).strip() if value is not None else ""
    return text if text in allowed else default


def _round_to_multiple(value, multiple=ROUND_MULTIPLE):
    number = _finite_float(value, None)
    if number is None:
        return None
    rounded = int(round(number / multiple) * multiple)
    return max(MIN_RESOLUTION, min(MAX_RESOLUTION, rounded))


def sanitize_anchor_dimension(value, default):
    number = _finite_float(value, None)
    if number is None:
        number = default
    return max(MIN_RESOLUTION, min(MAX_RESOLUTION, int(round(number))))


def sanitize_dimension(value, default):
    result = _round_to_multiple(value)
    if result is None:
        result = _round_to_multiple(default)
    return int(result)


def sanitize_batch_size(value):
    number = _finite_float(value, DEFAULT_BATCH_SIZE)
    return max(1, min(MAX_BATCH_SIZE, int(round(number))))


def multiplier_value(value):
    text = _choice(value, MULTIPLIERS, "1x")
    return 2 if text == "2x" else 1


def gcd_ratio(width, height):
    width = max(1, int(width))
    height = max(1, int(height))
    divisor = math.gcd(width, height) or 1
    return f"{width // divisor}:{height // divisor}"


def resolution_label(width, height):
    return f"{int(width)} x {int(height)} - {gcd_ratio(width, height)}"


def resolve_base_dimensions(resolution_preset=DEFAULT_PRESET, custom_width=DEFAULT_WIDTH, custom_height=DEFAULT_HEIGHT):
    if str(resolution_preset) == CUSTOM_KEY:
        return (
            sanitize_anchor_dimension(custom_width, DEFAULT_WIDTH),
            sanitize_anchor_dimension(custom_height, DEFAULT_HEIGHT),
        )
    width, height = PRESET_BY_KEY.get(str(resolution_preset), PRESET_BY_KEY[DEFAULT_PRESET])
    return sanitize_dimension(width, DEFAULT_WIDTH), sanitize_dimension(height, DEFAULT_HEIGHT)


def resolve_final_dimensions(resolution_preset=DEFAULT_PRESET, custom_width=DEFAULT_WIDTH, custom_height=DEFAULT_HEIGHT, upscale_multiplier="1x"):
    base_width, base_height = resolve_base_dimensions(resolution_preset, custom_width, custom_height)
    multiplier = multiplier_value(upscale_multiplier)
    return (
        sanitize_anchor_dimension(base_width * multiplier, base_width),
        sanitize_anchor_dimension(base_height * multiplier, base_height),
    )


def create_latent(width, height, batch_size, latent_mode):
    batch_size = sanitize_batch_size(batch_size)
    latent_mode = _choice(latent_mode, LATENT_MODES, "Resolution Only")
    device = comfy.model_management.intermediate_device()

    if latent_mode == "Resolution Only":
        latent = torch.zeros([1, 4, 1, 1], device=device, dtype=comfy.model_management.intermediate_dtype())
        return {"samples": latent, "downscale_ratio_spacial": 8, "koo_resolution_only": True}

    if latent_mode == "Flux 2":
        latent = torch.zeros([batch_size, 128, max(1, int(height) // 16), max(1, int(width) // 16)], device=device)
        return {"samples": latent}

    if latent_mode == "SD3 / Flux 1 / Qwen Image":
        latent = torch.zeros(
            [batch_size, 16, max(1, int(height) // 8), max(1, int(width) // 8)],
            device=device,
            dtype=comfy.model_management.intermediate_dtype(),
        )
        return {"samples": latent, "downscale_ratio_spacial": 8}

    latent = torch.zeros(
        [batch_size, 4, max(1, int(height) // 8), max(1, int(width) // 8)],
        device=device,
        dtype=comfy.model_management.intermediate_dtype(),
    )
    return {"samples": latent, "downscale_ratio_spacial": 8}


class KoOResolution:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "resolution_preset": (
                    PRESET_KEYS,
                    {"default": DEFAULT_PRESET, "tooltip": "Stored preset value for old workflow compatibility."},
                ),
                "custom_width": (
                    "INT",
                    {"default": DEFAULT_WIDTH, "min": MIN_RESOLUTION, "max": MAX_RESOLUTION, "step": ROUND_MULTIPLE, "tooltip": "Base width before the x1/x2 multiplier."},
                ),
                "custom_height": (
                    "INT",
                    {"default": DEFAULT_HEIGHT, "min": MIN_RESOLUTION, "max": MAX_RESOLUTION, "step": ROUND_MULTIPLE, "tooltip": "Base height before the x1/x2 multiplier."},
                ),
                "aspect_ratio": (ASPECT_RATIOS, {"default": "1:1", "tooltip": "Selected KoO aspect ratio."}),
                "upscale_multiplier": (MULTIPLIERS, {"default": "1x", "tooltip": "Final output multiplier. Non-cumulative."}),
                "batch_size": ("INT", {"default": DEFAULT_BATCH_SIZE, "min": 1, "max": MAX_BATCH_SIZE, "step": 1, "tooltip": "Latent batch size."}),
                "latent_mode": (LATENT_MODES, {"default": "Resolution Only", "tooltip": "Empty latent type to create."}),
            }
        }

    RETURN_TYPES = ("INT", "INT", "STRING", "LATENT")
    RETURN_NAMES = ("width", "height", "resolution_label", "latent")
    FUNCTION = "get_resolution"
    CATEGORY = "KoO Tools / Resolution"
    DESCRIPTION = "Compact KoO resolution controller with x1/x2 final sizing and empty latent output."
    SEARCH_ALIASES = ["koo resolution", "resolution preset", "width height", "empty latent"]

    def get_resolution(
        self,
        resolution_preset=DEFAULT_PRESET,
        custom_width=DEFAULT_WIDTH,
        custom_height=DEFAULT_HEIGHT,
        aspect_ratio="1:1",
        upscale_multiplier="1x",
        batch_size=DEFAULT_BATCH_SIZE,
        latent_mode="Resolution Only",
    ):
        width, height = resolve_final_dimensions(resolution_preset, custom_width, custom_height, upscale_multiplier)
        latent = create_latent(width, height, batch_size, latent_mode)
        return (width, height, resolution_label(width, height), latent)

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True


NODE_CLASS_MAPPINGS = {
    "KoOResolution": KoOResolution,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KoOResolution": "KoO.Resolution",
}
