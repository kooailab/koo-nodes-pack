"""KoO Visual Prompt Director node package."""

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

try:
    from .routes import register_routes

    if not register_routes():
        print(
            "[KoO Nodes] PromptServer or aiohttp unavailable at import time; "
            "Visual Prompt Director routes (/koo/prompt-director/*) were not registered."
        )
except Exception as exc:  # pragma: no cover - ComfyUI startup safety net
    # A frontend helper route must never prevent unrelated KoO nodes from loading.
    print(f"[KoO Nodes] Visual Prompt Director route registration failed: {exc}")

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
