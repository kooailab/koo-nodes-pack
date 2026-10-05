import hashlib
import os

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image, ImageOps, ImageSequence

import folder_paths
import node_helpers

try:
    import comfy.model_management
except Exception as exc:
    comfy = None
    print(f"[KoO Nodes] Optional comfy.model_management import failed; using CPU fallback: {exc}")

try:
    from comfy_api.latest import InputImpl
except Exception as exc:
    InputImpl = None
    print(f"[KoO Nodes] Optional comfy_api.latest import failed; upload helpers are limited: {exc}")


MAX_RESOLUTION = 16384
OPTIMIZE_LONG_SIDE_VALUES = ["Off", "512", "768", "1024", "1344", "1536", "1920", "2048"]


def _intermediate_dtype():
    if comfy is not None:
        return comfy.model_management.intermediate_dtype()
    return torch.float32


def _intermediate_device():
    if comfy is not None:
        return comfy.model_management.intermediate_device()
    return torch.device("cpu")


def _normalize_crop(x, y, width, height, image_width, image_height, enabled):
    if not enabled or width <= 0 or height <= 0:
        return 0, 0, int(image_width), int(image_height)

    x0 = max(0, min(int(x), int(image_width) - 1))
    y0 = max(0, min(int(y), int(image_height) - 1))
    x1 = max(0, min(int(x) + int(width), int(image_width)))
    y1 = max(0, min(int(y) + int(height), int(image_height)))

    left = min(x0, x1)
    top = min(y0, y1)
    right = max(x0, x1)
    bottom = max(y0, y1)

    if right <= left:
        right = min(int(image_width), left + 1)
    if bottom <= top:
        bottom = min(int(image_height), top + 1)

    return left, top, max(1, right - left), max(1, bottom - top)


def _crop_mask(mask, x, y, width, height, batch_size, dtype, device):
    if mask is None:
        return torch.zeros((batch_size, height, width), dtype=dtype, device=device)

    if len(mask.shape) == 2:
        mask = mask.unsqueeze(0)

    if mask.shape[-2] < y + height or mask.shape[-1] < x + width:
        return torch.zeros((batch_size, height, width), dtype=dtype, device=device)

    return mask[:, y:y + height, x:x + width].to(device=device, dtype=dtype)


def _resize_to_long_side(image, mask, optimize_long_side):
    if str(optimize_long_side) == "Off":
        return image, mask

    target_long_side = int(optimize_long_side)
    height = int(image.shape[1])
    width = int(image.shape[2])
    current_long_side = max(width, height)
    if current_long_side <= 0 or current_long_side == target_long_side:
        return image, mask

    scale = target_long_side / current_long_side
    new_width = max(1, round(width * scale))
    new_height = max(1, round(height * scale))

    image_chw = image.movedim(-1, 1)
    resized_image = F.interpolate(image_chw, size=(new_height, new_width), mode="bilinear", align_corners=False)
    resized_image = resized_image.movedim(1, -1)

    if mask is not None:
        resized_mask = F.interpolate(mask.unsqueeze(1), size=(new_height, new_width), mode="bilinear", align_corners=False).squeeze(1)
    else:
        resized_mask = None

    return resized_image, resized_mask


class KooLoadImageCrop:
    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        files = folder_paths.filter_files_content_types(files, ["image"])
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
                "optimize_long_side": (OPTIMIZE_LONG_SIDE_VALUES, {"default": "Off"}),
                "crop_x": ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 1, "advanced": True}),
                "crop_y": ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 1, "advanced": True}),
                "crop_width": ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 1, "advanced": True}),
                "crop_height": ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 1, "advanced": True}),
                "crop_enabled": ("BOOLEAN", {"default": False, "advanced": True}),
                "crop_confirmed": ("BOOLEAN", {"default": False, "advanced": True}),
            },
        }

    CATEGORY = "KoO Tools / Image"
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "INT", "INT", "STRING", "INT", "INT", "INT", "INT")
    RETURN_NAMES = (
        "image",
        "mask",
        "crop_x",
        "crop_y",
        "crop_width",
        "crop_height",
        "crop_label",
        "original_width",
        "original_height",
        "cropped_width",
        "cropped_height",
    )
    FUNCTION = "load_image"
    DESCRIPTION = "Loads an image from ComfyUI's input folder and outputs an optional interactive crop."
    SEARCH_ALIASES = ["koo load image crop", "load image crop", "interactive crop"]

    def _load_with_video_impl(self, image_path, crop_enabled, crop_confirmed, crop_x, crop_y, crop_width, crop_height):
        if InputImpl is None:
            return None

        components = InputImpl.VideoFromFile(image_path).get_components()
        if components.images.shape[0] <= 0:
            return None

        dtype = _intermediate_dtype()
        device = _intermediate_device()
        images = components.images.to(device=device, dtype=dtype)
        batch, original_height, original_width = images.shape[:3]
        x, y, width, height = _normalize_crop(
            crop_x,
            crop_y,
            crop_width,
            crop_height,
            original_width,
            original_height,
            crop_enabled and crop_confirmed,
        )
        cropped = images[:, y:y + height, x:x + width, :]

        if components.alpha is not None:
            mask = (1.0 - components.alpha[..., -1]).to(device=device, dtype=dtype)
        else:
            mask = None
        cropped_mask = _crop_mask(mask, x, y, width, height, batch, dtype, device)
        return cropped, cropped_mask, int(original_width), int(original_height), x, y, width, height

    def _load_with_pillow(self, image_path, crop_enabled, crop_confirmed, crop_x, crop_y, crop_width, crop_height):
        dtype = _intermediate_dtype()
        device = _intermediate_device()
        img = node_helpers.pillow(Image.open, image_path)

        output_images = []
        output_masks = []
        original_width = None
        original_height = None
        normalized_crop = None

        for frame in ImageSequence.Iterator(img):
            frame = node_helpers.pillow(ImageOps.exif_transpose, frame)
            rgb_image = frame.convert("RGB")

            if original_width is None:
                original_width, original_height = rgb_image.size
                normalized_crop = _normalize_crop(
                    crop_x,
                    crop_y,
                    crop_width,
                    crop_height,
                    original_width,
                    original_height,
                    crop_enabled and crop_confirmed,
                )

            if rgb_image.size[0] != original_width or rgb_image.size[1] != original_height:
                continue

            x, y, width, height = normalized_crop
            cropped_rgb = rgb_image.crop((x, y, x + width, y + height))
            image_array = np.array(cropped_rgb).astype(np.float32) / 255.0
            output_images.append(torch.from_numpy(image_array)[None,].to(dtype=dtype))

            if "A" in frame.getbands():
                alpha = frame.getchannel("A").crop((x, y, x + width, y + height))
                mask_array = 1.0 - (np.array(alpha).astype(np.float32) / 255.0)
            else:
                mask_array = np.zeros((height, width), dtype=np.float32)
            output_masks.append(torch.from_numpy(mask_array)[None,].to(dtype=dtype))

        if not output_images:
            raise RuntimeError(f"Unable to load image: {image_path}")

        image_tensor = torch.cat(output_images, dim=0).to(device=device, dtype=dtype)
        mask_tensor = torch.cat(output_masks, dim=0).to(device=device, dtype=dtype)
        x, y, width, height = normalized_crop
        return image_tensor, mask_tensor, int(original_width), int(original_height), x, y, width, height

    def load_image(self, image, optimize_long_side="Off", crop_x=0, crop_y=0, crop_width=0, crop_height=0, crop_enabled=False, crop_confirmed=False):
        image_path = folder_paths.get_annotated_filepath(image)

        loaded = None
        try:
            loaded = self._load_with_video_impl(
                image_path,
                crop_enabled,
                crop_confirmed,
                crop_x,
                crop_y,
                crop_width,
                crop_height,
            )
        except Exception:
            loaded = None

        if loaded is None:
            loaded = self._load_with_pillow(
                image_path,
                crop_enabled,
                crop_confirmed,
                crop_x,
                crop_y,
                crop_width,
                crop_height,
            )

        image_tensor, mask_tensor, original_width, original_height, x, y, width, height = loaded
        image_tensor, mask_tensor = _resize_to_long_side(image_tensor, mask_tensor, optimize_long_side)
        final_height = int(image_tensor.shape[1])
        final_width = int(image_tensor.shape[2])
        crop_label = f"crop x={x} y={y} w={width} h={height}"
        return (
            image_tensor,
            mask_tensor,
            int(x),
            int(y),
            int(width),
            int(height),
            crop_label,
            int(original_width),
            int(original_height),
            final_width,
            final_height,
        )

    @classmethod
    def IS_CHANGED(cls, image, optimize_long_side="Off", crop_x=0, crop_y=0, crop_width=0, crop_height=0, crop_enabled=False, crop_confirmed=False):
        image_path = folder_paths.get_annotated_filepath(image)
        digest = hashlib.sha256()
        with open(image_path, "rb") as f:
            digest.update(f.read())
        digest.update(f"|{optimize_long_side}|{crop_x}|{crop_y}|{crop_width}|{crop_height}|{crop_enabled}|{crop_confirmed}".encode("utf-8"))
        return digest.hexdigest()

    @classmethod
    def VALIDATE_INPUTS(cls, image, **kwargs):
        if not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True


NODE_CLASS_MAPPINGS = {
    "KooLoadImageCrop": KooLoadImageCrop,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KooLoadImageCrop": "KoO.Load Image & Crop",
}
