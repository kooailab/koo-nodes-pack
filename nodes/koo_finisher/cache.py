from __future__ import annotations

import io
import os
import re
import subprocess
import sys
import time
import uuid
from collections import OrderedDict
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

import folder_paths

from .processing import apply_finishing


_SOURCE_CACHE: "OrderedDict[str, dict[str, Any]]" = OrderedDict()
_NODE_CACHE_IDS: dict[str, str] = {}
_MAX_CACHE_ENTRIES = 32


def _safe_node(value: str | int | None) -> str:
    return re.sub(r"[^A-Za-z0-9_.:-]+", "_", str(value or "node"))


def _safe_prefix(value: str) -> str:
    prefix = str(value or "KoO_Finisher").strip() or "KoO_Finisher"
    prefix = prefix.replace("\\", "_").replace("/", "_")
    prefix = re.sub(r"[^A-Za-z0-9_. -]+", "_", prefix).strip(" .")
    return prefix or "KoO_Finisher"


def default_output_folder() -> str:
    return str(Path(folder_paths.get_output_directory()).resolve())


def _resolve_output_folder(value: str | None) -> Path:
    raw = str(value or "").strip().strip('"')
    path = Path(raw).expanduser() if raw else Path(default_output_folder())
    if raw and not path.is_absolute():
        raise ValueError("KoO Finisher: output folder must be an absolute path")
    try:
        path.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        raise ValueError(f"KoO Finisher: could not create output folder: {path}") from exc
    if not path.is_dir():
        raise ValueError(f"KoO Finisher: output folder is not a directory: {path}")
    try:
        probe = path / f".koo_finisher_write_test_{time.time_ns()}.tmp"
        probe.write_bytes(b"")
        probe.unlink(missing_ok=True)
    except Exception as exc:
        raise PermissionError(f"KoO Finisher: output folder is not writable: {path}") from exc
    return path.resolve()


def _next_output_path(folder: Path, prefix: str, extension: str) -> Path:
    for counter in range(1, 100000):
        path = folder / f"{prefix}_{counter:05}.{extension}"
        if not path.exists():
            return path
    raise RuntimeError("KoO Finisher: could not find an unused output filename")


def _tensor_to_pil(image: torch.Tensor) -> Image.Image:
    if image.ndim != 3 or image.shape[-1] < 3:
        raise ValueError("KoO Finisher: Expected image shaped [H, W, C]")
    array = (image[..., :3].detach().cpu().float().clamp(0.0, 1.0).numpy() * 255.0).round().astype(np.uint8)
    return Image.fromarray(array, mode="RGB")


def _png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _preview_tensor(source: torch.Tensor, max_size: int) -> torch.Tensor:
    max_size = max(128, min(int(max_size or 1200), 4096))
    _, h, w, _ = source.shape
    scale = min(1.0, max_size / max(h, w))
    if scale >= 1.0:
        return source
    size = (max(1, round(h * scale)), max(1, round(w * scale)))
    work = source.permute(0, 3, 1, 2)
    resized = F.interpolate(work, size=size, mode="bilinear", align_corners=False)
    return resized.permute(0, 2, 3, 1).contiguous()


def cache_source_image(image: torch.Tensor, node_id: str | int | None) -> dict[str, Any]:
    if image.ndim != 4 or image.shape[-1] < 3:
        raise ValueError("KoO Finisher: Expected ComfyUI IMAGE tensor shaped [B, H, W, C]")

    node_key = _safe_node(node_id)
    # Node IDs are reused across workflows. Keep earlier execution references in
    # the bounded LRU so returning to a workflow can restore its own preview.

    cache_id = f"{node_key}-{uuid.uuid4().hex}"
    source = image.detach().cpu().clone()
    _SOURCE_CACHE[cache_id] = {"image": source, "node_id": node_key, "created": time.time()}
    _NODE_CACHE_IDS[node_key] = cache_id

    while len(_SOURCE_CACHE) > _MAX_CACHE_ENTRIES:
        old_cache_id, old_entry = _SOURCE_CACHE.popitem(last=False)
        old_node = old_entry.get("node_id")
        if _NODE_CACHE_IDS.get(old_node) == old_cache_id:
            _NODE_CACHE_IDS.pop(old_node, None)

    _, height, width, channels = source.shape
    print(f"[KOO FINISHER] Source cached: {cache_id}")
    return {
        "cache_id": cache_id,
        "node_id": node_key,
        "width": int(width),
        "height": int(height),
        "channels": int(channels),
        "count": int(source.shape[0]),
    }


def get_cached_source(cache_id: str) -> torch.Tensor:
    key = str(cache_id or "")
    entry = _SOURCE_CACHE.get(key)
    if not entry:
        raise KeyError("KoO Finisher: source cache not found. Run workflow to load source image.")
    _SOURCE_CACHE.move_to_end(key)
    return entry["image"]


def render_preview(cache_id: str, settings: dict[str, Any], max_size: int = 1200, index: int = 0, original: bool = False) -> bytes:
    print("[KOO FINISHER] Preview request")
    source = get_cached_source(cache_id)
    index = max(0, min(int(index or 0), source.shape[0] - 1))
    preview = _preview_tensor(source[index : index + 1], max_size)
    finished = preview if original else apply_finishing(preview, settings)
    return _png_bytes(_tensor_to_pil(finished[0]))


def save_finished_image(payload: dict[str, Any]) -> dict[str, Any]:
    cache_id = str(payload.get("cache_id", "") or payload.get("source_cache_id", ""))
    source = get_cached_source(cache_id)
    settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
    finished = apply_finishing(source, settings)

    fmt = str(payload.get("format", "PNG") or "PNG").upper()
    if fmt == "JPEG":
        fmt = "JPG"
    if fmt not in {"PNG", "JPG", "WEBP"}:
        raise ValueError("KoO Finisher: format must be PNG, JPG, or WEBP")

    quality = max(1, min(100, int(payload.get("quality", 95) or 95)))
    prefix = _safe_prefix(str(payload.get("filename_prefix", "KoO_Finisher")))
    output_folder = _resolve_output_folder(str(payload.get("output_folder", "") or ""))
    extension = "jpg" if fmt == "JPG" else fmt.lower()

    files = []
    for batch_number, image in enumerate(finished):
        pil = _tensor_to_pil(image)
        batch_prefix = prefix.replace("%batch_num%", str(batch_number))
        path = _next_output_path(output_folder, batch_prefix, extension)
        if fmt == "PNG":
            pil.save(path, format="PNG", compress_level=4)
        elif fmt == "JPG":
            pil.save(path, format="JPEG", quality=quality, subsampling=0, optimize=True)
        else:
            pil.save(path, format="WEBP", quality=quality, method=6)
        print(f"[KOO FINISHER] Direct save: {path.name}")
        files.append({"filename": path.name, "subfolder": "", "type": "custom", "format": fmt, "path": str(path), "output_folder": str(output_folder)})

    return {"ok": True, "files": files, "count": len(files)}


def open_output_folder(value: str | None) -> dict[str, Any]:
    folder = _resolve_output_folder(value)
    try:
        if sys.platform.startswith("win"):
            os.startfile(str(folder))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(folder)], shell=False)
        else:
            subprocess.Popen(["xdg-open", str(folder)], shell=False)
    except Exception as exc:
        raise RuntimeError(f"KoO Finisher: could not open output folder: {folder}") from exc
    return {"ok": True, "output_folder": str(folder)}


def select_output_folder(value: str | None) -> dict[str, Any]:
    raw = str(value or "").strip().strip('"')
    initial = Path(raw).expanduser() if raw else Path(default_output_folder())
    if not initial.exists() or not initial.is_dir():
        initial = Path(default_output_folder())
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(initialdir=str(initial), title="Select KoO Finisher Output Folder", mustexist=False)
        root.destroy()
    except Exception as exc:
        raise RuntimeError(f"KoO Finisher: native folder picker failed: {exc}") from exc

    if not selected:
        return {"ok": True, "cancelled": True, "output_folder": str(initial.resolve())}
    folder = _resolve_output_folder(selected)
    return {"ok": True, "cancelled": False, "output_folder": str(folder)}
