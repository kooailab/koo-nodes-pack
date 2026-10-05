"""ComfyUI backend node for KoO.IdeogramBoxy."""

from __future__ import annotations

import json
import math
from typing import Any

import numpy as np
import torch
from PIL import Image, ImageDraw

from .json_builder import build_ideogram_json
from .layout_math import SAFE_ZONES, normalize_layout, normalized_to_pixels
from .presets import get_preset


def _default_layout() -> dict[str, Any]:
    preset = get_preset("Golden Ratio")
    return {
        "version": 1,
        "aspectRatio": "1:1",
        "width": 1024,
        "height": 1024,
        "preset": "Golden Ratio",
        "highLevelDescription": "",
        "style": {},
        "promptDNA": preset["prompt_dna"],
        "guides": preset["guides"],
        "overlays": {
            **preset["overlays"],
            "safeZone": False,
            "safeZonePlatform": "generic",
        },
        "snapToGuides": True,
        "boxes": preset["boxes"],
    }


def _parse_layout(layout_json: Any) -> dict[str, Any]:
    if isinstance(layout_json, dict):
        return normalize_layout(layout_json)
    if not layout_json:
        return normalize_layout(_default_layout())
    try:
        parsed = json.loads(str(layout_json))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Layout JSON is invalid: {exc.msg}") from exc
    if not isinstance(parsed, dict):
        raise ValueError("Layout JSON must contain an object.")
    return normalize_layout(parsed)


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    cleaned = value.lstrip("#")
    if len(cleaned) == 3:
        cleaned = "".join(character * 2 for character in cleaned)
    try:
        return tuple(int(cleaned[index : index + 2], 16) for index in (0, 2, 4))
    except (ValueError, TypeError):
        return (34, 211, 238)


def _draw_guides(draw: ImageDraw.ImageDraw, layout: dict[str, Any]) -> None:
    width = layout["width"]
    height = layout["height"]
    guides = layout.get("guides", {})
    overlays = layout.get("overlays", {})
    line_width = max(1, round(min(width, height) / 500))

    vertical = set(float(value) for value in guides.get("vertical", []))
    horizontal = set(float(value) for value in guides.get("horizontal", []))
    if overlays.get("ruleOfThirds"):
        vertical.update((1 / 3, 2 / 3))
        horizontal.update((1 / 3, 2 / 3))

    for position in sorted(vertical):
        x = round(position * width)
        draw.line((x, 0, x, height), fill=(148, 163, 184, 130), width=line_width)
    for position in sorted(horizontal):
        y = round(position * height)
        draw.line((0, y, width, y), fill=(148, 163, 184, 130), width=line_width)

    if overlays.get("safeZone"):
        platform = str(overlays.get("safeZonePlatform", "generic"))
        zone = SAFE_ZONES.get(platform, SAFE_ZONES["generic"])
        safe_box = normalized_to_pixels(zone, width, height)
        draw.rectangle(
            safe_box,
            outline=(74, 222, 128, 210),
            width=max(2, line_width * 2),
        )

    if overlays.get("goldenSpiral"):
        _draw_golden_spiral(draw, width, height, line_width)


def _draw_golden_spiral(
    draw: ImageDraw.ImageDraw, width: int, height: int, line_width: int
) -> None:
    """Draw a deterministic logarithmic spiral approximation."""
    phi = (1 + math.sqrt(5)) / 2
    center_x = width * 0.618
    center_y = height * 0.382
    points = []
    max_radius = math.hypot(width, height) * 0.62
    for step in range(241):
        theta = -2.5 * math.pi + step * (4.5 * math.pi / 240)
        radius = max_radius * (phi ** (theta / (math.pi / 2) - 4.5))
        x = center_x + radius * math.cos(theta)
        y = center_y + radius * math.sin(theta)
        if -width * 0.1 <= x <= width * 1.1 and -height * 0.1 <= y <= height * 1.1:
            points.append((round(x), round(y)))
    if len(points) > 1:
        draw.line(points, fill=(251, 191, 36, 190), width=max(2, line_width * 2))


def _render_preview(layout: dict[str, Any]) -> torch.Tensor:
    width = layout["width"]
    height = layout["height"]
    image = Image.new("RGB", (width, height), (15, 23, 42))
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay, "RGBA")

    _draw_guides(draw, layout)
    stroke = max(2, round(min(width, height) / 260))
    label_height = max(20, round(min(width, height) / 32))

    for box in layout.get("boxes", []):
        if not box.get("visible", True):
            continue
        pixel_box = normalized_to_pixels(box["bbox"], width, height)
        color = _hex_to_rgb(str(box.get("color", "#22d3ee")))
        draw.rectangle(pixel_box, fill=(*color, 30), outline=(*color, 245), width=stroke)

        label = str(box.get("label", "Element"))
        if box.get("locked"):
            label += " [LOCKED]"
        text_box = draw.textbbox((0, 0), label)
        text_width = text_box[2] - text_box[0]
        label_x = pixel_box[0]
        label_y = max(0, pixel_box[1] - label_height)
        draw.rectangle(
            (
                label_x,
                label_y,
                min(width, label_x + text_width + 16),
                min(height, label_y + label_height),
            ),
            fill=(*color, 230),
        )
        draw.text((label_x + 8, label_y + 4), label, fill=(3, 7, 18, 255))

    image = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
    array = np.asarray(image, dtype=np.float32) / 255.0
    return torch.from_numpy(array).unsqueeze(0)


class KoOIdeogramBoxy:
    """Visual layout editor with Ideogram-compatible structured JSON output."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "layout_json": (
                    "IDEOGRAM_LAYOUT",
                    {
                        "default": "",
                        "tooltip": "Serialized visual layout. Edit it with the canvas widget.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING", "IMAGE", "INT", "INT")
    RETURN_NAMES = ("final_json_prompt", "preview_image_with_boxes", "width", "height")
    OUTPUT_TOOLTIPS = (
        "Ideogram-style structured JSON prompt.",
        "Rendered canvas preview with guides and visible boxes.",
        "Resolved output width.",
        "Resolved output height.",
    )
    FUNCTION = "compose"
    CATEGORY = "KoO.AI/Ideogram"
    DESCRIPTION = (
        "Compose an Ideogram prompt visually with draggable boxes, prompt DNA, "
        "composition presets, and deterministic pixel bounding boxes."
    )
    SEARCH_ALIASES = [
        "KoO IdeogramBoxy",
        "layout composer",
        "ideogram canvas",
        "composition planner",
    ]

    @classmethod
    def VALIDATE_INPUTS(cls, layout_json):
        try:
            _parse_layout(layout_json)
        except (TypeError, ValueError) as exc:
            return str(exc)
        return True

    def compose(self, layout_json):
        layout = _parse_layout(layout_json)
        final_json = build_ideogram_json(layout)
        preview = _render_preview(layout)
        return final_json, preview, layout["width"], layout["height"]


# Keep the original Python symbol available for third-party imports.
IdeogramLayoutComposer = KoOIdeogramBoxy
