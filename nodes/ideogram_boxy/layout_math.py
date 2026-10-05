"""Coordinate conversion and layout validation helpers."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Iterable


ASPECT_DIMENSIONS = {
    "1:1": (1024, 1024),
    "2:3": (832, 1248),
    "3:2": (1248, 832),
    "9:16": (720, 1280),
    "16:9": (1280, 720),
}

SAFE_ZONES = {
    "generic": (0.05, 0.05, 0.95, 0.95),
    "instagram": (0.08, 0.08, 0.92, 0.92),
    "youtube": (0.05, 0.10, 0.95, 0.90),
    "tiktok": (0.08, 0.12, 0.88, 0.82),
}


def clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, float(value)))


def resolve_dimensions(aspect_ratio: str, width: Any, height: Any) -> tuple[int, int]:
    """Resolve a named ratio or validate custom dimensions."""
    if aspect_ratio in ASPECT_DIMENSIONS:
        return ASPECT_DIMENSIONS[aspect_ratio]

    try:
        resolved_width = int(width)
        resolved_height = int(height)
    except (TypeError, ValueError) as exc:
        raise ValueError("Custom width and height must be integers.") from exc

    if not 64 <= resolved_width <= 8192 or not 64 <= resolved_height <= 8192:
        raise ValueError("Width and height must be between 64 and 8192 pixels.")
    return resolved_width, resolved_height


def sanitize_bbox(bbox: Iterable[Any], minimum_size: float = 0.01) -> list[float]:
    """Clamp a normalized [x1, y1, x2, y2] box and keep it non-empty."""
    values = list(bbox)
    if len(values) != 4:
        raise ValueError("A bounding box must contain four values.")

    x1, y1, x2, y2 = (clamp(float(value)) for value in values)
    if x2 < x1:
        x1, x2 = x2, x1
    if y2 < y1:
        y1, y2 = y2, y1
    x2 = clamp(max(x2, x1 + minimum_size))
    y2 = clamp(max(y2, y1 + minimum_size))
    if x2 - x1 < minimum_size:
        x1 = clamp(x2 - minimum_size)
    if y2 - y1 < minimum_size:
        y1 = clamp(y2 - minimum_size)
    return [round(x1, 6), round(y1, 6), round(x2, 6), round(y2, 6)]


def normalized_to_pixels(
    bbox: Iterable[Any], width: int, height: int
) -> list[int]:
    """Convert normalized coordinates to inclusive canvas pixel coordinates."""
    x1, y1, x2, y2 = sanitize_bbox(bbox)
    return [
        max(0, min(width - 1, round(x1 * width))),
        max(0, min(height - 1, round(y1 * height))),
        max(1, min(width, round(x2 * width))),
        max(1, min(height, round(y2 * height))),
    ]


def pixels_to_normalized(
    bbox: Iterable[Any], width: int, height: int
) -> list[float]:
    values = list(bbox)
    if len(values) != 4 or width <= 0 or height <= 0:
        raise ValueError("Invalid pixel bounding box or canvas dimensions.")
    return sanitize_bbox(
        [
            float(values[0]) / width,
            float(values[1]) / height,
            float(values[2]) / width,
            float(values[3]) / height,
        ]
    )


def intersection_area(first: Iterable[Any], second: Iterable[Any]) -> float:
    ax1, ay1, ax2, ay2 = sanitize_bbox(first)
    bx1, by1, bx2, by2 = sanitize_bbox(second)
    return max(0.0, min(ax2, bx2) - max(ax1, bx1)) * max(
        0.0, min(ay2, by2) - max(ay1, by1)
    )


def overlap_ratio(first: Iterable[Any], second: Iterable[Any]) -> float:
    """Return intersection divided by the smaller box area."""
    first_box = sanitize_bbox(first)
    second_box = sanitize_bbox(second)
    intersection = intersection_area(first_box, second_box)
    first_area = (first_box[2] - first_box[0]) * (first_box[3] - first_box[1])
    second_area = (second_box[2] - second_box[0]) * (
        second_box[3] - second_box[1]
    )
    return intersection / max(min(first_area, second_area), 1e-9)


def find_overlaps(boxes: Iterable[dict[str, Any]], threshold: float = 0.2) -> list[tuple[str, str]]:
    visible = [box for box in boxes if box.get("visible", True)]
    warnings: list[tuple[str, str]] = []
    for index, first in enumerate(visible):
        for second in visible[index + 1 :]:
            if overlap_ratio(first.get("bbox", []), second.get("bbox", [])) >= threshold:
                warnings.append(
                    (
                        str(first.get("label", "Untitled")),
                        str(second.get("label", "Untitled")),
                    )
                )
    return warnings


def convert_layout_aspect_ratio(
    layout: dict[str, Any], new_width: int, new_height: int
) -> dict[str, Any]:
    """Contain the old composition in a new frame while preserving hierarchy."""
    converted = deepcopy(layout)
    old_width = max(1, int(layout.get("width", new_width)))
    old_height = max(1, int(layout.get("height", new_height)))
    scale = min(new_width / old_width, new_height / old_height)
    offset_x = (new_width - old_width * scale) / 2.0
    offset_y = (new_height - old_height * scale) / 2.0

    for box in converted.get("boxes", []):
        x1, y1, x2, y2 = normalized_to_pixels(
            box.get("bbox", [0.1, 0.1, 0.9, 0.9]), old_width, old_height
        )
        box["bbox"] = pixels_to_normalized(
            [
                x1 * scale + offset_x,
                y1 * scale + offset_y,
                x2 * scale + offset_x,
                y2 * scale + offset_y,
            ],
            new_width,
            new_height,
        )

    converted["width"] = int(new_width)
    converted["height"] = int(new_height)
    return converted


def normalize_layout(layout: dict[str, Any]) -> dict[str, Any]:
    """Return a deterministic, backend-safe copy of a frontend layout."""
    normalized = deepcopy(layout)
    aspect_ratio = str(normalized.get("aspectRatio", "1:1"))
    width, height = resolve_dimensions(
        aspect_ratio, normalized.get("width", 1024), normalized.get("height", 1024)
    )
    normalized["aspectRatio"] = aspect_ratio
    normalized["width"] = width
    normalized["height"] = height

    clean_boxes = []
    for index, raw_box in enumerate(normalized.get("boxes", [])):
        if not isinstance(raw_box, dict):
            continue
        box = dict(raw_box)
        box["id"] = str(box.get("id", f"box-{index + 1}"))
        box["label"] = str(box.get("label", f"Element {index + 1}"))
        box["type"] = str(box.get("type", "object"))
        box["prompt"] = str(box.get("prompt", ""))
        box["text"] = str(box.get("text", ""))
        box["negativePrompt"] = str(box.get("negativePrompt", ""))
        box["color"] = str(box.get("color", "#67e8f9"))
        box["weight"] = round(clamp(box.get("weight", 1.0), 0.0, 2.0), 3)
        box["locked"] = bool(box.get("locked", False))
        box["visible"] = bool(box.get("visible", True))
        box["bbox"] = sanitize_bbox(box.get("bbox", [0.1, 0.1, 0.9, 0.9]))
        clean_boxes.append(box)
    normalized["boxes"] = clean_boxes
    return normalized
