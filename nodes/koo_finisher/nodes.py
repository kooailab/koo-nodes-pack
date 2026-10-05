from __future__ import annotations

import json
from .cache import cache_source_image, save_finished_image


class KoOFinisher:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
            },
            "optional": {"finisher_settings": ("STRING", {"default": ""})},
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "cache"
    OUTPUT_NODE = True
    CATEGORY = "KoO/Post Processing"
    DESCRIPTION = "Standalone interactive finisher with cached source preview and direct image save."

    @classmethod
    def IS_CHANGED(cls, image, unique_id=None, finisher_settings=""):
        settings = json.loads(finisher_settings) if finisher_settings else {}
        return float("nan") if settings.get("auto_save", False) else finisher_settings

    def cache(self, image, unique_id=None, finisher_settings=""):
        info = cache_source_image(image, unique_id)
        settings = json.loads(finisher_settings) if finisher_settings else {}
        if settings.get("auto_save", False):
            info["auto_saved"] = save_finished_image({**settings, "cache_id": info["cache_id"]})
        return {
            "ui": {
                "koo_finisher": [info],
            },
            "result": (image,),
        }


NODE_CLASS_MAPPINGS = {
    "KoOFinisher": KoOFinisher,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KoOFinisher": "KoO Finisher",
}
