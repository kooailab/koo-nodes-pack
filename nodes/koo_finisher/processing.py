from __future__ import annotations

import json
import math
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch
import torch.nn.functional as F


PACKAGE_ROOT = Path(__file__).resolve().parent
CONFIG_DIR = PACKAGE_ROOT / "config"
SETTINGS_PATH = CONFIG_DIR / "settings.json"
LUT_EXTENSIONS = {".cube"}
_LUT_CACHE: dict[str, tuple[tuple[int, int], "CubeLUT"]] = {}
_LUMA = (0.2126, 0.7152, 0.0722)


@dataclass(frozen=True)
class CubeLUT:
    path: Path
    title: str | None
    size: int
    domain_min: torch.Tensor
    domain_max: torch.Tensor
    table: torch.Tensor


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
            handle.write("\n")
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def load_settings() -> dict[str, str]:
    path = _settings_path()
    if not path.exists():
        return {"lut_folder": ""}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"lut_folder": ""}
    folder = data.get("lut_folder")
    return {"lut_folder": str(folder) if folder else ""}


def save_settings(lut_folder: str) -> dict[str, str]:
    folder = str(lut_folder or "").strip().strip('"')
    payload = {"lut_folder": folder}
    _atomic_write_json(_settings_path(write=True), payload)
    return payload


def _settings_path(write: bool = False) -> Path:
    """Read legacy settings, but save new settings in namespaced ComfyUI user data."""
    try:
        import folder_paths
        getter = getattr(folder_paths, 'get_user_directory', None)
        if callable(getter):
            user = Path(getter()) / 'KoO/finisher/settings.json'
            if write or user.is_file():
                return user
    except (ImportError, AttributeError, OSError):
        pass
    return SETTINGS_PATH


def scan_lut_folder(lut_folder: str | None = None) -> dict[str, Any]:
    folder_text = load_settings().get("lut_folder", "") if lut_folder is None else str(lut_folder or "").strip()
    if not folder_text:
        return {"lut_folder": "", "exists": False, "luts": [], "status": "LUT folder not set"}

    root = Path(folder_text).expanduser()
    if not root.exists() or not root.is_dir():
        return {"lut_folder": folder_text, "exists": False, "luts": [], "status": "LUT folder not found"}

    luts: list[dict[str, str]] = []
    for path in sorted(root.rglob("*"), key=lambda item: str(item).lower()):
        if not path.is_file() or path.suffix.lower() not in LUT_EXTENSIONS:
            continue
        relative = path.relative_to(root)
        luts.append(
            {
                "name": " / ".join(relative.with_suffix("").parts),
                "relative_path": str(relative).replace("\\", "/"),
                "extension": path.suffix.lower(),
            }
        )
    status = f"{len(luts)} LUT{'s' if len(luts) != 1 else ''} found" if luts else "No .cube LUTs found"
    return {"lut_folder": folder_text, "exists": True, "luts": luts, "status": status}


def resolve_lut_path(lut_name: str) -> Path | None:
    name = str(lut_name or "").strip()
    if not name:
        return None
    scan = scan_lut_folder()
    if not scan["exists"]:
        return None
    root = Path(scan["lut_folder"]).expanduser()
    by_name = {item["name"]: item for item in scan["luts"]}
    item = by_name.get(name)
    if item:
        return (root / item["relative_path"]).resolve()

    normalized = name.replace("\\", "/").removesuffix(".cube")
    for candidate in scan["luts"]:
        if candidate["relative_path"].removesuffix(".cube") == normalized:
            return (root / candidate["relative_path"]).resolve()
    return None


def parse_cube_lut(path: str | Path) -> CubeLUT:
    lut_path = Path(path).resolve()
    stat = lut_path.stat()
    signature = (stat.st_mtime_ns, stat.st_size)
    cache_key = str(lut_path)
    cached = _LUT_CACHE.get(cache_key)
    if cached and cached[0] == signature:
        return cached[1]

    title: str | None = None
    size: int | None = None
    domain_min = [0.0, 0.0, 0.0]
    domain_max = [1.0, 1.0, 1.0]
    rows: list[list[float]] = []

    for line_number, raw_line in enumerate(lut_path.read_text(encoding="utf-8-sig", errors="replace").splitlines(), start=1):
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        keyword = parts[0].upper()
        try:
            if keyword == "TITLE":
                title = line.partition(" ")[2].strip().strip('"') or None
            elif keyword == "LUT_3D_SIZE":
                size = int(parts[1])
                if size < 2 or size > 256:
                    raise ValueError("size must be between 2 and 256")
            elif keyword == "DOMAIN_MIN":
                domain_min = [float(parts[1]), float(parts[2]), float(parts[3])]
            elif keyword == "DOMAIN_MAX":
                domain_max = [float(parts[1]), float(parts[2]), float(parts[3])]
            elif keyword in {"LUT_1D_SIZE", "LUT_1D_INPUT_RANGE"}:
                raise ValueError("1D LUTs are not supported")
            else:
                rows.append([float(parts[0]), float(parts[1]), float(parts[2])])
        except Exception as exc:
            raise ValueError(f"KoO Finisher: Invalid .cube at line {line_number}: {exc}") from exc

    if size is None:
        raise ValueError("KoO Finisher: Invalid .cube file, missing LUT_3D_SIZE")
    expected = size ** 3
    if len(rows) != expected:
        raise ValueError(f"KoO Finisher: Invalid .cube file, expected {expected} rows, found {len(rows)}")

    min_tensor = torch.tensor(domain_min, dtype=torch.float32)
    max_tensor = torch.tensor(domain_max, dtype=torch.float32)
    if torch.any(max_tensor <= min_tensor):
        raise ValueError("KoO Finisher: DOMAIN_MAX must be greater than DOMAIN_MIN")
    # .cube rows are conventionally ordered with red fastest, then green, then blue.
    # Reshape therefore yields [blue, green, red, rgb]; keep sampling code in [red, green, blue].
    table = (
        torch.tensor(rows, dtype=torch.float32)
        .reshape(size, size, size, 3)
        .permute(2, 1, 0, 3)
        .contiguous()
        .clamp(0.0, 1.0)
    )
    cube = CubeLUT(lut_path, title, size, min_tensor, max_tensor, table)
    _LUT_CACHE[cache_key] = (signature, cube)
    return cube


def apply_cube_lut(image: torch.Tensor, cube: CubeLUT, chunk_size: int = 1_000_000) -> torch.Tensor:
    original_dtype = image.dtype
    working = image.to(dtype=torch.float32)
    rgb = working[..., :3]
    flat = rgb.reshape(-1, 3)
    out = torch.empty_like(flat)
    table = cube.table.to(device=image.device, dtype=torch.float32)
    domain_min = cube.domain_min.to(device=image.device, dtype=torch.float32)
    domain_max = cube.domain_max.to(device=image.device, dtype=torch.float32)
    scale = (cube.size - 1) / (domain_max - domain_min)

    for start in range(0, flat.shape[0], chunk_size):
        end = min(start + chunk_size, flat.shape[0])
        coords = ((flat[start:end] - domain_min) * scale).clamp(0.0, cube.size - 1)
        lo = torch.floor(coords).to(torch.long)
        hi = torch.clamp(lo + 1, max=cube.size - 1)
        frac = coords - lo.to(coords.dtype)
        r0, g0, b0 = lo[:, 0], lo[:, 1], lo[:, 2]
        r1, g1, b1 = hi[:, 0], hi[:, 1], hi[:, 2]
        fr, fg, fb = frac[:, 0:1], frac[:, 1:2], frac[:, 2:3]
        c000 = table[r0, g0, b0]
        c100 = table[r1, g0, b0]
        c010 = table[r0, g1, b0]
        c110 = table[r1, g1, b0]
        c001 = table[r0, g0, b1]
        c101 = table[r1, g0, b1]
        c011 = table[r0, g1, b1]
        c111 = table[r1, g1, b1]
        c00 = c000 * (1.0 - fr) + c100 * fr
        c10 = c010 * (1.0 - fr) + c110 * fr
        c01 = c001 * (1.0 - fr) + c101 * fr
        c11 = c011 * (1.0 - fr) + c111 * fr
        c0 = c00 * (1.0 - fg) + c10 * fg
        c1 = c01 * (1.0 - fg) + c11 * fg
        out[start:end] = c0 * (1.0 - fb) + c1 * fb

    result_rgb = out.reshape(rgb.shape).clamp(0.0, 1.0)
    result = torch.cat([result_rgb, working[..., 3:]], dim=-1) if working.shape[-1] > 3 else result_rgb
    return result.to(dtype=original_dtype)


def apply_lut(image: torch.Tensor, lut_name: str, strength: int | float) -> torch.Tensor:
    amount = max(0.0, min(1.0, float(strength) / 100.0))
    if amount <= 0.0 or not str(lut_name or "").strip():
        return image
    lut_path = resolve_lut_path(lut_name)
    if lut_path is None:
        return image
    lut_result = apply_cube_lut(image, parse_cube_lut(lut_path))
    return lut_result if amount >= 1.0 else image * (1.0 - amount) + lut_result * amount


def _amount(value: int | float) -> float:
    return max(-1.0, min(1.0, float(value) / 100.0))


def _positive_amount(value: int | float) -> float:
    return max(0.0, min(1.0, float(value) / 100.0))


def _luminance(image: torch.Tensor) -> torch.Tensor:
    weights = torch.tensor(_LUMA, dtype=image.dtype, device=image.device)
    return (image[..., :3] * weights).sum(dim=-1, keepdim=True)


def _smoothstep(edge0: float, edge1: float, value: torch.Tensor) -> torch.Tensor:
    x = ((value - edge0) / max(1e-6, edge1 - edge0)).clamp(0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def _gaussian_kernel1d(sigma: float, device: torch.device, dtype: torch.dtype) -> torch.Tensor:
    radius = max(1, int(math.ceil(sigma * 3.0)))
    x = torch.arange(-radius, radius + 1, device=device, dtype=dtype)
    kernel = torch.exp(-(x * x) / (2.0 * sigma * sigma))
    return kernel / kernel.sum()


def _gaussian_blur(image: torch.Tensor, sigma: float) -> torch.Tensor:
    if image.shape[1] <= 1 and image.shape[2] <= 1:
        return image
    b, h, w, c = image.shape
    kernel = _gaussian_kernel1d(sigma, image.device, image.dtype)
    radius = kernel.numel() // 2
    work = image.permute(0, 3, 1, 2)
    kernel_x = kernel.view(1, 1, 1, -1).repeat(c, 1, 1, 1)
    kernel_y = kernel.view(1, 1, -1, 1).repeat(c, 1, 1, 1)
    if w > 1:
        work = F.conv2d(F.pad(work, (radius, radius, 0, 0), mode="replicate"), kernel_x, groups=c)
    if h > 1:
        work = F.conv2d(F.pad(work, (0, 0, radius, radius), mode="replicate"), kernel_y, groups=c)
    return work.permute(0, 2, 3, 1)


def _white_balance(image: torch.Tensor, temperature: int | float, tint: int | float) -> torch.Tensor:
    temp = _amount(temperature)
    magenta = _amount(tint)
    if temp == 0.0 and magenta == 0.0:
        return image
    temp_curve = abs(temp) ** 1.2
    gains = torch.tensor(
        [1.0 + 0.18 * temp + 0.03 * temp_curve, 1.0 + 0.015 * temp_curve - 0.12 * magenta, 1.0 - 0.18 * temp + 0.03 * temp_curve],
        dtype=image.dtype,
        device=image.device,
    )
    gains = gains * torch.tensor([1.0 + 0.04 * magenta, 1.0, 1.0 + 0.04 * magenta], dtype=image.dtype, device=image.device)
    normalizer = (gains * torch.tensor(_LUMA, dtype=image.dtype, device=image.device)).sum().clamp_min(1e-6)
    return image * (gains / normalizer)


def _highlights_shadows(image: torch.Tensor, highlights: int | float, shadows: int | float) -> torch.Tensor:
    out = image
    lum = _luminance(out)
    h = _amount(highlights)
    if h != 0.0:
        mask = _smoothstep(0.45, 0.92, lum)
        out = out + (1.0 - out) * (0.55 * h) * mask if h > 0.0 else out * (1.0 + 0.65 * h * mask)
    lum = _luminance(out)
    s = _amount(shadows)
    if s != 0.0:
        mask = 1.0 - _smoothstep(0.08, 0.58, lum)
        out = out + (1.0 - out) * (0.50 * s) * mask if s > 0.0 else out * (1.0 + 0.65 * s * mask)
    return out


def _tonal_ranges(image: torch.Tensor, midtones: int, whites: int, blacks: int) -> torch.Tensor:
    # Zero skips every operation, preserving legacy results bit for bit.
    out = image
    for name, value in (("midtones", midtones), ("whites", whites), ("blacks", blacks)):
        amount = _amount(value)
        if amount == 0.0:
            continue
        lum = _luminance(out)
        if name == "midtones":
            mask = _smoothstep(0.10, 0.40, lum) * (1.0 - _smoothstep(0.60, 0.90, lum))
        elif name == "whites":
            mask = _smoothstep(0.65, 1.0, lum)
        else:
            mask = 1.0 - _smoothstep(0.0, 0.35, lum)
        out = (out + 0.25 * amount * mask).clamp(0.0, 1.0)
    return out


def _contrast(image: torch.Tensor, contrast: int | float) -> torch.Tensor:
    c = _amount(contrast)
    if c == 0.0:
        return image
    lum = _luminance(image).clamp_min(1e-6)
    factor = 1.0 + (1.25 * c if c > 0.0 else 0.75 * c)
    adjusted_lum = (0.5 + (lum - 0.5) * factor).clamp(0.0, 1.0)
    return image * (adjusted_lum / lum).clamp(0.0, 8.0)


def _vibrance(image: torch.Tensor, vibrance: int | float) -> torch.Tensor:
    v = _amount(vibrance)
    if v == 0.0:
        return image
    lum = _luminance(image)
    saturation = (image.max(dim=-1, keepdim=True).values - image.min(dim=-1, keepdim=True).values).clamp(0.0, 1.0)
    factor = 1.0 + 0.85 * v * (1.0 - saturation).pow(1.4) if v > 0.0 else 1.0 + 0.65 * v * (1.0 - 0.35 * saturation)
    return lum + (image - lum) * factor


def _saturation(image: torch.Tensor, saturation: int | float) -> torch.Tensor:
    s = _amount(saturation)
    if s == 0.0:
        return image
    lum = _luminance(image)
    return lum + (image - lum) * (1.0 + s)


def _clarity(image: torch.Tensor, clarity: int | float) -> torch.Tensor:
    c = _amount(clarity)
    if c == 0.0:
        return image
    detail = image - _gaussian_blur(image, sigma=3.0)
    mid_mask = (1.0 - (_luminance(image) - 0.5).abs() * 1.7).clamp(0.0, 1.0)
    return image + detail * (1.15 * c) * mid_mask


def _sharpen(image: torch.Tensor, sharpen: int | float) -> torch.Tensor:
    amount = _positive_amount(sharpen)
    return image if amount == 0.0 else image + (image - _gaussian_blur(image, sigma=0.9)) * (0.85 * amount)


def _vignette(image: torch.Tensor, vignette: int | float) -> torch.Tensor:
    amount = _positive_amount(vignette)
    if amount == 0.0:
        return image
    _, h, w, _ = image.shape
    y = torch.linspace(-1.0, 1.0, h, dtype=image.dtype, device=image.device)
    x = torch.linspace(-1.0, 1.0, w, dtype=image.dtype, device=image.device)
    yy, xx = torch.meshgrid(y, x, indexing="ij")
    radius = torch.sqrt(xx * xx + yy * yy).unsqueeze(0).unsqueeze(-1)
    return image * (1.0 - 0.45 * amount * _smoothstep(0.35, 1.2, radius))


def _soft_lens(image: torch.Tensor, value: int | float) -> torch.Tensor:
    amount = _positive_amount(value)
    if amount == 0.0:
        return image
    response = amount ** 0.65
    radius = 1 + int(3 * response + 0.5)
    work = image.permute(0, 3, 1, 2)
    # Separable box average keeps the wider optical radius inexpensive.
    kernel = 2 * radius + 1
    local = F.avg_pool2d(F.pad(work, (radius, radius, 0, 0), mode="replicate"),
                         kernel_size=(1, kernel), stride=1)
    local = F.avg_pool2d(F.pad(local, (0, 0, radius, radius), mode="replicate"),
                         kernel_size=(kernel, 1), stride=1)
    detail = image - local.permute(0, 2, 3, 1)
    # Attenuate fine, low-contrast detail; large edges keep their original structure.
    structure = detail.abs().amax(dim=-1, keepdim=True)
    # Major edges retain at least 91% of their contrast even at maximum strength.
    mask = 1.0 - 0.90 * _smoothstep(0.06, 0.30, structure)
    return image - detail * mask * (0.90 * response)


CHROMATIC_MAX_PIXELS = 96.0


def _chromatic_pixels(height: int, width: int, value: int | float) -> float:
    return min(CHROMATIC_MAX_PIXELS, 0.025 * min(height, width)) * _positive_amount(value) ** 1.5


def _chromatic_aberration(image: torch.Tensor, value: int | float) -> torch.Tensor:
    amount = _positive_amount(value)
    if amount == 0.0:
        return image
    b, h, w, _ = image.shape
    dtype = image.dtype
    work = image.to(dtype=torch.float32)
    y = torch.linspace(-1.0, 1.0, h, device=image.device, dtype=work.dtype) if h > 1 else torch.zeros(1, device=image.device, dtype=work.dtype)
    x = torch.linspace(-1.0, 1.0, w, device=image.device, dtype=work.dtype) if w > 1 else torch.zeros(1, device=image.device, dtype=work.dtype)
    yy, xx = torch.meshgrid(y, x, indexing="ij")
    dx, dy = xx * ((w - 1) / 2), yy * ((h - 1) / 2)
    distance = (dx.square() + dy.square()).sqrt().clamp_min(1e-6)
    # Explicit pixel displacement: avoid an extra radius factor from scaling
    # coordinates. Elliptical frame radius protects the center on all aspects.
    radius = ((xx.square() + yy.square()) * 0.5).sqrt()
    pixels = _chromatic_pixels(h, w, value) * _smoothstep(0.10, 1.0, radius)
    offset_x = pixels * (dx / distance) * (2.0 / max(1, w - 1))
    offset_y = pixels * (dy / distance) * (2.0 / max(1, h - 1))
    red_grid = torch.stack((xx + offset_x, yy + offset_y), dim=-1)
    blue_grid = torch.stack((xx - offset_x, yy - offset_y), dim=-1)
    red = F.grid_sample(work[..., 0:1].permute(0, 3, 1, 2), red_grid.unsqueeze(0).expand(b, -1, -1, -1),
                        mode="bilinear", padding_mode="border", align_corners=True)
    blue = F.grid_sample(work[..., 2:3].permute(0, 3, 1, 2), blue_grid.unsqueeze(0).expand(b, -1, -1, -1),
                         mode="bilinear", padding_mode="border", align_corners=True)
    return torch.cat((red.permute(0, 2, 3, 1), work[..., 1:2], blue.permute(0, 2, 3, 1)), dim=-1).to(dtype=dtype)


def _grain(image: torch.Tensor, grain: int | float) -> torch.Tensor:
    amount = _positive_amount(grain)
    if amount == 0.0:
        return image
    tone_mask = (1.0 - (_luminance(image) - 0.5).abs() * 1.25).clamp(0.25, 1.0)
    noise = torch.randn((*image.shape[:-1], 1), dtype=image.dtype, device=image.device)
    return image + noise * (0.035 * amount) * tone_mask


def _int_setting(settings: dict[str, Any], name: str, default: int = 0) -> int:
    return int(settings.get(name, default) or default)


def _srgb_to_linear(image: torch.Tensor) -> torch.Tensor:
    # Clamp only the unused power branch to avoid NaNs for negative inputs.
    return torch.where(image <= 0.04045, image / 12.92,
                       ((image + 0.055).clamp_min(0.0) / 1.055).pow(2.4))


def _linear_to_srgb(image: torch.Tensor) -> torch.Tensor:
    return torch.where(image <= 0.0031308, image * 12.92,
                       1.055 * image.clamp_min(0.0).pow(1.0 / 2.4) - 0.055)


def _exposure(image: torch.Tensor, ev: float) -> torch.Tensor:
    # Standard ComfyUI image producers supply display RGB, not linear light.
    # Zero avoids transfer round-trip error; highlights are clipped by the
    # existing display-domain finishing stage only after re-encoding.
    if ev == 0.0:
        return image
    return _linear_to_srgb(_srgb_to_linear(image) * (2.0 ** ev))


def apply_finishing(image: torch.Tensor, settings: dict[str, Any]) -> torch.Tensor:
    if bool(settings.get("bypass", False)):
        return image
    if image.ndim != 4 or image.shape[-1] < 3:
        raise ValueError("KoO Finisher: Expected ComfyUI IMAGE tensor shaped [B, H, W, C]")

    original_dtype = image.dtype
    rgb = image[..., :3].to(dtype=torch.float32)
    extra = image[..., 3:] if image.shape[-1] > 3 else None

    rgb = _exposure(rgb, float(settings.get("exposure", 0.0) or 0.0))
    rgb = _highlights_shadows(rgb.clamp(0.0, 1.0), _int_setting(settings, "highlights"), _int_setting(settings, "shadows"))
    rgb = _tonal_ranges(rgb, _int_setting(settings, "midtones"), _int_setting(settings, "whites"), _int_setting(settings, "blacks"))
    rgb = _contrast(rgb.clamp(0.0, 1.0), _int_setting(settings, "contrast"))
    rgb = _white_balance(rgb.clamp(0.0, 1.0), _int_setting(settings, "temperature"), _int_setting(settings, "tint"))
    rgb = _vibrance(rgb.clamp(0.0, 1.0), _int_setting(settings, "vibrance"))
    rgb = _saturation(rgb.clamp(0.0, 1.0), _int_setting(settings, "saturation"))
    rgb = _clarity(rgb.clamp(0.0, 1.0), _int_setting(settings, "clarity"))
    rgb = _sharpen(rgb.clamp(0.0, 1.0), _int_setting(settings, "sharpen"))
    if _int_setting(settings, "soft_lens"):
        rgb = _soft_lens(rgb.clamp(0.0, 1.0), _int_setting(settings, "soft_lens"))
    rgb = apply_lut(rgb.clamp(0.0, 1.0), str(settings.get("lut", settings.get("lut_name", "")) or ""), float(settings.get("lut_strength", settings.get("lutStrength", 100)) or 0))
    rgb = _vignette(rgb.clamp(0.0, 1.0), _int_setting(settings, "vignette"))
    if _int_setting(settings, "chromatic_aberration"):
        rgb = _chromatic_aberration(rgb.clamp(0.0, 1.0), _int_setting(settings, "chromatic_aberration"))
    rgb = _grain(rgb.clamp(0.0, 1.0), _int_setting(settings, "grain"))
    rgb = torch.nan_to_num(rgb, nan=0.0, posinf=1.0, neginf=0.0).clamp(0.0, 1.0).to(dtype=original_dtype)

    return torch.cat([rgb, extra], dim=-1) if extra is not None else rgb
