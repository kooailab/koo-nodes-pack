import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import torch

ROOT = Path(__file__).resolve().parents[1]
COMFY = Path(os.environ.get("COMFYUI_ROOT", ROOT.parent.parent))


sys.path.insert(0, str(COMFY))
import comfy.utils
utils = comfy.utils
spec = importlib.util.spec_from_file_location("koo_multiple_adapter_test", ROOT / "nodes/multiple_adapter.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class MultipleAdapterTests(unittest.TestCase):
    def setUp(self):
        self.node = adapter.KoOMultipleAdapter()

    def test_requested_math_examples(self):
        for value, down, up in ((60, 48, 64), (64, 64, 64), (1080, 1072, 1088), (10, 16, 16), (1024, 1024, 1024)):
            for direction, expected in (("MINUS", down), ("PLUS", up)):
                with self.subTest(value=value, direction=direction):
                    self.assertEqual(self.node.adapt(value, value, 16, direction), (expected, expected, None))
        self.assertEqual(self.node.adapt(1920, 1080, 16, "MINUS"), (1920, 1072, None))
        self.assertEqual(self.node.adapt(1920, 1080, 16, "PLUS"), (1920, 1088, None))
        self.assertEqual(self.node.adapt(60, 60, 32, "MINUS")[:2], (32, 32))
        self.assertEqual(self.node.adapt(60, 60, 32, "PLUS")[:2], (64, 64))
        self.assertEqual(self.node.adapt(63, 63, 10, "MINUS"), (60, 60, None))
        self.assertEqual(self.node.adapt(63, 63, 10, "PLUS"), (70, 70, None))
        self.assertEqual(self.node.adapt(63, 1080, 1), (63, 1080, None))

    def test_arbitrary_multiple_not_a_dropdown_or_preset(self):
        for multiple in (1, 3, 7, 19, 257, 99991):
            self.assertEqual(self.node.adapt(60, 1080, multiple)[0] % multiple, 0)
        config = self.node.INPUT_TYPES()["required"]
        self.assertEqual(config["multiple"], ("INT", {"default": 16, "min": 1, "step": 1}))
        self.assertTrue(config["width"][1]["defaultInput"])
        self.assertTrue(config["height"][1]["defaultInput"])
        self.assertEqual(config["direction"][1]["default"], "PLUS")
        self.assertEqual(self.node.INPUT_TYPES()["optional"]["latent"], ("LATENT",))

    def test_connected_resolution_ints_and_standard_latent(self):
        spec = importlib.util.spec_from_file_location("installed_resolution_test", ROOT / "nodes/resolution_next/nodes.py")
        resolution = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(resolution)
        producer = resolution.KoOResolutionNext()
        self.assertEqual(producer.RETURN_TYPES, ("INT", "INT", "STRING", "LATENT"))
        width, height, _, latent = producer.generate(1920, 1080, "Custom", 2048, False, "x1", "Standard SD / SDXL", 2)
        result = self.node.adapt(width, height, 16, "PLUS", latent)
        self.assertEqual(result[:2], (1920, 1088))
        self.assertEqual(result[2]["samples"].shape, (2, 4, 136, 240))

    def test_no_latent_returns_none(self):
        self.assertEqual(self.node.adapt(60, 60), (64, 64, None))

    def test_offset_rounding_examples_and_independent_dimensions(self):
        for multiple, value, down, up in ((16, 60, 49, 65), (32, 60, 33, 65), (8, 22, 17, 25),
                                          (16, 10, 1, 17), (16, 1, 1, 1), (16, 17, 17, 17)):
            for direction, expected in (("MINUS", down), ("PLUS", up)):
                with self.subTest(multiple=multiple, value=value, direction=direction):
                    self.assertEqual(self.node.adapt(value, value, multiple, direction, offset=1), (expected, expected, None))
        self.assertEqual(self.node.adapt(60, 22, 8, "MINUS", offset=1), (57, 17, None))
        self.assertEqual(self.node.adapt(60, 22, 8, "PLUS", offset=1), (65, 25, None))

    def test_multiple_one_both_offsets_and_large_integer_math(self):
        for offset in (0, 1):
            for direction in ("MINUS", "PLUS"):
                for value in (1, 2, 10, 10**30 + 1):
                    self.assertEqual(self.node.adapt(value, value, 1, direction, offset=offset), (value, value, None))
        value = 10**30 + 3
        for offset in (0, 1):
            down = self.node.adapt(value, value, 16, "MINUS", offset=offset)[0]
            up = self.node.adapt(value, value, 16, "PLUS", offset=offset)[0]
            self.assertLessEqual(down, value); self.assertGreaterEqual(up, value)
            self.assertEqual((down - offset) % 16, 0); self.assertEqual((up - offset) % 16, 0)

    def test_offset_one_grid_rejection_and_valid_grid_targets(self):
        latent = {"samples": torch.ones(1, 4, 128, 128)}
        with patch.object(utils, "common_upscale") as resize:
            with self.assertRaisesRegex(ValueError, "Target 1025x1025.*scale 8.*Use \\+0 or disconnect LATENT"):
                self.node.adapt(1024, 1024, 16, "PLUS", latent, offset=1)
            resize.assert_not_called()
        # Offset +1 is allowed if its computed target actually fits the grid.
        self.assertIs(self.node.adapt(1024, 1024, 1, "PLUS", latent, offset=1)[2], latent)
        unit_grid = {"samples": torch.ones(1, 4, 60, 60)}
        self.assertEqual(self.node.adapt(60, 60, 16, "PLUS", unit_grid, offset=1)[2]["samples"].shape, (1, 4, 65, 65))

    def test_old_calls_default_to_zero_and_invalid_offset_rejected(self):
        self.assertEqual(self.node.adapt(60, 60), self.node.adapt(60, 60, offset=0))
        self.assertEqual(self.node.INPUT_TYPES()["optional"]["offset"][1]["default"], 0)
        for offset in (-1, 2, .5, True):
            with self.assertRaisesRegex(ValueError, "offset must be 0 or 1"):
                self.node.adapt(60, 60, offset=offset)

    def test_correct_size_is_same_dictionary_and_tensor(self):
        latent = {"samples": torch.randn(2, 4, 8, 8), "metadata": {"keep": True}}
        with patch.object(utils, "common_upscale") as resize:
            self.assertIs(self.node.adapt(64, 64, latent=latent)[2], latent)
            resize.assert_not_called()

    def test_upward_and_downward_resizing_preserve_tensor_properties(self):
        for dtype in (torch.float32, torch.float16, torch.bfloat16, torch.float64):
            for direction, size in (("PLUS", 10), ("MINUS", 8)):
                with self.subTest(dtype=dtype, direction=direction):
                    samples = torch.linspace(0, 1, 2 * 16 * 9 * 9, dtype=dtype).reshape(2, 16, 9, 9)
                    latent = {"samples": samples, "batch_index": [7, 8], "metadata": "keep"}
                    _, _, result = self.node.adapt(72, 72, 16, direction, latent)
                    self.assertEqual(result["samples"].shape, (2, 16, size, size))
                    self.assertEqual(result["samples"].dtype, dtype)
                    self.assertEqual(result["samples"].device, samples.device)
                    self.assertIs(result["batch_index"], latent["batch_index"])
                    self.assertEqual(result["metadata"], "keep")
                    self.assertEqual(samples.shape, (2, 16, 9, 9))

    @unittest.skipUnless(torch.cuda.is_available(), "CUDA unavailable")
    def test_cuda_device_is_preserved(self):
        latent = {"samples": torch.ones(2, 4, 9, 9, device="cuda", dtype=torch.float16)}
        result = self.node.adapt(72, 72, latent=latent)[2]["samples"]
        self.assertEqual(result.device, latent["samples"].device)
        self.assertEqual(result.dtype, torch.float16)

    def test_native_still_5d_and_other_integer_spatial_scales(self):
        for scale in (4, 8, 16, 32):
            for multiple in (8, 16, 32, 64, 128):
                if multiple < scale:
                    continue
                latent = {"samples": torch.ones(2, 16, 1, 9, 9)}
                width, height, result = self.node.adapt(9 * scale, 9 * scale, multiple, "PLUS", latent)
                self.assertEqual(result["samples"].shape, (2, 16, 1, height // scale, width // scale))

    def test_noise_masks_and_other_spatial_fields_resize_consistently(self):
        for mask_shape in ((72, 72), (2, 72, 72), (2, 1, 72, 72), (2, 1, 1, 72, 72), (2, 1, 9, 9), (1, 1, 36, 36)):
            latent = {"samples": torch.ones(2, 4, 9, 9), "noise_mask": torch.ones(mask_shape),
                      "spatial_extra": torch.zeros(2, 1, 9, 9, dtype=torch.bool), "non_spatial": torch.tensor([1, 2])}
            result = self.node.adapt(72, 72, latent=latent)[2]
            expected = (10, 10) if mask_shape[-2:] == (9, 9) else (80, 80)
            self.assertEqual(result["noise_mask"].shape, (*mask_shape[:-2], *expected))
            self.assertEqual(result["spatial_extra"].shape, (2, 1, 10, 10))
            self.assertEqual(result["spatial_extra"].dtype, torch.bool)
            self.assertIs(result["non_spatial"], latent["non_spatial"])
            self.assertEqual(latent["noise_mask"].shape, mask_shape)

    def test_invalid_latent_grid_target_has_clear_error(self):
        latent = {"samples": torch.ones(1, 4, 8, 8)}
        with self.assertRaisesRegex(ValueError, "Target 70x70 is incompatible with connected LATENT grid scale 8"):
            self.node.adapt(64, 64, 7, "PLUS", latent)
        with self.assertRaisesRegex(ValueError, "integer latent spatial scale"):
            self.node.adapt(60, 64, 16, "PLUS", latent)
        with self.assertRaisesRegex(ValueError, "Target 1025x1025 is incompatible with connected LATENT grid scale 8"):
            self.node.adapt(1024, 1024, 1025, "PLUS", {"samples": torch.ones(1, 4, 128, 128)})

    def test_invalid_values_and_temporal_latents_rejected(self):
        for value in (0, -1, 1.5, True):
            with self.assertRaisesRegex(ValueError, "positive integers"):
                self.node.adapt(64, 64, value)
        with self.assertRaisesRegex(ValueError, "direction"):
            self.node.adapt(64, 64, direction="other")
        with self.assertRaisesRegex(ValueError, "still-image"):
            self.node.adapt(64, 64, latent={"samples": torch.ones(1, 4, 2, 8, 8)})

    def test_only_additive_pack_registration(self):
        baseline_path = COMFY / "custom_nodes/koo-nodes/__init__.py"
        if not baseline_path.is_file():
            self.skipTest("Historical koo-nodes baseline is not installed")
        baseline = baseline_path.read_text(encoding="utf-8")
        changed = (ROOT / "__init__.py").read_text(encoding="utf-8")
        added = [line for line in changed.splitlines() if "MULTIPLE_ADAPTER" in line]
        self.assertEqual(len(added), 4)
        self.assertEqual("\n".join(line for line in changed.splitlines() if "MULTIPLE_ADAPTER" not in line),
                         "\n".join(line for line in baseline.splitlines() if "MULTIPLE_ADAPTER" not in line))
        self.assertEqual(adapter.NODE_CLASS_MAPPINGS, {"KoOMultipleAdapter": adapter.KoOMultipleAdapter})
        self.assertEqual(adapter.NODE_DISPLAY_NAME_MAPPINGS, {"KoOMultipleAdapter": "KoO Multiple Adapter"})


if __name__ == "__main__":
    unittest.main()
