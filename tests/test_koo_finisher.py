from __future__ import annotations

import asyncio
from contextlib import contextmanager
from io import BytesIO
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

import torch
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PACKAGE_DIR = ROOT / "nodes" / "koo_finisher"
PACKAGE_NAME = "koo_finisher_migration_test"


def make_module(name: str, **attributes):
    value = ModuleType(name)
    for key, item in attributes.items():
        setattr(value, key, item)
    return value


@contextmanager
def temporary_modules(modules):
    previous = {name: sys.modules.get(name) for name in modules}
    sys.modules.update(modules)
    try:
        yield
    finally:
        for name, old_value in previous.items():
            if old_value is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = old_value


folder_paths_stub = make_module(
    "folder_paths",
    get_output_directory=lambda: tempfile.gettempdir(),
)
server_stub = make_module("server", PromptServer=SimpleNamespace(instance=None))
with temporary_modules({"folder_paths": folder_paths_stub, "server": server_stub}):
    package_spec = importlib.util.spec_from_file_location(
        PACKAGE_NAME,
        PACKAGE_DIR / "__init__.py",
        submodule_search_locations=[str(PACKAGE_DIR)],
    )
    if package_spec is None or package_spec.loader is None:
        raise RuntimeError("Could not load the KoO Finisher test package")
    package = importlib.util.module_from_spec(package_spec)
    sys.modules[PACKAGE_NAME] = package
    package_spec.loader.exec_module(package)


cache = sys.modules[f"{PACKAGE_NAME}.cache"]
nodes = sys.modules[f"{PACKAGE_NAME}.nodes"]
processing = sys.modules[f"{PACKAGE_NAME}.processing"]
routes = sys.modules[f"{PACKAGE_NAME}.routes"]


def write_invert_cube(path: Path) -> None:
    rows = []
    for blue in (0.0, 1.0):
        for green in (0.0, 1.0):
            for red in (0.0, 1.0):
                rows.append(f"{1.0 - red:.1f} {1.0 - green:.1f} {1.0 - blue:.1f}")
    path.write_text(
        "TITLE \"Invert\"\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n"
        + "\n".join(rows)
        + "\n",
        encoding="utf-8",
    )


class FakeRoutes:
    def __init__(self):
        self.registered = []

    def _decorator(self, method, path):
        def decorate(handler):
            self.registered.append((method, path, handler))
            return handler

        return decorate

    def get(self, path):
        return self._decorator("GET", path)

    def post(self, path):
        return self._decorator("POST", path)


class KoOFinisherRegistryTests(unittest.TestCase):
    def setUp(self):
        cache._SOURCE_CACHE.clear()
        cache._NODE_CACHE_IDS.clear()

    def test_workflow_facing_node_contract_is_unchanged(self):
        self.assertEqual(set(nodes.NODE_CLASS_MAPPINGS), {"KoOFinisher"})
        self.assertEqual(nodes.NODE_DISPLAY_NAME_MAPPINGS, {"KoOFinisher": "KoO Finisher"})
        node_class = nodes.NODE_CLASS_MAPPINGS["KoOFinisher"]
        self.assertEqual(
            node_class.INPUT_TYPES(),
            {
                "required": {"image": ("IMAGE",)},
                "optional": {"finisher_settings": ("STRING", {"default": ""})},
                "hidden": {"unique_id": "UNIQUE_ID"},
            },
        )
        self.assertEqual(node_class.RETURN_TYPES, ("IMAGE",))
        self.assertEqual(node_class.RETURN_NAMES, ("image",))
        self.assertEqual(node_class.FUNCTION, "cache")
        self.assertTrue(node_class.OUTPUT_NODE)
        self.assertEqual(node_class.CATEGORY, "KoO/Post Processing")

    def test_node_returns_the_original_final_image_and_emits_preview_metadata(self):
        image = torch.linspace(0.0, 1.0, 2 * 3 * 4 * 3).reshape(2, 3, 4, 3)
        result = nodes.KoOFinisher().cache(image, unique_id="workflow-node-17")
        self.assertIs(result["result"][0], image)
        payload = result["ui"]["koo_finisher"][0]
        self.assertEqual(payload["node_id"], "workflow-node-17")
        self.assertEqual(payload["width"], 4)
        self.assertEqual(payload["height"], 3)
        self.assertEqual(payload["channels"], 3)
        self.assertEqual(payload["count"], 2)


class KoOFinisherPolishTests(unittest.TestCase):
    def setUp(self):
        cache._SOURCE_CACHE.clear()
        cache._NODE_CACHE_IDS.clear()
        self.image = torch.linspace(0, 1, 33).reshape(1, 1, 33, 1).expand(1, 1, 33, 3).clone()

    def test_old_execution_without_new_settings_still_passes_through_and_never_saves(self):
        with patch.object(nodes, "save_finished_image") as save:
            self.assertIs(nodes.KoOFinisher().cache(self.image, "old")["result"][0], self.image)
            save.assert_not_called()

    def test_neutral_midtones_unchanged(self):
        self.assertTrue(torch.equal(processing.apply_finishing(self.image, {"contrast": 17}),
                                    processing.apply_finishing(self.image, {"contrast": 17, "midtones": 0})))

    def test_neutral_whites_unchanged(self):
        self.assertTrue(torch.equal(processing.apply_finishing(self.image, {"exposure": .3}),
                                    processing.apply_finishing(self.image, {"exposure": .3, "whites": 0})))

    def test_neutral_blacks_unchanged(self):
        self.assertTrue(torch.equal(processing.apply_finishing(self.image, {"shadows": 23}),
                                    processing.apply_finishing(self.image, {"shadows": 23, "blacks": 0})))

    def test_old_grading_pipeline_is_bit_identical_with_all_new_defaults(self):
        settings = {"exposure": .3, "contrast": 17, "highlights": 20, "shadows": -15,
                    "temperature": 12, "tint": -9, "vibrance": 8, "saturation": -11}
        # Disabling the added stage represents the legacy pipeline for this fixture.
        with patch.object(processing, "_tonal_ranges", side_effect=lambda image, *args: image):
            legacy = processing.apply_finishing(self.image, settings)
        actual = processing.apply_finishing(self.image, {**settings, "midtones": 0, "whites": 0, "blacks": 0})
        self.assertTrue(torch.equal(legacy, actual))

    def test_controls_change_output_in_their_tonal_ranges(self):
        for name in ("midtones", "whites", "blacks"):
            for value in (-50, 50):
                with self.subTest(name=name, value=value):
                    result = processing.apply_finishing(self.image, {name: value})
                    self.assertFalse(torch.equal(result, self.image))
                    delta = (result - self.image).abs()[0, 0, :, 0]
                    if name == "midtones":
                        self.assertEqual(delta[0].item(), 0)
                        self.assertEqual(delta[-1].item(), 0)
                        self.assertGreater(delta[16].item(), .05)
                    elif name == "whites":
                        self.assertTrue(torch.equal(result[..., :21, :], self.image[..., :21, :]))
                    else:
                        self.assertTrue(torch.equal(result[..., 12:, :], self.image[..., 12:, :]))

    def test_auto_save_off_does_not_save(self):
        with patch.object(nodes, "save_finished_image") as save:
            nodes.KoOFinisher().cache(self.image, "off", json.dumps({"auto_save": False}))
            save.assert_not_called()

    def test_auto_save_on_saves_once_per_execution_with_export_settings(self):
        payload = {"auto_save": True, "settings": {"midtones": 17}, "output_folder": "test-folder",
                   "filename_prefix": "test-prefix", "format": "WEBP", "quality": 81}
        with patch.object(nodes, "save_finished_image", return_value={"ok": True}) as save:
            for i in range(2):
                result = nodes.KoOFinisher().cache(self.image, "on", json.dumps(payload))
                self.assertEqual(save.call_count, i + 1)
                actual = save.call_args.args[0]
                self.assertEqual({k: actual[k] for k in payload}, payload)
                self.assertEqual(actual["cache_id"], result["ui"]["koo_finisher"][0]["cache_id"])
        self.assertNotEqual(nodes.KoOFinisher.IS_CHANGED(self.image, finisher_settings=json.dumps(payload)),
                            nodes.KoOFinisher.IS_CHANGED(self.image, finisher_settings=json.dumps(payload)))

    def test_auto_save_uses_each_existing_encoder_and_final_settings(self):
        for format_name, pil_format in (("PNG", "PNG"), ("JPG", "JPEG"), ("WEBP", "WEBP")):
            with self.subTest(format=format_name), tempfile.TemporaryDirectory() as folder:
                payload = {"auto_save": True, "settings": {"midtones": 30}, "output_folder": folder,
                           "filename_prefix": "auto", "format": format_name, "quality": 91}
                with patch.object(cache, "apply_finishing", wraps=processing.apply_finishing) as process:
                    nodes.KoOFinisher().cache(self.image, "encoding", json.dumps(payload))
                    process.assert_called_once()
                files = list(Path(folder).iterdir())
                self.assertEqual(len(files), 1)
                with Image.open(files[0]) as saved:
                    self.assertEqual(saved.format, pil_format)
                    self.assertGreater(saved.getpixel((16, 0))[0], 128)

    def test_original_preview_never_invokes_processing_or_save(self):
        info = cache.cache_source_image(self.image, "compare")
        with patch.object(cache, "apply_finishing") as process, patch.object(cache, "save_finished_image") as save:
            raw = cache.render_preview(info["cache_id"], {"exposure": 4}, original=True)
            process.assert_not_called()
            save.assert_not_called()
        with Image.open(BytesIO(raw)) as image:
            self.assertEqual(image.getpixel((16, 0)), (128, 128, 128))

    def test_workflows_with_same_node_id_keep_distinct_bounded_sources(self):
        first = cache.cache_source_image(self.image, "1")
        cache.cache_source_image(self.image * 0, "1")
        self.assertTrue(torch.equal(cache.get_cached_source(first["cache_id"]), self.image))
        for _ in range(cache._MAX_CACHE_ENTRIES + 1):
            cache.cache_source_image(self.image, "1")
        self.assertEqual(len(cache._SOURCE_CACHE), cache._MAX_CACHE_ENTRIES)
        self.assertEqual(len(cache._NODE_CACHE_IDS), 1)


class KoOFinisherLutAndOutputTests(unittest.TestCase):
    def test_new_settings_use_user_data_and_legacy_settings_remain_readable(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            legacy = base / 'legacy/settings.json'
            legacy.parent.mkdir(); legacy.write_text('{"lut_folder":"legacy"}', encoding='utf-8')
            paths = make_module('folder_paths', get_user_directory=lambda: str(base / 'user'))
            with patch.object(processing, 'SETTINGS_PATH', legacy), temporary_modules({'folder_paths': paths}):
                self.assertEqual(processing.load_settings()['lut_folder'], 'legacy')
                processing.save_settings('new')
                self.assertEqual(processing.load_settings()['lut_folder'], 'new')
                self.assertEqual(json.loads(legacy.read_text())['lut_folder'], 'legacy')
                self.assertTrue((base / 'user/KoO/finisher/settings.json').is_file())

    def setUp(self):
        cache._SOURCE_CACHE.clear()
        cache._NODE_CACHE_IDS.clear()
        processing._LUT_CACHE.clear()

    def test_lut_settings_enumeration_loading_and_visual_result(self):
        with tempfile.TemporaryDirectory() as temporary:
            temporary_path = Path(temporary)
            lut_root = temporary_path / "luts"
            nested = lut_root / "film"
            nested.mkdir(parents=True)
            write_invert_cube(nested / "invert.cube")
            settings_path = temporary_path / "config" / "settings.json"

            with patch.object(processing, "SETTINGS_PATH", settings_path), temporary_modules({"folder_paths": folder_paths_stub}):
                processing.save_settings(str(lut_root))
                self.assertEqual(json.loads(settings_path.read_text(encoding="utf-8"))["lut_folder"], str(lut_root))
                scan = processing.scan_lut_folder()
                self.assertTrue(scan["exists"])
                self.assertEqual(scan["status"], "1 LUT found")
                self.assertEqual(
                    scan["luts"],
                    [{"name": "film / invert", "relative_path": "film/invert.cube", "extension": ".cube"}],
                )

                source = torch.tensor([[[[0.25, 0.50, 0.75]]]], dtype=torch.float32)
                result = processing.apply_finishing(
                    source,
                    {"lut": "film / invert", "lut_strength": 100},
                )
                expected = torch.tensor([[[[0.75, 0.50, 0.25]]]], dtype=torch.float32)
                self.assertTrue(torch.allclose(result, expected, atol=1e-6))

    def test_preview_and_direct_save_use_the_same_processing_pipeline(self):
        source = torch.zeros((1, 8, 12, 3), dtype=torch.float32)
        source[..., 0] = 0.25
        source[..., 1] = 0.50
        source[..., 2] = 0.75
        metadata = cache.cache_source_image(source, "preview-node")
        settings = {"exposure": 1.0, "contrast": 10, "grain": 0}

        preview_bytes = cache.render_preview(metadata["cache_id"], settings, max_size=1200)
        self.assertTrue(preview_bytes.startswith(b"\x89PNG\r\n\x1a\n"))
        with Image.open(BytesIO(preview_bytes)) as preview:
            self.assertEqual(preview.size, (12, 8))
            self.assertEqual(preview.mode, "RGB")

        with tempfile.TemporaryDirectory() as output_directory:
            result = cache.save_finished_image(
                {
                    "cache_id": metadata["cache_id"],
                    "settings": settings,
                    "output_folder": output_directory,
                    "filename_prefix": "migration_test",
                    "format": "PNG",
                    "quality": 95,
                }
            )
            self.assertTrue(result["ok"])
            self.assertEqual(result["count"], 1)
            output_path = Path(result["files"][0]["path"])
            self.assertEqual(output_path.name, "migration_test_00001.png")
            self.assertTrue(output_path.is_file())
            with Image.open(output_path) as saved:
                self.assertEqual(saved.size, (12, 8))


class KoOFinisherRouteAndFrontendTests(unittest.TestCase):
    def test_cross_origin_writes_and_remote_desktop_actions_are_rejected(self):
        fake_routes = FakeRoutes()
        fake_server = make_module('server', PromptServer=SimpleNamespace(instance=SimpleNamespace(routes=fake_routes)))
        routes._ROUTES_REGISTERED = False
        try:
            with temporary_modules({'server': fake_server}):
                routes.register_routes()
            handlers = {path: handler for method, path, handler in fake_routes.registered if method == 'POST'}
            request = SimpleNamespace(headers={'Origin': 'https://foreign.invalid'}, host='localhost:8188', remote='127.0.0.1')
            self.assertEqual(asyncio.run(handlers['/koo/finisher/save'](request)).status, 403)
            request = SimpleNamespace(headers={}, host='192.0.2.1:8188', remote='192.0.2.2')
            with patch.object(routes, 'select_output_folder') as opener:
                self.assertEqual(asyncio.run(handlers['/koo/finisher/select_folder'](request)).status, 403)
                opener.assert_not_called()
        finally:
            routes._ROUTES_REGISTERED = False

    def test_backend_route_contract_registers_once(self):
        fake_routes = FakeRoutes()
        fake_server = make_module(
            "server",
            PromptServer=SimpleNamespace(instance=SimpleNamespace(routes=fake_routes)),
        )
        routes._ROUTES_REGISTERED = False
        try:
            with temporary_modules({"server": fake_server}):
                self.assertTrue(routes.register_routes())
                self.assertTrue(routes.register_routes())
        finally:
            routes._ROUTES_REGISTERED = False

        self.assertEqual(
            [(method, path) for method, path, _handler in fake_routes.registered],
            [
                ("GET", "/koo/finisher/lut_config"),
                ("GET", "/koo/finisher/presets"),
                ("POST", "/koo/finisher/presets"),
                ("POST", "/koo/finisher/lut_config"),
                ("GET", "/koo/finisher/luts"),
                ("GET", "/koo/finisher/lut_data"),
                ("POST", "/koo/finisher/preview"),
                ("POST", "/koo/finisher/save"),
                ("POST", "/koo/finisher/select_folder"),
            ],
        )

    def test_frontend_and_nodes_2_contract_load_only_from_koo_nodes(self):
        frontend_path = ROOT / "web" / "koo_finisher.js"
        source = frontend_path.read_text(encoding="utf-8")
        self.assertIn('import { app } from "../../../scripts/app.js";', source)
        self.assertIn('const NODE_NAME = "KoOFinisher";', source)
        self.assertIn('name: "KoO.StandaloneFinisher"', source)
        self.assertEqual(source.count('name: "KoO.StandaloneFinisher"'), 1)
        self.assertIn("beforeRegisterNodeDef(nodeType, nodeData)", source)
        self.assertIn("data.properties.koo_finisher_state = state", source)
        self.assertIn("const SHOULD_REGISTER_KOO_FINISHER", source)
        self.assertNotIn("koolook", source.lower())
        for route_path in (
            "/koo/finisher/lut_config",
            "/koo/finisher/preview",
            "/koo/finisher/save",
            "/koo/finisher/select_folder",
        ):
            self.assertIn(route_path, source)

        # This package must be testable without any unrelated sibling project.
        self.assertIn("KoOFinisher", package.NODE_CLASS_MAPPINGS)



class KoONodesPackageImportTests(unittest.TestCase):
    def test_root_package_import_registers_one_finisher_and_25_total_nodes(self):
        comfy = make_module("comfy")
        comfy.__path__ = []
        comfy_sample = make_module("comfy.sample", prepare_noise=lambda *args, **kwargs: None)
        comfy_model_management = make_module(
            "comfy.model_management",
            intermediate_device=lambda: "cpu",
            intermediate_dtype=lambda: torch.float32,
        )
        comfy.sample = comfy_sample
        comfy.model_management = comfy_model_management
        folder_paths = make_module(
            "folder_paths",
            models_dir=str(ROOT),
            get_input_directory=lambda: str(ROOT),
            get_output_directory=lambda: tempfile.gettempdir(),
            filter_files_content_types=lambda files, _types: files,
            get_annotated_filepath=lambda name: name,
            exists_annotated_filepath=lambda _name: True,
        )
        stubs = {
            "comfy": comfy,
            "comfy.utils": make_module("comfy.utils"),
            "comfy.sample": comfy_sample,
            "comfy.model_management": comfy_model_management,
            "folder_paths": folder_paths,
            "node_helpers": make_module(
                "node_helpers",
                pillow=lambda function, *args, **kwargs: function(*args, **kwargs),
            ),
            "nodes": make_module("nodes", MAX_RESOLUTION=16384),
            "server": make_module("server", PromptServer=SimpleNamespace(instance=None)),
        }
        root_package_name = "koo_nodes_finisher_import_test"
        package_spec = importlib.util.spec_from_file_location(
            root_package_name,
            ROOT / "__init__.py",
            submodule_search_locations=[str(ROOT)],
        )
        if package_spec is None or package_spec.loader is None:
            self.fail("Could not create the KoO Nodes package import spec")

        try:
            with temporary_modules(stubs):
                root_package = importlib.util.module_from_spec(package_spec)
                sys.modules[root_package_name] = root_package
                package_spec.loader.exec_module(root_package)
            self.assertEqual(root_package.WEB_DIRECTORY, "./web")
            self.assertEqual(len(root_package.NODE_CLASS_MAPPINGS), 25)
            self.assertEqual(len(root_package.NODE_DISPLAY_NAME_MAPPINGS), 25)
            self.assertEqual(list(root_package.NODE_CLASS_MAPPINGS).count("KoOFinisher"), 1)
            self.assertEqual(root_package.NODE_DISPLAY_NAME_MAPPINGS["KoOFinisher"], "KoO Finisher")
        finally:
            for name in list(sys.modules):
                if name == root_package_name or name.startswith(root_package_name + "."):
                    sys.modules.pop(name, None)


if __name__ == "__main__":
    unittest.main()
