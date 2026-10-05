import asyncio
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import torch
from test_koo_finisher import processing, cache, routes, FakeRoutes, temporary_modules, make_module

presets = sys.modules[processing.__package__ + ".presets"]


class PresetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.modules = patch.dict(sys.modules, {"folder_paths": SimpleNamespace(get_user_directory=lambda: str(self.root))})
        self.modules.start(); self.addCleanup(self.modules.stop)

    def test_user_location_and_unicode_save_load(self):
        identifier, preset = presets.save_preset("Éditorial 柔らかい", {"exposure": 0.35, "soft_lens": 30})
        self.assertEqual(presets.preset_directory(), self.root / "KoO/finisher/presets")
        self.assertEqual(presets.load_preset(identifier), preset)
        self.assertEqual(presets.list_presets()[0]["name"], "Éditorial 柔らかい")

    def test_save_updates_and_save_as_creates(self):
        identifier, _ = presets.save_preset("Look", {})
        updated, _ = presets.save_preset("Look", {"exposure": 1}, identifier)
        copy, preset = presets.save_preset("Look", {"exposure": -1})
        self.assertEqual(identifier, updated); self.assertNotEqual(identifier, copy)
        self.assertEqual(preset["name"], "Look (2)")
        self.assertEqual(presets.load_preset(identifier)["settings"]["exposure"], 1)

    def test_rename_delete_and_collision(self):
        identifier, _ = presets.save_preset("One", {})
        presets.save_preset("Two", {})
        with self.assertRaises(ValueError): presets.rename_preset(identifier, "Two")
        presets.rename_preset(identifier, "New")
        self.assertEqual(presets.load_preset(identifier)["name"], "New")
        presets.delete_preset(identifier)
        with self.assertRaises(FileNotFoundError): presets.load_preset(identifier)

    def test_export_import_look_only_and_portable_lut(self):
        settings = {"lut": "film / warm", "exposure": 1.65, "auto_save": True, "output_folder": "private",
                    "format": "WEBP", "quality": 2, "compare": True, "preview": "blob:private", "filename_prefix": "private"}
        identifier, _ = presets.save_preset("Warm", settings)
        text = presets.export_preset(identifier)
        document = json.loads(text)
        self.assertEqual(set(document), {"schema_version", "name", "finisher_version", "settings"})
        self.assertEqual(set(document["settings"]), set(presets.DEFAULTS))
        self.assertNotIn("private", text)
        imported, preset = presets.import_preset(text)
        self.assertNotEqual(identifier, imported); self.assertEqual(preset["name"], "Warm (2)")
        self.assertEqual(preset["settings"]["exposure"], 1.65)

    def test_missing_and_unknown_settings(self):
        document = presets.validate_preset({"schema_version": 2, "name": "Minimal", "settings": {"future": {"any": True}}})
        self.assertEqual(document["settings"], presets.DEFAULTS)

    def test_malformed_schema_and_nonfinite_rejected(self):
        for data in ("{", "[]", '{}', '{"schema_version":1,"name":"A","settings":{}}',
                     '{"schema_version":3,"name":"A","settings":{}}',
                     '{"schema_version":true,"name":"A","settings":{}}',
                     '{"schema_version":2,"name":"A","settings":[]}',
                     '{"schema_version":2,"name":"A","settings":{"exposure":NaN}}'):
            with self.subTest(data=data), self.assertRaises(ValueError): presets.import_preset(data)
        with self.assertRaises(ValueError): presets.import_preset(" " * 65537)

    def test_traversal_and_absolute_lut_rejected(self):
        for name in ("../bad", "bad/name", ".."):
            with self.assertRaises(ValueError): presets.save_preset(name, {})
        for value in ("../outside.cube", "C:/private.cube", "/private.cube", "\\\\server\\file.cube"):
            with self.assertRaises(ValueError): presets.save_preset("Look", {"lut": value})
        for identifier in ("../file", "a" * 32 + "/outside", "not-an-id"):
            with self.assertRaises(ValueError): presets.load_preset(identifier)

    def test_missing_lut_does_not_block_rest(self):
        identifier, _ = presets.save_preset("Look", {"lut": "missing", "contrast": 30})
        with patch.object(presets, "resolve_lut_path", return_value=None):
            payload = presets.preset_payload(identifier)
        self.assertTrue(payload["missing_lut"])
        self.assertEqual(payload["preset"]["settings"]["contrast"], 30)

    def test_ranges_clamped(self):
        _, preset = presets.save_preset("Look", {"soft_lens": 999, "chromatic_aberration": -4, "exposure": 8})
        self.assertEqual(preset["settings"]["soft_lens"], 100)
        self.assertEqual(preset["settings"]["chromatic_aberration"], 0)
        self.assertEqual(preset["settings"]["exposure"], 5)

    def test_portable_base_path_fallback(self):
        with patch.dict(sys.modules, {"folder_paths": SimpleNamespace(base_path=str(self.root))}):
            self.assertEqual(presets.preset_directory(), self.root / "user/KoO/finisher/presets")

    def test_guarded_routes_save_load_import_delete_and_errors(self):
        fake = FakeRoutes(); routes._ROUTES_REGISTERED = False
        with temporary_modules({"server": make_module("server", PromptServer=SimpleNamespace(instance=SimpleNamespace(routes=fake)))}):
            routes.register_routes()
        self.addCleanup(setattr, routes, "_ROUTES_REGISTERED", False)
        handlers = {(method,path):fn for method,path,fn in fake.registered}
        post = handlers["POST","/koo/finisher/presets"]; get = handlers["GET","/koo/finisher/presets"]
        async def invoke(handler, data=None, query=None, origin=None):
            async def read(): return data
            return await handler(SimpleNamespace(json=read, query=query or {}, headers={"Origin":origin} if origin else {}, host="localhost:8188", remote="127.0.0.1"))
        self.assertEqual(asyncio.run(invoke(post, {"action":"save_as","name":"Route","settings":{}}, origin="https://foreign.invalid")).status, 403)
        response = asyncio.run(invoke(post, {"action":"save_as","name":"Route","settings":{}}))
        identifier = json.loads(response.text)["id"]
        self.assertEqual(asyncio.run(invoke(get,query={"id":identifier})).status, 200)
        self.assertEqual(asyncio.run(invoke(post,{"action":"import","json":"{"})).status, 400)
        self.assertEqual(asyncio.run(invoke(post,{"action":"delete","id":identifier})).status, 200)


class EffectsExposureTests(unittest.TestCase):
    def setUp(self):
        torch.manual_seed(42)
        self.image = torch.rand(1, 33, 41, 3)

    def test_neutral_effects_are_exact_identity(self):
        self.assertIs(processing._soft_lens(self.image, 0), self.image)
        self.assertIs(processing._chromatic_aberration(self.image, 0), self.image)
        self.assertTrue(torch.equal(processing.apply_finishing(self.image, {}), processing.apply_finishing(self.image, {"soft_lens":0,"chromatic_aberration":0})))

    def test_soft_lens_changes_fine_detail_preserves_edges(self):
        fine = self.image * 0.08 + 0.4
        softened = processing._soft_lens(fine, 50)
        self.assertFalse(torch.equal(fine, softened))
        edge = torch.zeros(1,33,41,3); edge[:,:,20:]=1
        result = processing._soft_lens(edge,100)
        self.assertGreater(float(result[0,16,20,0]), 0.90)
        self.assertLess(float(result[0,16,19,0]), 0.10)

    def test_aberration_changes_edges_keeps_center_and_green(self):
        result = processing._chromatic_aberration(self.image,100)
        self.assertFalse(torch.equal(result[:,:3],self.image[:,:3]))
        self.assertTrue(torch.equal(result[...,1],self.image[...,1]))
        self.assertTrue(torch.allclose(result[:,16,20],self.image[:,16,20],atol=1e-6))

    def test_aberration_maximum_displacement(self):
        self.assertEqual(processing.CHROMATIC_MAX_PIXELS,96)
        ramp = torch.linspace(0,1,101).view(1,1,101,1).expand(1,81,101,3)
        result = processing._chromatic_aberration(ramp,10000)
        self.assertLessEqual(float((result-ramp).abs().max())*100,processing._chromatic_pixels(81,101,100)+0.0001)

    def test_dimensions_dtype_device_and_alpha(self):
        devices = ["cpu"] + (["cuda"] if torch.cuda.is_available() else [])
        for device in devices:
            for dtype in (torch.float16,torch.float32,torch.float64):
                image = torch.cat((self.image,self.image[...,0:1]),dim=-1).to(device=device,dtype=dtype)
                result = processing.apply_finishing(image,{"soft_lens":40,"chromatic_aberration":40})
                self.assertEqual(result.shape,image.shape);self.assertEqual(result.dtype,dtype);self.assertEqual(result.device,image.device)
                self.assertTrue(torch.equal(result[...,3],image[...,3]))

    def test_tiny_images_and_batches(self):
        for h,w in ((1,1),(1,9),(9,1)):
            image = torch.rand(2,h,w,3)
            result=processing.apply_finishing(image,{"soft_lens":50,"chromatic_aberration":50})
            self.assertEqual(result.shape,image.shape);self.assertTrue(torch.isfinite(result).all())

    def test_exposure_is_linear_light_ev_multiplier(self):
        image = torch.full((1,3,4,3),0.1)
        for ev,factor in ((0,1),(1,2),(-1,0.5),(2,4),(1.65,2**1.65)):
            result = processing.apply_finishing(image,{"exposure":ev})
            self.assertTrue(torch.allclose(processing._srgb_to_linear(result),processing._srgb_to_linear(image)*factor,atol=1e-7))
        self.assertTrue(torch.equal(processing.apply_finishing(image,{"exposure":0}),image))

    def test_new_effects_share_reduced_preview_pipeline(self):
        image=torch.rand(1,256,512,3);meta=cache.cache_source_image(image,"feature-preview")
        with patch.object(cache,"apply_finishing",wraps=processing.apply_finishing) as run:
            cache.render_preview(meta["cache_id"],{"soft_lens":20,"chromatic_aberration":20},max_size=128)
        self.assertEqual(run.call_count,1);self.assertEqual(tuple(run.call_args.args[0].shape),(1,64,128,3))


if __name__ == "__main__": unittest.main()
