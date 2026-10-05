from .node import KoOIdeogramBoxy

NODE_CLASS_MAPPINGS = {
    "KoOIdeogramBoxy": KoOIdeogramBoxy,
    "IdeogramLayoutComposer": KoOIdeogramBoxy,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KoOIdeogramBoxy": "KoO.IdeogramBoxy",
    "IdeogramLayoutComposer": "KoO.IdeogramBoxy (Legacy)",
}

WEB_DIRECTORY = "./web"

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]
