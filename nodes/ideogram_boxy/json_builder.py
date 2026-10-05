"""Build Ideogram-style structured prompts from normalized layout state."""

from __future__ import annotations

import json
from typing import Any

from .layout_math import normalize_layout, normalized_to_pixels
from .presets import get_preset


IDEOGRAM_TYPE_MAP = {
    "text": "text",
    "background": "background",
    "object": "obj",
    "logo": "obj",
    "product": "obj",
    "foreground": "obj",
    "atmosphere": "obj",
}


def _clean(value: Any) -> str:
    return " ".join(str(value or "").split())


def _merge_hint(primary: Any, fallback: Any) -> str:
    primary_text = _clean(primary)
    fallback_text = _clean(fallback)
    if primary_text and fallback_text and fallback_text.lower() not in primary_text.lower():
        return f"{primary_text}; {fallback_text}"
    return primary_text or fallback_text


def _element_description(box: dict[str, Any]) -> str:
    parts = []
    label = _clean(box.get("label"))
    box_type = _clean(box.get("type"))
    prompt = _clean(box.get("prompt"))
    text = _clean(box.get("text"))
    negative = _clean(box.get("negativePrompt"))
    weight = float(box.get("weight", 1.0))

    if label:
        parts.append(f"{label} ({box_type})")
    if prompt:
        parts.append(prompt)
    if box_type == "text" and text:
        parts.append(f'Exact text: "{text}"')
    parts.append(f"Importance: {weight:.2f}")
    if negative:
        parts.append(f"Avoid: {negative}")
    return ". ".join(parts)


def build_ideogram_payload(layout: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_layout(layout)
    preset = get_preset(str(normalized.get("preset", "Golden Ratio")))
    dna = preset["prompt_dna"]
    state_dna = normalized.get("promptDNA", {})
    style = normalized.get("style", {})
    width = normalized["width"]
    height = normalized["height"]

    background_descriptions = []
    elements = []
    for box in normalized["boxes"]:
        if not box.get("visible", True):
            continue
        description = _element_description(box)
        if box.get("type") == "background":
            background_descriptions.append(description)
            continue
        elements.append(
            {
                "type": IDEOGRAM_TYPE_MAP.get(str(box.get("type")), "obj"),
                "bbox": normalized_to_pixels(box["bbox"], width, height),
                "desc": description,
            }
        )

    return {
        "high_level_description": _merge_hint(
            normalized.get("highLevelDescription"),
            state_dna.get("high_level_hint", dna["high_level_hint"]),
        ),
        "style_description": {
            "aesthetics": _merge_hint(
                style.get("aesthetics"),
                state_dna.get("aesthetics", dna["aesthetics"]),
            ),
            "lighting": _merge_hint(
                style.get("lighting"),
                state_dna.get("lighting", dna["lighting"]),
            ),
            "medium": _merge_hint(
                style.get("medium"), state_dna.get("medium", dna["medium"])
            ),
            "composition": _merge_hint(
                style.get("composition"),
                state_dna.get("composition", dna["composition"]),
            ),
        },
        "compositional_deconstruction": {
            "background": "; ".join(background_descriptions)
            or "A coherent background supporting the composition.",
            "elements": elements,
        },
    }


def build_ideogram_json(layout: dict[str, Any]) -> str:
    return json.dumps(
        build_ideogram_payload(layout),
        indent=2,
        ensure_ascii=False,
    )
