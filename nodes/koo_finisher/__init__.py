"""KoO Finisher node, processing helpers, and ComfyUI route registration."""

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

try:
    from .routes import register_routes

    if not register_routes():
        print(
            "[KoO Nodes] PromptServer unavailable at import time; KoO Finisher "
            "routes (/koo/finisher/*) were not registered for this session."
        )
except Exception as exc:  # pragma: no cover - ComfyUI startup safety net
    print(f"[KoO Nodes] KoO Finisher route registration failed: {exc}")

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
