import json
import math

import torch


PADDING_MODES = ["reflect", "edge", "black"]
BLEND_MODES = ["linear", "cosine", "none"]


def _to_first_image(image):
    """Return a single HWC image tensor from a ComfyUI IMAGE tensor."""
    if not torch.is_tensor(image):
        raise TypeError("image must be a torch.Tensor")

    if image.dim() == 4:
        if image.shape[0] < 1:
            raise ValueError("image batch is empty")
        return image[0]

    if image.dim() == 3:
        return image

    raise ValueError("image must have shape [batch, height, width, channels] or [height, width, channels]")


def _validate_image_hwc(image, name):
    if not torch.is_tensor(image):
        raise TypeError(f"{name} must be a torch.Tensor")
    if image.dim() != 3:
        raise ValueError(f"{name} must have shape [height, width, channels]")
    if image.shape[0] < 1 or image.shape[1] < 1 or image.shape[2] < 1:
        raise ValueError(f"{name} must have non-empty height, width, and channels")


def _validate_tile_settings(tile_size, overlap, feather):
    tile_size = int(tile_size)
    overlap = int(overlap)
    feather = int(feather)

    if tile_size <= 0:
        raise ValueError("tile_size must be greater than 0")
    if overlap < 0:
        raise ValueError("overlap must be 0 or greater")
    if overlap >= tile_size:
        raise ValueError("overlap must be smaller than tile_size")
    if feather < 0:
        raise ValueError("feather must be 0 or greater")

    return tile_size, overlap, min(feather, tile_size // 2)


def _tile_positions(length, tile_size, stride):
    if length <= tile_size:
        return [0], tile_size

    count = int(math.ceil((length - tile_size) / stride)) + 1
    padded_length = (count - 1) * stride + tile_size
    return [i * stride for i in range(count)], padded_length


def _reflect_indices(length, padded_length, device):
    if length == 1:
        return torch.zeros((padded_length,), dtype=torch.long, device=device)

    idx = torch.arange(padded_length, dtype=torch.long, device=device)
    period = 2 * length - 2
    idx = idx.remainder(period)
    return torch.where(idx < length, idx, period - idx)


def _edge_indices(length, padded_length, device):
    return torch.arange(padded_length, dtype=torch.long, device=device).clamp(max=length - 1)


def _pad_image(image, padded_height, padded_width, padding_mode):
    _validate_image_hwc(image, "image")

    height, width, channels = image.shape
    if padding_mode not in PADDING_MODES:
        raise ValueError(f"Unsupported padding_mode '{padding_mode}'")

    if padding_mode == "black":
        padded = image.new_zeros((padded_height, padded_width, channels))
        padded[:height, :width, :] = image
        return padded

    if padding_mode == "reflect":
        y_idx = _reflect_indices(height, padded_height, image.device)
        x_idx = _reflect_indices(width, padded_width, image.device)
    else:
        y_idx = _edge_indices(height, padded_height, image.device)
        x_idx = _edge_indices(width, padded_width, image.device)

    return image.index_select(0, y_idx).index_select(1, x_idx)


def _make_weight_mask(tile_size, feather, blend_mode, device, dtype):
    if blend_mode == "none" or feather <= 0:
        return torch.ones((tile_size, tile_size, 1), device=device, dtype=dtype)

    feather = min(int(feather), tile_size // 2)
    weights = torch.ones((tile_size,), device=device, dtype=dtype)

    ramp = torch.linspace(0.0, 1.0, feather + 2, device=device, dtype=dtype)[1:-1]
    if blend_mode == "cosine":
        ramp = 0.5 - 0.5 * torch.cos(ramp * math.pi)

    weights[:feather] = ramp
    weights[-feather:] = torch.flip(ramp, dims=[0])

    mask = weights[:, None] * weights[None, :]
    return mask.unsqueeze(-1).clamp_min(torch.finfo(dtype).eps)


def _color_match_to_canvas(tile, canvas_region, weight_region):
    overlap_mask = (weight_region > 0).squeeze(-1)
    if overlap_mask.sum().item() < 16:
        return tile

    channels_to_match = min(3, tile.shape[-1])
    source = tile[..., :channels_to_match][overlap_mask]
    target = (canvas_region[..., :channels_to_match] / weight_region.clamp_min(1.0e-8))[overlap_mask]

    source_mean = source.mean(dim=0)
    target_mean = target.mean(dim=0)
    source_std = source.std(dim=0).clamp_min(1.0e-6)
    target_std = target.std(dim=0).clamp_min(1.0e-6)

    matched = tile.clone()
    matched[..., :channels_to_match] = (
        (matched[..., :channels_to_match] - source_mean) / source_std * target_std + target_mean
    )
    return matched


def _metadata_from_json(metadata):
    if isinstance(metadata, (bytes, bytearray)):
        metadata = metadata.decode("utf-8")
    if not isinstance(metadata, str):
        raise TypeError("metadata must be a JSON string")

    try:
        data = json.loads(metadata)
    except json.JSONDecodeError as exc:
        raise ValueError(f"metadata is not valid JSON: {exc}") from exc

    required = [
        "original_width",
        "original_height",
        "padded_width",
        "padded_height",
        "tile_size",
        "overlap",
        "feather",
        "tiles",
        "padding",
    ]
    missing = [key for key in required if key not in data]
    if missing:
        raise ValueError(f"metadata is missing required keys: {', '.join(missing)}")

    return data


class KoOTileSplitter:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "tile_size": ("INT", {"default": 512, "min": 128, "max": 2048, "step": 64}),
                "overlap": ("INT", {"default": 96, "min": 0, "max": 512, "step": 16}),
                "padding_mode": (PADDING_MODES,),
                "feather": ("INT", {"default": 48, "min": 0, "max": 256, "step": 8}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("tiles", "metadata")
    FUNCTION = "split"
    CATEGORY = "KoO/Magnific"

    def split(self, image, tile_size=512, overlap=96, padding_mode="reflect", feather=48):
        image = _to_first_image(image)
        _validate_image_hwc(image, "image")
        tile_size, overlap, feather = _validate_tile_settings(tile_size, overlap, feather)

        if padding_mode not in PADDING_MODES:
            raise ValueError(f"Unsupported padding_mode '{padding_mode}'")

        original_height, original_width, channels = image.shape
        stride = tile_size - overlap
        x_positions, padded_width = _tile_positions(original_width, tile_size, stride)
        y_positions, padded_height = _tile_positions(original_height, tile_size, stride)
        padded = _pad_image(image, padded_height, padded_width, padding_mode)

        tile_tensors = []
        tile_metadata = []

        for y in y_positions:
            for x in x_positions:
                tile = padded[y : y + tile_size, x : x + tile_size, :]
                if tile.shape != (tile_size, tile_size, channels):
                    raise RuntimeError("internal tiling error produced a tile with the wrong shape")

                crop_x0 = min(max(x, 0), original_width)
                crop_y0 = min(max(y, 0), original_height)
                crop_x1 = min(max(x + tile_size, 0), original_width)
                crop_y1 = min(max(y + tile_size, 0), original_height)

                tile_tensors.append(tile)
                tile_metadata.append(
                    {
                        "index": len(tile_metadata),
                        "x": int(x),
                        "y": int(y),
                        "tile_coords": [int(x), int(y), int(x + tile_size), int(y + tile_size)],
                        "crop_coords": [int(crop_x0), int(crop_y0), int(crop_x1), int(crop_y1)],
                    }
                )

        metadata = {
            "version": 1,
            "original_width": int(original_width),
            "original_height": int(original_height),
            "channels": int(channels),
            "padded_width": int(padded_width),
            "padded_height": int(padded_height),
            "tile_size": int(tile_size),
            "overlap": int(overlap),
            "stride": int(stride),
            "feather": int(feather),
            "padding_mode": padding_mode,
            "padding": {
                "mode": padding_mode,
                "left": 0,
                "top": 0,
                "right": int(padded_width - original_width),
                "bottom": int(padded_height - original_height),
            },
            "tile_count": len(tile_tensors),
            "tiles": tile_metadata,
            "note": "If the input IMAGE batch had more than one item, only the first image was tiled.",
        }

        return (torch.stack(tile_tensors, dim=0).clamp(0.0, 1.0), json.dumps(metadata))


class KoOTileMerger:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "tiles": ("IMAGE",),
                "metadata": ("STRING", {"forceInput": True}),
                "blend_mode": (BLEND_MODES,),
                "color_match": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "merge"
    CATEGORY = "KoO/Magnific"

    def merge(self, tiles, metadata, blend_mode="linear", color_match=True):
        if not torch.is_tensor(tiles):
            raise TypeError("tiles must be a torch.Tensor")
        if tiles.dim() != 4:
            raise ValueError("tiles must have shape [batch, height, width, channels]")
        if blend_mode not in BLEND_MODES:
            raise ValueError(f"Unsupported blend_mode '{blend_mode}'")

        data = _metadata_from_json(metadata)
        tile_size = int(data["tile_size"])
        feather = int(data.get("feather", 0))
        padded_width = int(data["padded_width"])
        padded_height = int(data["padded_height"])
        original_width = int(data["original_width"])
        original_height = int(data["original_height"])
        tile_infos = data["tiles"]

        if len(tile_infos) != tiles.shape[0]:
            raise ValueError(f"tile count mismatch: metadata expects {len(tile_infos)}, got {tiles.shape[0]}")
        if tiles.shape[1] != tile_size or tiles.shape[2] != tile_size:
            raise ValueError(
                f"tile size mismatch: metadata expects {tile_size}x{tile_size}, "
                f"got {tiles.shape[1]}x{tiles.shape[2]}"
            )

        channels = int(data.get("channels", tiles.shape[-1]))
        if channels != tiles.shape[-1]:
            raise ValueError(f"channel mismatch: metadata expects {channels}, got {tiles.shape[-1]}")

        canvas = tiles.new_zeros((padded_height, padded_width, channels))
        weight_sum = tiles.new_zeros((padded_height, padded_width, 1))
        base_weight = _make_weight_mask(tile_size, feather, blend_mode, tiles.device, tiles.dtype)

        for index, tile_info in enumerate(tile_infos):
            x = int(tile_info["x"])
            y = int(tile_info["y"])
            if x < 0 or y < 0 or x + tile_size > padded_width or y + tile_size > padded_height:
                raise ValueError(f"tile {index} coordinates are outside the padded image")

            tile = tiles[index].clamp(0.0, 1.0)
            region = canvas[y : y + tile_size, x : x + tile_size, :]
            weights_region = weight_sum[y : y + tile_size, x : x + tile_size, :]

            if color_match and blend_mode != "none":
                tile = _color_match_to_canvas(tile, region, weights_region).clamp(0.0, 1.0)

            if blend_mode == "none":
                canvas[y : y + tile_size, x : x + tile_size, :] = tile
                weight_sum[y : y + tile_size, x : x + tile_size, :] = 1.0
            else:
                canvas[y : y + tile_size, x : x + tile_size, :] += tile * base_weight
                weight_sum[y : y + tile_size, x : x + tile_size, :] += base_weight

        merged = canvas / weight_sum.clamp_min(torch.finfo(tiles.dtype).eps)
        merged = merged[:original_height, :original_width, :].clamp(0.0, 1.0)
        return (merged.unsqueeze(0),)


NODE_CLASS_MAPPINGS = {
    "KoOTileSplitter": KoOTileSplitter,
    "KoOTileMerger": KoOTileMerger,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KoOTileSplitter": "KoO Tile Splitter",
    "KoOTileMerger": "KoO Tile Merger",
}


def self_test():
    """Manual smoke test: split and merge a tensor, then verify shape and reconstruction."""
    image = torch.rand((1, 317, 529, 3), dtype=torch.float32)
    splitter = KoOTileSplitter()
    merger = KoOTileMerger()

    tiles, metadata = splitter.split(image, tile_size=128, overlap=32, padding_mode="reflect", feather=16)
    merged = merger.merge(tiles, metadata, blend_mode="linear", color_match=False)[0]

    if merged.shape != image.shape:
        raise AssertionError(f"Expected merged shape {tuple(image.shape)}, got {tuple(merged.shape)}")

    max_error = (merged - image).abs().max().item()
    if max_error > 1.0e-5:
        raise AssertionError(f"Split/merge reconstruction error is too high: {max_error}")

    return {"tiles": int(tiles.shape[0]), "shape": tuple(merged.shape), "max_error": max_error}


if __name__ == "__main__":
    print(self_test())
