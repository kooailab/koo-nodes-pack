import torch
import comfy.utils


class KoOMultipleAdapter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {"default": 1024, "min": 1, "defaultInput": True}),
                "height": ("INT", {"default": 1024, "min": 1, "defaultInput": True}),
                "multiple": ("INT", {"default": 16, "min": 1, "step": 1}),
                "direction": (["PLUS", "MINUS"], {"default": "PLUS"}),
            },
            "optional": {
                "latent": ("LATENT",),
                "offset": ("INT", {"default": 0, "min": 0, "max": 1, "step": 1}),
            },
        }

    RETURN_TYPES = ("INT", "INT", "LATENT")
    RETURN_NAMES = ("width", "height", "latent")
    FUNCTION = "adapt"
    CATEGORY = "KoO Tools / Utilities"

    def adapt(self, width, height, multiple=16, direction="PLUS", latent=None, offset=0):
        if any(type(value) is not int or value < 1 for value in (width, height, multiple)):
            raise ValueError("KoO Multiple Adapter: dimensions and multiple must be positive integers.")
        if direction not in ("PLUS", "MINUS"):
            raise ValueError("KoO Multiple Adapter: direction must be PLUS or MINUS.")
        if type(offset) is not int or offset not in (0, 1):
            raise ValueError("KoO Multiple Adapter: offset must be 0 or 1.")
        rounding = multiple - 1 if direction == "PLUS" else 0
        minimum = offset if offset else multiple
        target_width = max(minimum, offset + ((width - offset + rounding) // multiple) * multiple)
        target_height = max(minimum, offset + ((height - offset + rounding) // multiple) * multiple)
        if latent is None:
            return target_width, target_height, None

        samples = latent.get("samples") if isinstance(latent, dict) else None
        if not isinstance(samples, torch.Tensor) or samples.ndim not in (4, 5):
            raise ValueError("KoO Multiple Adapter: expected LATENT samples [B,C,H,W] or [B,C,1,H,W].")
        if samples.ndim == 5 and samples.shape[2] != 1:
            raise ValueError("KoO Multiple Adapter: only still-image 5D latents are supported.")
        old_h, old_w = samples.shape[-2:]
        if not old_h or not old_w or width % old_w or height % old_h or width // old_w != height // old_h:
            raise ValueError("KoO Multiple Adapter: input dimensions must match an integer latent spatial scale.")
        scale = width // old_w
        if not scale or target_width % scale or target_height % scale:
            hint = " Use +0 or disconnect LATENT." if offset == 1 else ""
            raise ValueError(f"KoO Multiple Adapter: Target {target_width}x{target_height} is incompatible with connected LATENT grid scale {scale}.{hint}")
        new_w, new_h = target_width // scale, target_height // scale
        if (new_h, new_w) == (old_h, old_w):
            return target_width, target_height, latent

        result = latent.copy()
        result["samples"] = comfy.utils.common_upscale(samples, new_w, new_h, "bilinear", "disabled")
        for name, field in latent.items():
            if name == "samples" or not isinstance(field, torch.Tensor) or field.ndim < 2:
                continue
            if field.shape[-2:] == (old_h, old_w):
                field_w, field_h = new_w, new_h
            elif field.shape[-2:] == (height, width) or name == "noise_mask":
                field_w, field_h = target_width, target_height
            else:
                continue
            leading = field.shape[:-2]
            work = field.reshape(-1, 1, *field.shape[-2:])
            method = "bilinear" if field.is_floating_point() else "nearest-exact"
            resized = comfy.utils.common_upscale(work if field.is_floating_point() else work.float(), field_w, field_h, method, "disabled")
            result[name] = resized.to(dtype=field.dtype).reshape(*leading, field_h, field_w)
        return target_width, target_height, result


NODE_CLASS_MAPPINGS = {"KoOMultipleAdapter": KoOMultipleAdapter}
NODE_DISPLAY_NAME_MAPPINGS = {"KoOMultipleAdapter": "KoO Multiple Adapter"}
