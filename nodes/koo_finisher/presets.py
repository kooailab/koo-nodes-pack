"""Portable look-only Finisher presets in ComfyUI user data."""
from __future__ import annotations

import json
import math
import re
import uuid
from pathlib import Path

from .processing import _atomic_write_json, resolve_lut_path

SCHEMA_VERSION = 2
FINISHER_VERSION = "1.0.2"
LIMIT = 65536
DEFAULTS = {"lut": "", "lut_strength": 100, "exposure": 0.0,
            **dict.fromkeys(("contrast", "highlights", "midtones", "shadows", "whites", "blacks",
                             "temperature", "tint", "vibrance", "saturation", "clarity", "sharpen",
                             "soft_lens", "vignette", "chromatic_aberration", "grain"), 0)}
POSITIVE = {"lut_strength", "sharpen", "soft_lens", "vignette", "chromatic_aberration", "grain"}


def preset_directory() -> Path:
    import folder_paths
    getter = getattr(folder_paths, "get_user_directory", None)
    if callable(getter):
        user = Path(getter())
    elif getattr(folder_paths, "base_path", None):
        user = Path(folder_paths.base_path) / "user"
    else:
        raise ValueError("ComfyUI user directory is unavailable")
    return user / "KoO" / "finisher" / "presets"


def _path(preset_id: str) -> Path:
    if not isinstance(preset_id, str) or not re.fullmatch(r"[0-9a-f]{32}", preset_id):
        raise ValueError("Invalid preset ID")
    directory = preset_directory().resolve()
    path = directory / f"{preset_id}.json"
    if path.is_symlink() or not path.resolve().is_relative_to(directory):
        raise ValueError("Unsafe preset path")
    return path


def _name(value) -> str:
    if not isinstance(value, str):
        raise ValueError("Preset name must be text")
    value = value.strip()
    if not value or len(value) > 80 or value in {".", ".."} or re.search(r'[\x00-\x1f<>:"/\\|?*]', value):
        raise ValueError("Use a preset name of 1–80 characters without path separators")
    return value


def validate_preset(data) -> dict:
    if not isinstance(data, dict) or type(data.get("schema_version")) is not int or data["schema_version"] != SCHEMA_VERSION:
        raise ValueError(f"Unsupported preset schema_version; expected {SCHEMA_VERSION}")
    if not isinstance(data.get("settings"), dict):
        raise ValueError("Preset settings must be an object")
    settings = dict(DEFAULTS)
    for key, default in DEFAULTS.items():
        if key not in data["settings"]:
            continue
        value = data["settings"][key]
        if key == "lut":
            if not isinstance(value, str) or len(value) > 512:
                raise ValueError("LUT reference must be a portable name")
            value = value.strip().replace("\\", "/")
            if value.startswith("/") or ":" in value or any(part.strip() == ".." for part in value.split("/")):
                raise ValueError("Absolute or parent-relative LUT paths are not portable")
        else:
            if type(value) not in (int, float) or (type(value) is float and not math.isfinite(value)):
                raise ValueError(f"Invalid numeric setting: {key}")
            low, high = (-5, 5) if key == "exposure" else ((0, 100) if key in POSITIVE else (-100, 100))
            value = max(low, min(high, value))
            value = float(value) if key == "exposure" else int(value)
        settings[key] = value
    return {"schema_version": SCHEMA_VERSION, "name": _name(data.get("name")),
            "finisher_version": FINISHER_VERSION, "settings": settings}


def list_presets() -> list[dict]:
    directory = preset_directory()
    if not directory.is_dir():
        return []
    result = []
    for path in directory.glob("*.json"):
        try:
            preset = load_preset(path.stem)
            result.append({"id": path.stem, "name": preset["name"]})
        except (ValueError, OSError):
            continue
    return sorted(result, key=lambda item: (item["name"].casefold(), item["id"]))


def load_preset(preset_id: str) -> dict:
    path = _path(preset_id)
    if path.stat().st_size > LIMIT:
        raise ValueError("Preset JSON is too large")
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (ValueError, UnicodeError) as exc:
        raise ValueError("Malformed preset JSON") from exc
    return validate_preset(data)


def _available_name(name: str) -> str:
    used = {item["name"].casefold() for item in list_presets()}
    candidate, suffix = name, 2
    while candidate.casefold() in used:
        ending = f" ({suffix})"
        candidate = name[:80-len(ending)] + ending
        suffix += 1
    return candidate


def save_preset(name: str, settings: dict, preset_id: str | None = None) -> tuple[str, dict]:
    preset = validate_preset({"schema_version": SCHEMA_VERSION, "name": name, "settings": settings})
    if preset_id:
        load_preset(preset_id)
        if any(item["id"] != preset_id and item["name"].casefold() == preset["name"].casefold() for item in list_presets()):
            raise ValueError("A preset with this name already exists")
    else:
        preset_id = uuid.uuid4().hex
        preset["name"] = _available_name(preset["name"])
    _atomic_write_json(_path(preset_id), preset)
    return preset_id, preset


def rename_preset(preset_id: str, name: str) -> tuple[str, dict]:
    return save_preset(name, load_preset(preset_id)["settings"], preset_id)


def delete_preset(preset_id: str) -> None:
    _path(preset_id).unlink()


def import_preset(text: str) -> tuple[str, dict]:
    if not isinstance(text, str) or len(text.encode("utf-8")) > LIMIT:
        raise ValueError("Preset JSON is too large")
    try:
        preset = validate_preset(json.loads(text.lstrip("\ufeff")))
    except (ValueError, TypeError) as exc:
        raise ValueError(f"Invalid preset: {exc}") from exc
    return save_preset(preset["name"], preset["settings"])


def export_preset(preset_id: str) -> str:
    return json.dumps(load_preset(preset_id), ensure_ascii=False, indent=2) + "\n"


def preset_payload(preset_id: str) -> dict:
    preset = load_preset(preset_id)
    lut = preset["settings"]["lut"]
    return {"ok": True, "id": preset_id, "preset": preset,
            "missing_lut": bool(lut and resolve_lut_path(lut) is None)}
