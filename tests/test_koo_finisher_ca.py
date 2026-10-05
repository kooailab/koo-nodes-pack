"""Measure channel edges after full finishing and PNG export, not grid requests."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
import torch

from test_koo_finisher import cache, processing


def edge_fixture(height, width, location):
    x_fraction, y_fraction = {"center": (.5, .5), "halfway": (.75, .5), "corner": (.9, .9)}[location]
    x, y = round(width * x_fraction), round(height * y_fraction)
    image = torch.zeros(1, height, width, 3)
    half_band = max(12, round(height * .04))
    image[:, max(0, y-half_band):min(height, y+half_band), x:] = 1
    return image, x, y


def crossing(row, expected, window=100):
    left = max(0, int(expected)-window)
    right = min(len(row)-1, int(expected)+window)
    indices = np.flatnonzero((row[left:right] < .5) & (row[left+1:right+1] >= .5))
    if len(indices) != 1:
        raise AssertionError(f"Expected one black/white edge; found {len(indices)}")
    i = left + int(indices[0])
    return float(i + (.5-row[i]) / (row[i+1]-row[i]))


def measure_png(path, x, y, view_scale=1):
    with Image.open(path) as image:
        if view_scale != 1:
            image = image.resize((round(image.width*view_scale), round(image.height*view_scale)), Image.Resampling.LANCZOS)
        array = np.asarray(image, dtype=np.float64) / 255
    row = array[min(array.shape[0]-1, round(y*view_scale))]
    positions = [crossing(row[:, channel], x*view_scale) for channel in range(3)]
    return {"red_x":positions[0], "green_x":positions[1], "blue_x":positions[2],
            "red_blue_separation_px":abs(positions[2]-positions[0]),
            "red_shift_px":positions[1]-positions[0], "blue_shift_px":positions[2]-positions[1]}


def export_fixture(image, strength, directory, prefix, finish=processing.apply_finishing):
    info = cache.cache_source_image(image, f"ca-diagnostic-{prefix}")
    with patch.object(cache, "apply_finishing", finish):
        result = cache.save_finished_image({"cache_id":info["cache_id"],
                   "settings":{"chromatic_aberration":strength}, "format":"PNG", "quality":95,
                   "output_folder":str(Path(directory).resolve()), "filename_prefix":prefix})
    return Path(result["files"][0]["path"])


class ActualCAEdgeTests(unittest.TestCase):
    def test_zero_exact_identity_and_full_finishing(self):
        image, _, _ = edge_fixture(161, 129, "corner")
        self.assertIs(processing._chromatic_aberration(image, 0), image)
        self.assertTrue(torch.equal(processing.apply_finishing(image, {"chromatic_aberration":0}), image))

    def test_actual_exported_edges_ordered_and_visible_at_view_size(self):
        # Same portrait aspect ratio as user's exports; measure PNG pixels.
        with tempfile.TemporaryDirectory() as directory:
            measurements = {}
            for location in ("center", "halfway", "corner"):
                image, x, y = edge_fixture(1024, 684, location)
                values = []
                for strength in (10,25,50,75,100):
                    path = export_fixture(image,strength,directory,f"{location}_{strength}")
                    with Image.open(path) as exported:
                        self.assertEqual(exported.size,(684,1024))
                    full = measure_png(path,x,y)
                    self.assertAlmostEqual(full["green_x"],x-.5,places=5)
                    values.append(full["red_blue_separation_px"])
                measurements[location] = values
            self.assertLess(max(measurements["center"]), .15)
            for location in ("halfway","corner"):
                self.assertTrue(all(a < b for a,b in zip(measurements[location],measurements[location][1:])))
            self.assertGreater(measurements["corner"][1],2)
            self.assertGreater(measurements["corner"][2],5)
            self.assertGreater(measurements["corner"][-1],14)

    def test_preview_and_export_use_same_operation_at_same_dimensions(self):
        image,x,y = edge_fixture(1024,684,"corner")
        info=cache.cache_source_image(image,"ca-paths")
        with tempfile.TemporaryDirectory() as directory:
            for strength in (25,50,100):
                path=export_fixture(image,strength,directory,f"path_{strength}")
                preview=cache.render_preview(info["cache_id"],{"chromatic_aberration":strength},max_size=1200)
                from io import BytesIO
                with Image.open(BytesIO(preview)) as a, Image.open(path) as b:
                    self.assertTrue(np.array_equal(np.asarray(a),np.asarray(b)))


if __name__ == "__main__":
    unittest.main()
