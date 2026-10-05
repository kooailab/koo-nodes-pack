import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path

import torch


ROOT = Path(__file__).resolve().parents[1]
PKG_DIR = ROOT / "nodes" / "resolution_next"
PACKAGE = "koo_sigma_test"
package = types.ModuleType(PACKAGE)
package.__path__ = [str(PKG_DIR)]
sys.modules.setdefault(PACKAGE, package)


def _load(name):
    qualified = f"{PACKAGE}.{name}"
    spec = importlib.util.spec_from_file_location(qualified, PKG_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[qualified] = module
    spec.loader.exec_module(module)
    return module


_load("sigma_presets")
engine = _load("sigma_engine")
node_module = _load("sigma_equalizer")


def options(**overrides):
    values = {
        "reference_values": [14.6, 10.0, 6.0, 3.0, 1.6, 0.8, 0.2, 0.0],
        "mode": "AUTO",
        "profile": "Balanced Generation",
        "sigma_range_mode": "FULL RANGE",
        "range_source": "AUTO / INPUT",
        "steps": 30,
        "fallback_max_sigma": 14.6,
        "custom_max_sigma": 12.0,
        "handoff_sigma": 1.6,
        "denoise_active_range": 1.0,
        "input_already_cropped": "Auto",
        "output_steps_override_enabled": False,
        "output_steps_override": 0,
        "structure_creativity": 55,
        "shapes_materials": 52,
        "microdetail": 50,
        "final_cleanup": 48,
        "curve_strength": 100,
        "reference_blend": 0,
        "smoothness": 0,
        "interpolation_type": "Linear",
        "high_to_mid_boundary": 0.66,
        "mid_to_low_boundary": 0.22,
        "tail_length": 0.055,
        "curve_gamma": 1.0,
        "tail_exponent": 1.0,
        "manual_curve_points": "[]",
        "normalized_manual_points": "",
        "lock_monotonic_curve": True,
        "prevent_duplicate_sigmas": True,
        "normalize_endpoints": True,
        "clamp_to_input_range": True,
        "preserve_final_zero": True,
        "allow_sigma_expansion": False,
    }
    values.update(overrides)
    return values


def assert_valid(testcase, result, expected_steps=None):
    testcase.assertGreaterEqual(len(result.values), 2)
    testcase.assertTrue(all(value >= 0 and value == value for value in result.values))
    testcase.assertTrue(all(left > right for left, right in zip(result.values[:-1], result.values[1:])))
    if expected_steps is not None:
        testcase.assertEqual(len(result.values), expected_steps + 1)


def node_kwargs(**overrides):
    required = node_module.KoOSigmaEqualizer.INPUT_TYPES()["required"]
    values = {name: definition[1].get("default") for name, definition in required.items()}
    values.update(overrides)
    return values


class SigmaEqualizerTests(unittest.TestCase):
    def assertApproxList(self, actual, expected, delta):
        self.assertEqual(len(actual), len(expected))
        for left, right in zip(actual, expected):
            self.assertAlmostEqual(left, right, delta=delta)

    def test_full_schedule_uses_input_range_not_fallback(self):
        result = engine.build_schedule(**options(fallback_max_sigma=99.0))
        self.assertAlmostEqual(result.values[0], 14.6)
        self.assertEqual(result.values[-1], 0.0)
        self.assertEqual(result.source_kind, "input")
        assert_valid(self, result)

    def test_degenerate_input_uses_fallback_only_when_range_is_unusable(self):
        result = engine.build_schedule(**options(reference_values=[0.0, 0.0], steps=6, fallback_max_sigma=7.5))
        self.assertEqual(result.source_kind, "fallback")
        self.assertAlmostEqual(result.values[0], 7.5)
        self.assertEqual(len(result.values), 7)
        self.assertTrue(any("no usable numeric range" in warning for warning in result.warnings))

    def test_cropped_low_schedule_is_not_expanded_to_model_max(self):
        low = [1.6, 1.15, 0.82, 0.58, 0.4, 0.26, 0.14, 0.055, 0.0]
        result = engine.build_schedule(**options(reference_values=low, mode="SECOND SAMPLER", profile="Detail Refiner", sigma_range_mode="LOW SIGMA", fallback_max_sigma=50))
        self.assertAlmostEqual(result.values[0], 1.6)
        self.assertEqual(result.values[-1], 0.0)
        self.assertEqual(result.classification, "cropped-low")
        assert_valid(self, result, 8)

    def test_auto_classifies_cropped_low_input_as_second_sampler(self):
        for start in (1.6, 1.2, 1.07):
            with self.subTest(start=start):
                result = engine.build_schedule(**options(reference_values=[start, start * 0.6, start * 0.2, 0], mode="AUTO"))
                self.assertEqual(result.workflow, "SECOND SAMPLER")
                self.assertEqual(result.classification, "cropped-low")
                self.assertAlmostEqual(result.values[0], start)

    def test_auto_classifies_cropped_high_input_as_first_sampler(self):
        result = engine.build_schedule(**options(reference_values=[14.6, 9.0, 5.0, 2.8, 1.6], mode="AUTO"))
        self.assertEqual(result.workflow, "FIRST SAMPLER")
        self.assertEqual(result.classification, "cropped-high")

    def test_img2img_does_not_crop_detected_low_input_twice(self):
        low = [1.2, 0.8, 0.5, 0.25, 0.0]
        result = engine.build_schedule(**options(reference_values=low, mode="IMG2IMG REFINE", profile="Conservative Refine", sigma_range_mode="LOW SIGMA", denoise_active_range=0.2))
        self.assertEqual(len(result.active_reference), len(low))
        self.assertAlmostEqual(result.active_reference[0], 1.2)

    def test_cropped_high_schedule_preserves_nonzero_handoff(self):
        high = [14.6, 10.2, 7.4, 4.8, 2.7, 1.6]
        result = engine.build_schedule(**options(reference_values=high, mode="FIRST SAMPLER", sigma_range_mode="HIGH SIGMA", handoff_sigma=1.6))
        self.assertAlmostEqual(result.values[0], 14.6)
        self.assertAlmostEqual(result.values[-1], 1.6)
        assert_valid(self, result, 5)

    def test_full_range_extends_an_available_high_only_input_to_zero(self):
        result = engine.build_schedule(**options(reference_values=[14.6, 7.0, 3.0, 1.6], mode="FIRST SAMPLER", sigma_range_mode="FULL RANGE"))
        self.assertEqual(result.values[-1], 0.0)
        self.assertEqual(result.classification, "cropped-high")

    def test_second_sampler_can_start_from_upstream_terminal_sigma(self):
        high_only = [14.6, 8.0, 4.0, 2.4, 1.6]
        result = engine.build_schedule(**options(reference_values=high_only, mode="SECOND SAMPLER", profile="Detail Refiner", sigma_range_mode="LOW SIGMA", output_steps_override_enabled=True, output_steps_override=8))
        self.assertAlmostEqual(result.values[0], 1.6)
        self.assertEqual(result.values[-1], 0.0)
        assert_valid(self, result, 8)

    def test_numeric_handoff_ranges(self):
        high = engine.build_schedule(**options(sigma_range_mode="HIGH SIGMA", handoff_sigma=1.6))
        low = engine.build_schedule(**options(mode="SECOND SAMPLER", profile="Detail Refiner", sigma_range_mode="LOW SIGMA"))
        self.assertAlmostEqual(high.active_reference[-1], 1.6)
        self.assertAlmostEqual(low.active_reference[0], 1.6)
        self.assertEqual(low.values[-1], 0.0)

    def test_final_zero_preservation(self):
        result = engine.build_schedule(**options(preserve_final_zero=True))
        self.assertEqual(result.values[-1], 0.0)

    def test_monotonic_enforcement_and_duplicate_prevention(self):
        manual = json.dumps([{"x": 0, "sigma": 1.6}, {"x": 0.25, "sigma": 1.2}, {"x": 0.5, "sigma": 1.4}, {"x": 0.75, "sigma": 1.2}, {"x": 1, "sigma": 0}])
        result = engine.build_schedule(**options(reference_values=[1.6, 1.2, 0.8, 0.4, 0], mode="CUSTOM", profile="Custom", sigma_range_mode="LOW SIGMA", manual_curve_points=manual))
        assert_valid(self, result)
        self.assertTrue(any("non-monotonic manual" in warning for warning in result.warnings))

    def test_degenerate_manual_curve_is_repaired_to_valid_schedule(self):
        manual = json.dumps([{"x": 0, "sigma": 0.5}, {"x": 0.5, "sigma": 0.5}, {"x": 1, "sigma": 0.5}])
        result = engine.build_schedule(**options(reference_values=[1.6, 0.8, 0], mode="CUSTOM", profile="Custom", manual_curve_points=manual, normalize_endpoints=False, preserve_final_zero=False, output_steps_override_enabled=True, output_steps_override=2))
        assert_valid(self, result, 2)

    def test_two_point_duplicate_manual_curve_is_repaired(self):
        manual = '[{"x":0,"sigma":0.5},{"x":1,"sigma":0.5}]'
        result = engine.build_schedule(**options(reference_values=[1.6, 0], mode="CUSTOM", profile="Custom", manual_curve_points=manual, normalize_endpoints=False, preserve_final_zero=False, output_steps_override_enabled=True, output_steps_override=1))
        assert_valid(self, result, 1)

    def test_normalize_endpoints_and_clamp_to_input_range(self):
        manual = json.dumps([{"x": 0, "sigma": 9}, {"x": 0.5, "sigma": 0.8}, {"x": 1, "sigma": 0.2}])
        result = engine.build_schedule(**options(reference_values=[1.6, 1.0, 0.5, 0], mode="CUSTOM", profile="Custom", sigma_range_mode="LOW SIGMA", manual_curve_points=manual))
        self.assertAlmostEqual(result.values[0], 1.6)
        self.assertEqual(result.values[-1], 0.0)
        self.assertLessEqual(max(result.values), 1.6)

    def test_exact_manual_sigma_list_is_not_smoothed(self):
        exact = [1.6, 1.15, 0.82, 0.58, 0.4, 0.26, 0.14, 0.055, 0.0]
        manual = json.dumps([{"x": index / 8, "sigma": sigma} for index, sigma in enumerate(exact)])
        result = engine.build_schedule(**options(reference_values=[1.6, 1.2, 0.9, 0.7, 0.5, 0.34, 0.2, 0.08, 0], mode="CUSTOM", profile="Custom", sigma_range_mode="LOW SIGMA", manual_curve_points=manual, smoothness=100, output_steps_override_enabled=True, output_steps_override=8))
        self.assertApproxList(result.values, exact, 1e-7)

    def test_reference_blend_has_canonical_direction(self):
        reference = [1.6, 1.2, 0.9, 0.65, 0.45, 0.28, 0.14, 0.055, 0.0]
        generated = engine.build_schedule(**options(
            reference_values=reference,
            mode="SECOND SAMPLER",
            profile="Microdetail",
            sigma_range_mode="LOW SIGMA",
            curve_strength=100,
            reference_blend=0,
        ))
        preserved = engine.build_schedule(**options(
            reference_values=reference,
            mode="SECOND SAMPLER",
            profile="Microdetail",
            sigma_range_mode="LOW SIGMA",
            curve_strength=100,
            reference_blend=100,
        ))
        self.assertApproxList(preserved.values, reference, 1e-10)
        self.assertTrue(any(abs(left - right) > 1e-4 for left, right in zip(generated.values, reference)))
        self.assertNotEqual(generated.values, preserved.values)

    def test_allow_expansion_controls_manual_values_outside_active_range(self):
        manual = json.dumps([{"x": 0, "sigma": 1.6}, {"x": 0.5, "sigma": 2.4}, {"x": 1, "sigma": 0}])
        common = options(reference_values=[1.6, 0.8, 0], mode="CUSTOM", profile="Custom", sigma_range_mode="LOW SIGMA", manual_curve_points=manual, lock_monotonic_curve=False, output_steps_override_enabled=True, output_steps_override=2)
        clamped = engine.build_schedule(**common)
        expanded = engine.build_schedule(**{**common, "allow_sigma_expansion": True})
        self.assertLessEqual(max(clamped.values), 1.6)
        self.assertGreater(max(expanded.values), 1.6)

    def test_detail_refiner_scale_independent_shape(self):
        expected = [1.6, 1.15, 0.82, 0.58, 0.40, 0.26, 0.14, 0.055, 0.0]
        controls = dict(mode="SECOND SAMPLER", profile="Detail Refiner", sigma_range_mode="LOW SIGMA", structure_creativity=30, shapes_materials=60, microdetail=72, final_cleanup=68)
        result = engine.build_schedule(**options(reference_values=[1.6, 1.2, 0.9, 0.7, 0.5, 0.34, 0.2, 0.08, 0], **controls))
        self.assertApproxList(result.values, expected, 0.15)
        scaled = engine.build_schedule(**options(reference_values=[0.8, 0.6, 0.45, 0.35, 0.25, 0.17, 0.1, 0.04, 0], **controls))
        self.assertApproxList([value / 0.8 for value in scaled.values], [value / 1.6 for value in result.values], 0.03)

    def test_high_presets_are_meaningfully_different(self):
        creative = engine.build_schedule(**options(mode="FIRST SAMPLER", profile="Creative Expansion", sigma_range_mode="HIGH SIGMA", output_steps_override_enabled=True, output_steps_override=8))
        fast = engine.build_schedule(**options(mode="FIRST SAMPLER", profile="Fast Composition", sigma_range_mode="HIGH SIGMA", output_steps_override_enabled=True, output_steps_override=8))
        self.assertGreater(creative.values[3], fast.values[3])
        self.assertAlmostEqual(creative.values[-1], 1.6)
        self.assertAlmostEqual(fast.values[-1], 1.6)

    def test_arbitrary_output_step_counts(self):
        for steps in (4, 6, 8, 12, 16, 20):
            with self.subTest(steps=steps):
                result = engine.build_schedule(**options(output_steps_override_enabled=True, output_steps_override=steps))
                assert_valid(self, result, steps)

    def test_malformed_manual_data_is_repaired(self):
        for payload in ("", "not json", "[null, {}, []]", '[{"x":"nan","sigma":"inf"}]'):
            with self.subTest(payload=payload):
                result = engine.build_schedule(**options(reference_values=[1.6, 0.8, 0], mode="CUSTOM", profile="Custom", sigma_range_mode="LOW SIGMA", manual_curve_points=payload))
                assert_valid(self, result)
                self.assertTrue(any("malformed" in warning for warning in result.warnings))

    def test_legacy_modes_remain_accepted(self):
        for legacy in ("Auto", "TXT2IMG", "IMG2IMG", "Manual"):
            with self.subTest(mode=legacy):
                result = engine.build_schedule(**options(mode=legacy))
                self.assertGreaterEqual(len(result.values), 2)
                self.assertIn(result.workflow, {"FIRST SAMPLER", "IMG2IMG REFINE", "CUSTOM"})

    def test_legacy_zero_blend_still_means_reference_bypass(self):
        reference = [14.6, 7.0, 2.0, 0.0]
        result = engine.build_schedule(**options(reference_values=reference, mode="TXT2IMG", profile="Creative TXT2IMG", reference_blend=0, curve_strength=100))
        self.assertApproxList(result.values, reference, 1e-7)

    def test_explicit_range_sources_are_opt_in(self):
        model = engine.build_schedule(**options(reference_values=[1.2, 0.5, 0], range_source="MODEL FULL RANGE", fallback_max_sigma=20))
        custom = engine.build_schedule(**options(reference_values=[1.2, 0.5, 0], range_source="CUSTOM MAX SIGMA", custom_max_sigma=9))
        self.assertAlmostEqual(model.source[0], 20)
        self.assertAlmostEqual(custom.source[0], 9)

    def test_legacy_widget_order_is_unchanged(self):
        required = list(node_module.KoOSigmaEqualizer.INPUT_TYPES()["required"])
        self.assertEqual(required[-2:], ["output_steps_override_enabled", "output_steps_override"])
        optional = list(node_module.KoOSigmaEqualizer.INPUT_TYPES()["optional"])
        self.assertEqual(optional[:4], ["reference_sigmas", "denoise", "external_strength", "external_reference_blend"])

    def test_node_output_shape_dtype_and_device(self):
        node = node_module.KoOSigmaEqualizer()
        kwargs = node_kwargs(mode="SECOND SAMPLER", profile="Detail Refiner", sigma_range_mode="LOW SIGMA", reference_sigmas=torch.tensor([1.6, 1.0, 0.5, 0.0], dtype=torch.float64))
        tensor, info = node.equalize(**kwargs)
        self.assertEqual(tensor.ndim, 1)
        self.assertEqual(tensor.dtype, torch.float64)
        self.assertEqual(tensor.device.type, "cpu")
        self.assertEqual(tensor.numel(), 4)
        self.assertIn("finite True", info)

    def test_node_diagnostics_prove_connected_input_and_transformation(self):
        reference = torch.tensor([1.6, 1.2, 0.9, 0.65, 0.45, 0.28, 0.14, 0.055, 0.0], dtype=torch.float32)
        tensor, info = node_module.KoOSigmaEqualizer().equalize(**node_kwargs(
            mode="SECOND SAMPLER",
            profile="Microdetail",
            sigma_range_mode="LOW SIGMA",
            range_source="AUTO / INPUT",
            curve_strength=100,
            reference_blend=0,
            smoothness=0,
            reference_sigmas=reference,
        ))
        self.assertIn("reference_sigmas_received True", info)
        self.assertIn("reference_sigmas_type torch.Tensor", info)
        self.assertIn("reference_sigmas_shape (9,)", info)
        self.assertIn("source input", info)
        self.assertIn("fallback_generated False", info)
        self.assertIn("workflow_mode SECOND SAMPLER -> SECOND SAMPLER", info)
        self.assertIn("range_mode LOW SIGMA -> LOW SIGMA", info)
        self.assertIn("tensor_length 9 | transitions 8", info)
        self.assertIn("input_equals_output False", info)
        self.assertFalse(torch.equal(reference, tensor))

    def test_node_reference_blend_100_is_exact_input(self):
        reference = torch.tensor([1.6, 1.2, 0.9, 0.65, 0.45, 0.28, 0.14, 0.055, 0.0], dtype=torch.float64)
        tensor, info = node_module.KoOSigmaEqualizer().equalize(**node_kwargs(
            mode="SECOND SAMPLER", profile="Microdetail", sigma_range_mode="LOW SIGMA",
            curve_strength=100, reference_blend=100, reference_sigmas=reference,
        ))
        self.assertTrue(torch.equal(reference, tensor))
        self.assertIn("reference_blend 100.000% -> effective 100.000%", info)
        self.assertIn("input_equals_output True", info)

    def test_node_manual_schedule_is_exact_and_reports_transition_count(self):
        exact = [1.6, 1.15, 0.82, 0.58, 0.40, 0.26, 0.14, 0.055, 0.0]
        manual = json.dumps([{"id": str(index), "x": index / 8, "sigma": sigma} for index, sigma in enumerate(exact)])
        reference = torch.tensor([1.6, 1.2, 0.9, 0.65, 0.45, 0.28, 0.14, 0.055, 0.0], dtype=torch.float64)
        tensor, info = node_module.KoOSigmaEqualizer().equalize(**node_kwargs(
            mode="CUSTOM", profile="Custom", sigma_range_mode="LOW SIGMA",
            reference_blend=0, smoothness=100, output_steps_override_enabled=True,
            output_steps_override=8, manual_curve_points=manual, reference_sigmas=reference,
        ))
        self.assertApproxList(tensor.tolist(), exact, 1e-12)
        self.assertIn("manual_points_present True", info)
        self.assertIn("manual_points_count 9", info)
        self.assertIn("manual_controlling_output True", info)
        self.assertIn("tensor_length 9 | transitions 8", info)

    def test_node_high_and_low_ranges_have_sampler_handoff_endpoints(self):
        reference = torch.tensor([14.6, 10.0, 6.0, 3.0, 1.8, 1.2, 0.6, 0.0], dtype=torch.float64)
        common = dict(profile="Balanced Generation", reference_blend=100, handoff_sigma=1.6, reference_sigmas=reference)
        high, high_info = node_module.KoOSigmaEqualizer().equalize(**node_kwargs(mode="FIRST SAMPLER", sigma_range_mode="HIGH SIGMA", **common))
        low, low_info = node_module.KoOSigmaEqualizer().equalize(**node_kwargs(mode="SECOND SAMPLER", sigma_range_mode="LOW SIGMA", **common))
        self.assertAlmostEqual(float(high[-1]), 1.6)
        self.assertNotEqual(float(high[-1]), 0.0)
        self.assertAlmostEqual(float(low[0]), 1.6)
        self.assertEqual(float(low[-1]), 0.0)
        self.assertIn("range_mode HIGH SIGMA -> HIGH SIGMA", high_info)
        self.assertIn("range_mode LOW SIGMA -> LOW SIGMA", low_info)

    def test_downstream_consumer_receives_the_altered_tensor(self):
        class SamplerInputProbe:
            received = None

            def consume(self, sigmas):
                self.received = sigmas

        reference = torch.tensor([1.6, 1.2, 0.9, 0.65, 0.45, 0.28, 0.14, 0.055, 0.0])
        output, _ = node_module.KoOSigmaEqualizer().equalize(**node_kwargs(
            mode="SECOND SAMPLER", profile="Microdetail", sigma_range_mode="LOW SIGMA",
            curve_strength=100, reference_blend=0, smoothness=0, reference_sigmas=reference,
        ))
        probe = SamplerInputProbe()
        probe.consume(output)
        self.assertIs(probe.received, output)
        self.assertFalse(torch.equal(probe.received, reference))

    def test_float32_cast_does_not_reintroduce_duplicates(self):
        node = node_module.KoOSigmaEqualizer()
        kwargs = node_kwargs(mode="CUSTOM", profile="Custom", reference_blend=0, smoothness=0, manual_curve_points='[{"x":0,"sigma":14.6},{"x":0.5,"sigma":14.6},{"x":1,"sigma":0}]', reference_sigmas=torch.tensor([14.6, 7.0, 0.0], dtype=torch.float32))
        tensor, _info = node.equalize(**kwargs)
        self.assertTrue(all(float(tensor[index]) > float(tensor[index + 1]) for index in range(tensor.numel() - 1)))


if __name__ == "__main__":
    unittest.main()
