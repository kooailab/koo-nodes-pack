from __future__ import annotations

from typing import Any, Dict, Tuple

import torch


def _copy_latent(latent: Dict[str, Any], samples: torch.Tensor) -> Dict[str, Any]:
    if not isinstance(latent, dict):
        raise TypeError("latent must be a ComfyUI LATENT dictionary.")
    result = dict(latent)
    result["samples"] = samples
    return result


class KoOKreaStillLatentTo4D:
    """Convert a Krea 2 still-image latent [B,C,1,H,W] to standard 4D [B,C,H,W]."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"latent": ("LATENT",)}}

    RETURN_TYPES = ("LATENT", "STRING")
    RETURN_NAMES = ("LATENT", "shape_report")
    FUNCTION = "convert"
    CATEGORY = "KoO/Latent Compatibility"

    def convert(self, latent: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
        samples = latent.get("samples")
        if not isinstance(samples, torch.Tensor):
            raise TypeError("latent['samples'] must be a torch.Tensor.")

        before = tuple(samples.shape)

        if samples.ndim == 4:
            output = samples
            action = "already 4D; passed through unchanged"
        elif samples.ndim == 5:
            if samples.shape[2] != 1:
                raise ValueError(
                    "Expected a still-image Krea latent shaped [B,C,1,H,W], "
                    f"but received {before}. The temporal dimension must equal 1."
                )
            output = samples.squeeze(2)
            action = "squeezed singleton temporal dimension at index 2"
        else:
            raise ValueError(
                "Expected a 4D latent [B,C,H,W] or a 5D Krea still latent "
                f"[B,C,1,H,W], but received {before}."
            )

        report = f"{action}: {before} -> {tuple(output.shape)}"
        return (_copy_latent(latent, output), report)


class KoO4DToKreaStillLatent:
    """Restore a standard 4D latent [B,C,H,W] to Krea 2 still-image 5D [B,C,1,H,W]."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"latent": ("LATENT",)}}

    RETURN_TYPES = ("LATENT", "STRING")
    RETURN_NAMES = ("LATENT", "shape_report")
    FUNCTION = "convert"
    CATEGORY = "KoO/Latent Compatibility"

    def convert(self, latent: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
        samples = latent.get("samples")
        if not isinstance(samples, torch.Tensor):
            raise TypeError("latent['samples'] must be a torch.Tensor.")

        before = tuple(samples.shape)

        if samples.ndim == 5:
            if samples.shape[2] != 1:
                raise ValueError(
                    "Expected a Krea still latent with temporal dimension 1, "
                    f"but received {before}."
                )
            output = samples
            action = "already Krea 5D; passed through unchanged"
        elif samples.ndim == 4:
            output = samples.unsqueeze(2)
            action = "inserted singleton temporal dimension at index 2"
        else:
            raise ValueError(
                "Expected a 4D latent [B,C,H,W] or Krea still latent "
                f"[B,C,1,H,W], but received {before}."
            )

        report = f"{action}: {before} -> {tuple(output.shape)}"
        return (_copy_latent(latent, output), report)


NODE_CLASS_MAPPINGS = {
    "KoOKreaStillLatentTo4D": KoOKreaStillLatentTo4D,
    "KoO4DToKreaStillLatent": KoO4DToKreaStillLatent,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KoOKreaStillLatentTo4D": "KoO Krea Still Latent → 4D",
    "KoO4DToKreaStillLatent": "KoO 4D → Krea Still Latent",
}
