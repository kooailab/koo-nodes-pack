import hashlib
import os

import numpy as np
import torch
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
DISPLAY_NAME = "KoO.Load Image & Crop Next"
RELATIVE_MODULE_NAME = "custom_nodes.koo-nodes.nodes.load_image_crop_next"
CROP_RATIO_VALUES = ["Free", "1:1", "4:5", "3:4", "2:3", "16:9", "9:16", "Custom"]


def _intermediate_dtype():
    if comfy is not None:
        return comfy.model_management.intermediate_dtype()
    return torch.float32


def _intermediate_device():
    if comfy is not None:
        return comfy.model_management.intermediate_device()
    return torch.device("cpu")


def _clamp_int(value, minimum, maximum):
    try:
        number = int(round(float(value)))
    except Exception:
        number = minimum
    return max(minimum, min(number, maximum))


def _normalize_crop(x, y, width, height, image_width, image_height):
    image_width = max(1, int(image_width))
    image_height = max(1, int(image_height))
    width = int(width)
    height = int(height)

    if width <= 0 or height <= 0:
        return 0, 0, image_width, image_height

    left = _clamp_int(x, 0, image_width - 1)
    top = _clamp_int(y, 0, image_height - 1)
    right = _clamp_int(left + width, left + 1, image_width)
    bottom = _clamp_int(top + height, top + 1, image_height)
    return left, top, max(1, right - left), max(1, bottom - top)


def _fit_ratio_crop(image_width, image_height, ratio_width, ratio_height):
    image_width = max(1, int(image_width))
    image_height = max(1, int(image_height))
    ratio = max(float(ratio_width), 1.0) / max(float(ratio_height), 1.0)

    width = image_width
    height = int(round(width / ratio))
    if height > image_height:
        height = image_height
        width = int(round(height * ratio))

    width = max(1, min(image_width, width))
    height = max(1, min(image_height, height))
    x = max(0, int(round((image_width - width) / 2)))
    y = max(0, int(round((image_height - height) / 2)))
    return x, y, width, height


def _adapt_crop_to_ratio(x, y, width, height, image_width, image_height, ratio_width, ratio_height):
    if width <= 0 or height <= 0:
        return _fit_ratio_crop(image_width, image_height, ratio_width, ratio_height)

    ratio = max(float(ratio_width), 1.0) / max(float(ratio_height), 1.0)
    center_x = float(x) + float(width) / 2.0
    center_y = float(y) + float(height) / 2.0

    new_width = float(width)
    new_height = new_width / ratio
    if new_height > height:
        new_height = float(height)
        new_width = new_height * ratio

    new_width = max(1, min(int(round(new_width)), int(image_width)))
    new_height = max(1, min(int(round(new_height)), int(image_height)))
    left = _clamp_int(round(center_x - new_width / 2.0), 0, max(0, int(image_width) - new_width))
    top = _clamp_int(round(center_y - new_height / 2.0), 0, max(0, int(image_height) - new_height))
    return left, top, new_width, new_height


def _ratio_pair(crop_ratio, ratio_width, ratio_height):
    if crop_ratio == "Custom":
        width = max(float(ratio_width), 1.0)
        height = max(float(ratio_height), 1.0)
        return width, height
    if isinstance(crop_ratio, str) and ":" in crop_ratio and crop_ratio != "Free":
        try:
            width, height = crop_ratio.split(":", 1)
            return max(float(width), 1.0), max(float(height), 1.0)
        except Exception:
            return None
    return None


def _ratio_label(crop_ratio, ratio_width, ratio_height):
    pair = _ratio_pair(crop_ratio, ratio_width, ratio_height)
    if pair is None:
        return "Free"
    if crop_ratio == "Custom":
        return f"{pair[0]:g}:{pair[1]:g}"
    return str(crop_ratio)


def _crop_mask(mask, x, y, width, height, batch_size, dtype, device):
    if mask is None:
        return torch.zeros((batch_size, height, width), dtype=dtype, device=device)

    if len(mask.shape) == 2:
        mask = mask.unsqueeze(0)

    if mask.shape[-2] < y + height or mask.shape[-1] < x + width:
        return torch.zeros((batch_size, height, width), dtype=dtype, device=device)

    return mask[:, y:y + height, x:x + width].to(device=device, dtype=dtype)


class _KoOModuleIdentityGuard(type):
    def __setattr__(cls, name, value):
        if name == "RELATIVE_PYTHON_MODULE" and value != RELATIVE_MODULE_NAME:
            current = getattr(cls, "RELATIVE_PYTHON_MODULE", None)
            if current == RELATIVE_MODULE_NAME:
                return
        super().__setattr__(name, value)


class KoOLoadImageCropNext(metaclass=_KoOModuleIdentityGuard):
    RELATIVE_PYTHON_MODULE = RELATIVE_MODULE_NAME

    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        files = folder_paths.filter_files_content_types(files, ["image"])
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
                "crop_ratio": (CROP_RATIO_VALUES, {"default": "Free", "advanced": True}),
                "ratio_width": ("FLOAT", {"default": 4.0, "min": 0.001, "max": MAX_RESOLUTION, "step": 0.1, "advanced": True}),
                "ratio_height": ("FLOAT", {"default": 5.0, "min": 0.001, "max": MAX_RESOLUTION, "step": 0.1, "advanced": True}),
                "crop_x": ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 1, "advanced": True}),
                "crop_y": ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 1, "advanced": True}),
                "crop_width": ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 1, "advanced": True}),
                "crop_height": ("INT", {"default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 1, "advanced": True}),
                "crop_enabled": ("BOOLEAN", {"default": False, "advanced": True}),
                "crop_confirmed": ("BOOLEAN", {"default": False, "advanced": True}),
            },
        }

    CATEGORY = "KoO Tools / Image"
    RETURN_TYPES = ("IMAGE", "MASK", "KOO_CROP_DATA")
    RETURN_NAMES = ("image", "mask", "crop_data")
    FUNCTION = "load_image"
    DESCRIPTION = "Loads an image from ComfyUI's input folder and outputs a manual crop."
    SEARCH_ALIASES = ["koo load image crop next", "load image crop", "manual crop"]

    def _final_crop(
        self,
        crop_x,
        crop_y,
        crop_width,
        crop_height,
        original_width,
        original_height,
        crop_ratio,
        ratio_width,
        ratio_height,
        crop_enabled,
        crop_confirmed,
    ):
        has_crop = bool(crop_enabled) and bool(crop_confirmed) and int(crop_width) > 0 and int(crop_height) > 0
        if has_crop:
            x, y, width, height = _normalize_crop(crop_x, crop_y, crop_width, crop_height, original_width, original_height)
        else:
            x, y, width, height = 0, 0, int(original_width), int(original_height)
        ratio_pair = _ratio_pair(crop_ratio, ratio_width, ratio_height)
        if ratio_pair is not None:
            x, y, width, height = _adapt_crop_to_ratio(
                x,
                y,
                width,
                height,
                original_width,
                original_height,
                ratio_pair[0],
                ratio_pair[1],
            )
        return x, y, width, height

    def _load_with_video_impl(
        self,
        image_path,
        crop_x,
        crop_y,
        crop_width,
        crop_height,
        crop_ratio,
        ratio_width,
        ratio_height,
        crop_enabled,
        crop_confirmed,
    ):
        if InputImpl is None:
            return None

        components = InputImpl.VideoFromFile(image_path).get_components()
        if components.images.shape[0] <= 0:
            return None

        dtype = _intermediate_dtype()
        device = _intermediate_device()
        images = components.images.to(device=device, dtype=dtype)
        batch, original_height, original_width = images.shape[:3]
        x, y, width, height = self._final_crop(
            crop_x,
            crop_y,
            crop_width,
            crop_height,
            original_width,
            original_height,
            crop_ratio,
            ratio_width,
            ratio_height,
            crop_enabled,
            crop_confirmed,
        )
        cropped = images[:, y:y + height, x:x + width, :]

        if components.alpha is not None:
            mask = (1.0 - components.alpha[..., -1]).to(device=device, dtype=dtype)
        else:
            mask = None
        cropped_mask = _crop_mask(mask, x, y, width, height, batch, dtype, device)
        return cropped, cropped_mask, int(original_width), int(original_height), x, y, width, height

    def _load_with_pillow(
        self,
        image_path,
        crop_x,
        crop_y,
        crop_width,
        crop_height,
        crop_ratio,
        ratio_width,
        ratio_height,
        crop_enabled,
        crop_confirmed,
    ):
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
                normalized_crop = self._final_crop(
                    crop_x,
                    crop_y,
                    crop_width,
                    crop_height,
                    original_width,
                    original_height,
                    crop_ratio,
                    ratio_width,
                    ratio_height,
                    crop_enabled,
                    crop_confirmed,
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

    def load_image(
        self,
        image,
        crop_ratio="Free",
        ratio_width=4.0,
        ratio_height=5.0,
        crop_x=0,
        crop_y=0,
        crop_width=0,
        crop_height=0,
        crop_enabled=False,
        crop_confirmed=False,
    ):
        image_path = folder_paths.get_annotated_filepath(image)
        if crop_ratio not in CROP_RATIO_VALUES:
            crop_ratio = "Free"
        ratio_width = max(float(ratio_width), 0.001)
        ratio_height = max(float(ratio_height), 0.001)

        loaded = None
        try:
            loaded = self._load_with_video_impl(
                image_path,
                crop_x,
                crop_y,
                crop_width,
                crop_height,
                crop_ratio,
                ratio_width,
                ratio_height,
                crop_enabled,
                crop_confirmed,
            )
        except Exception:
            loaded = None

        if loaded is None:
            loaded = self._load_with_pillow(
                image_path,
                crop_x,
                crop_y,
                crop_width,
                crop_height,
                crop_ratio,
                ratio_width,
                ratio_height,
                crop_enabled,
                crop_confirmed,
            )

        image_tensor, mask_tensor, original_width, original_height, x, y, width, height = loaded

        final_height = int(image_tensor.shape[1])
        final_width = int(image_tensor.shape[2])
        crop_data = {
            "crop_x": int(x),
            "crop_y": int(y),
            "crop_width": int(width),
            "crop_height": int(height),
            "original_width": int(original_width),
            "original_height": int(original_height),
            "cropped_width": final_width,
            "cropped_height": final_height,
            "ratio": _ratio_label(crop_ratio, ratio_width, ratio_height),
        }
        return (
            image_tensor,
            mask_tensor,
            crop_data,
        )

    @classmethod
    def IS_CHANGED(
        cls,
        image,
        crop_ratio="Free",
        ratio_width=4.0,
        ratio_height=5.0,
        crop_x=0,
        crop_y=0,
        crop_width=0,
        crop_height=0,
        crop_enabled=False,
        crop_confirmed=False,
    ):
        image_path = folder_paths.get_annotated_filepath(image)
        digest = hashlib.sha256()
        with open(image_path, "rb") as f:
            digest.update(f.read())
        digest.update(
            (
                f"|{crop_ratio}|{ratio_width}|{ratio_height}|"
                f"{crop_x}|{crop_y}|{crop_width}|{crop_height}|{crop_enabled}|{crop_confirmed}"
            ).encode("utf-8")
        )
        return digest.hexdigest()

    @classmethod
    def VALIDATE_INPUTS(cls, image, **kwargs):
        if not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"
        return True


class KoOCropDataUnpack:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"crop_data": ("KOO_CROP_DATA",)}}

    CATEGORY = "KoO Tools / Image"
    RETURN_TYPES = ("INT", "INT", "INT", "INT", "INT", "INT", "INT", "INT", "STRING")
    RETURN_NAMES = (
        "crop_x",
        "crop_y",
        "crop_width",
        "crop_height",
        "original_width",
        "original_height",
        "cropped_width",
        "cropped_height",
        "ratio",
    )
    FUNCTION = "unpack"
    DESCRIPTION = "Unpacks KoO crop metadata into primitive values."
    SEARCH_ALIASES = ["koo crop data unpack", "crop data unpack"]

    def unpack(self, crop_data):
        data = crop_data if isinstance(crop_data, dict) else {}
        return (
            int(data.get("crop_x", 0)),
            int(data.get("crop_y", 0)),
            int(data.get("crop_width", 0)),
            int(data.get("crop_height", 0)),
            int(data.get("original_width", 0)),
            int(data.get("original_height", 0)),
            int(data.get("cropped_width", 0)),
            int(data.get("cropped_height", 0)),
            str(data.get("ratio", "Free")),
        )


NODE_CLASS_MAPPINGS = {
    "KoO_LoadImageCropNext": KoOLoadImageCropNext,
    "KoO_CropDataUnpack": KoOCropDataUnpack,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "KoO_LoadImageCropNext": DISPLAY_NAME,
    "KoO_CropDataUnpack": "KoO Crop Data Unpack",
}
