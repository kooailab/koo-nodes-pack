"""Numerical calibration checks on the actual Finisher processing path."""
import math
import unittest
from io import BytesIO

import numpy as np
import torch
from PIL import Image
from test_koo_finisher import processing, cache, nodes


def decode(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def encode(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


class ExposureCalibrationTests(unittest.TestCase):
    def test_standard_loaded_pixels_reach_cache_without_linearization(self):
        # Same Pillow RGB /255 conversion as installed ComfyUI LoadImage.
        buffer = BytesIO()
        Image.new("RGB", (2, 2), (128, 64, 32)).save(buffer, format="PNG")
        buffer.seek(0)
        image = torch.from_numpy(np.array(Image.open(buffer).convert("RGB")).astype(np.float32) / 255.0)[None]
        result = nodes.KoOFinisher().cache(image, "color-space")
        self.assertIs(result["result"][0], image)
        source = cache._SOURCE_CACHE[result["ui"]["koo_finisher"][0]["cache_id"]]["image"]
        self.assertTrue(torch.equal(source, image))
        self.assertAlmostEqual(source[0, 0, 0, 0].item(), 128 / 255, places=7)
        self.assertNotAlmostEqual(source[0, 0, 0, 0].item(), decode(128 / 255), places=3)

    def test_transfer_functions_against_independent_scalar_reference(self):
        values = [-0.02, 0, 0.003, 0.04044, 0.04045, 0.04046, 0.5, 1, 1.2]
        image = torch.tensor(values, dtype=torch.float64)
        expected = torch.tensor([decode(c) for c in values], dtype=torch.float64)
        self.assertTrue(torch.allclose(processing._srgb_to_linear(image), expected, atol=1e-12, rtol=1e-12))
        linear = torch.tensor([-0.01, 0, .0031307, .0031308, .0031309, .214041140482, 1, 2], dtype=torch.float64)
        self.assertTrue(torch.allclose(processing._linear_to_srgb(linear), torch.tensor([encode(c) for c in linear.tolist()], dtype=torch.float64), atol=1e-12, rtol=1e-12))

    def test_stops_double_half_quadruple_linear_values(self):
        image = torch.tensor([.001, .02, .1, .25]).reshape(1, 1, 4, 1).expand(1, 1, 4, 3)
        for ev in (-1, .1, .25, .5, 1, 2):
            result = processing.apply_finishing(image, {"exposure": ev})
            expected = torch.tensor([decode(c) * 2 ** ev for c in [.001, .02, .1, .25]]).reshape(1, 1, 4, 1).expand_as(image)
            self.assertTrue(torch.allclose(processing._srgb_to_linear(result), expected, atol=1e-7))

    def test_half_gray_one_stop_and_old_difference(self):
        image = torch.full((1, 2, 3, 3), .5)
        expected = encode(decode(.5) * 2)
        self.assertAlmostEqual(expected, .685836119064369, places=12)
        self.assertAlmostEqual(processing.apply_finishing(image, {"exposure": 1})[0, 0, 0, 0].item(), expected, places=6)
        self.assertEqual((image * 2).clamp(0, 1)[0, 0, 0, 0].item(), 1)

    def test_zero_exact_and_no_linear_highlight_clipping(self):
        torch.manual_seed(91)
        image = torch.rand(1, 13, 17, 3)
        self.assertIs(processing._exposure(image, 0), image)
        self.assertTrue(torch.equal(processing.apply_finishing(image, {"exposure": 0}), image))
        high = torch.tensor([.9])
        exposed = processing._exposure(high, 2)
        self.assertGreater(exposed.item(), 1)
        self.assertTrue(torch.allclose(processing._srgb_to_linear(exposed), processing._srgb_to_linear(high) * 4, atol=1e-6))


class LensCalibrationTests(unittest.TestCase):
    def test_ca_resolution_mapping_and_safety_cap(self):
        for size, maximum in ((1024, 25.6), (2048, 51.2), (10000, 96)):
            for strength in (25, 50, 100):
                self.assertAlmostEqual(processing._chromatic_pixels(size, size * 2, strength), maximum * (strength / 100) ** 1.5)

    def test_ca_measured_radial_displacement_progression_and_center(self):
        h, w = 513, 769
        ramp = torch.linspace(0, 1, w).view(1, 1, w, 1).expand(1, h, w, 3)
        self.assertIs(processing._chromatic_aberration(ramp, 0), ramp)
        displacements = []
        for strength in (25, 50, 100):
            result = processing._chromatic_aberration(ramp, strength)
            self.assertEqual(result.shape, ramp.shape)
            self.assertTrue(torch.equal(result[..., 1], ramp[..., 1]))
            edge = (result[0, 8, w - 10, 0] - ramp[0, 8, w - 10, 0]).abs().item() * (w - 1)
            center = (result[0, h // 2, w // 2 + 2, 0] - ramp[0, h // 2, w // 2 + 2, 0]).abs().item() * (w - 1)
            self.assertLess(center, edge * .01)
            self.assertGreater(edge, .9)  # Visible subpixel-plus fringe at 25 already.
            displacements.append(edge)
        self.assertLess(displacements[0], displacements[1])
        self.assertLess(displacements[1], displacements[2])

    def test_soft_lens_progressive_fine_energy_and_major_structure(self):
        torch.manual_seed(84)
        fine = .4 + .12 * torch.rand(1, 129, 193, 3)
        self.assertIs(processing._soft_lens(fine, 0), fine)
        energy = lambda x: (x[:, :, 1:] - x[:, :, :-1]).square().mean().item()
        energies = [energy(fine)]
        edge = torch.zeros_like(fine); edge[:, :, 96:] = 1
        for strength in (25, 50, 100):
            result = processing._soft_lens(fine, strength)
            self.assertEqual(result.shape, fine.shape)
            energies.append(energy(result))
            structure = processing._soft_lens(edge, strength)
            self.assertLess(structure[0, 64, 95, 0].item(), .10)
            self.assertGreater(structure[0, 64, 96, 0].item(), .90)
            self.assertEqual(structure[0, 64, 80, 0].item(), 0)
            self.assertEqual(structure[0, 64, 110, 0].item(), 1)
        self.assertTrue(all(a > b for a, b in zip(energies, energies[1:])))
        self.assertLess(energies[1], energies[0] * .6)
        self.assertLess(energies[-1], energies[0] * .05)


if __name__ == "__main__":
    unittest.main()
