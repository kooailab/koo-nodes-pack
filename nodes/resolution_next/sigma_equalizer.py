"""ComfyUI wrapper for the KoO Sigma Schedule Designer."""

from __future__ import annotations

import hashlib
import json

import torch

from .sigma_engine import build_schedule, parse_sigma_list, safe_float
from .sigma_presets import (
    INPUT_CROPPED_STATES,
    INTERPOLATION_TYPES,
    MODES,
    PROFILES,
    RANGE_SOURCES,
    SIGMA_RANGE_MODES,
    UI_COMPLEXITIES,
)


def _tip(text):
    return {"tooltip": text}


def _repair_cast_duplicates(tensor):
    """Keep a strict schedule strict after conversion to the input dtype."""
    if tensor.numel() < 2 or not tensor.dtype.is_floating_point or float(tensor[0]) <= float(tensor[-1]):
        return tensor, False
    repaired = False
    negative_infinity = torch.tensor(float("-inf"), dtype=tensor.dtype, device=tensor.device)
    positive_infinity = torch.tensor(float("inf"), dtype=tensor.dtype, device=tensor.device)
    for index in range(1, tensor.numel() - 1):
        if tensor[index] >= tensor[index - 1]:
            tensor[index] = torch.nextafter(tensor[index - 1], negative_infinity)
            repaired = True
    if tensor[-1] >= tensor[-2]:
        for index in range(tensor.numel() - 2, 0, -1):
            if tensor[index] <= tensor[index + 1]:
                tensor[index] = torch.nextafter(tensor[index + 1], positive_infinity)
                repaired = True
    return tensor, repaired


def _qualified_type(value):
    if value is None:
        return "None"
    value_type = type(value)
    return f"{value_type.__module__}.{value_type.__qualname__}"


def _tensor_fingerprint(value):
    """Return a small deterministic fingerprint of numeric tensor contents."""
    if not isinstance(value, torch.Tensor):
        return "none"
    try:
        normalized = value.detach().flatten().to(dtype=torch.float64, device="cpu").contiguous()
        return hashlib.sha256(normalized.numpy().tobytes()).hexdigest()[:16]
    except Exception:
        return "unavailable"


def _manual_point_diagnostics(primary, normalized):
    text = normalized or primary or ""
    if not isinstance(text, str) or not text.strip() or text.strip() == "[]":
        return False, 0
    try:
        value = json.loads(text)
        if isinstance(value, list):
            count = sum(isinstance(item, (dict, list, tuple)) for item in value)
            return count > 0, count
    except Exception:
        pass
    count = len(parse_sigma_list(text))
    return count > 0, count


class KoOSigmaEqualizer:
    """Design and validate a sampler-compatible one-dimensional SIGMAS tensor.

    The original widget order is intentionally frozen through
    ``output_steps_override``. New fields are appended so positional
    ``widgets_values`` arrays in existing ComfyUI workflows continue to load.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # Legacy positional block: do not reorder.
                "mode": (MODES, {"default": "AUTO", **_tip("Sampling use case. Legacy mode values are accepted and migrated.")}),
                "profile": (PROFILES, {"default": "Balanced Generation", **_tip("A scale-independent sigma distribution preset.")}),
                "structure_creativity": ("FLOAT", {"default": 55.0, "min": 0.0, "max": 100.0, "step": 1.0, **_tip("Allocates more schedule influence to high sigma structure and large-form creation.")}),
                "shapes_materials": ("FLOAT", {"default": 52.0, "min": 0.0, "max": 100.0, "step": 1.0, **_tip("Allocates more schedule influence to mid-sigma shape and material definition.")}),
                "microdetail": ("FLOAT", {"default": 50.0, "min": 0.0, "max": 100.0, "step": 1.0, **_tip("Allocates more evaluations to low-sigma texture and microdetail.")}),
                "final_cleanup": ("FLOAT", {"default": 48.0, "min": 0.0, "max": 100.0, "step": 1.0, **_tip("Allocates more evaluations to the final cleanup tail.")}),
                "curve_strength": ("FLOAT", {"default": 70.0, "min": 0.0, "max": 100.0, "step": 1.0, **_tip("How strongly the selected preset reshapes the reference schedule.")}),
                "reference_blend": ("FLOAT", {"default": 30.0, "min": 0.0, "max": 100.0, "step": 1.0, **_tip("How strongly the final schedule stays near the original input/reference sigma schedule.")}),
                "smoothness": ("FLOAT", {"default": 35.0, "min": 0.0, "max": 100.0, "step": 1.0, **_tip("Reduces abrupt changes between adjacent sigma intervals.")}),
                "steps": ("INT", {"default": 30, "min": 1, "max": 10000, "step": 1, **_tip("Fallback transition count when no usable SIGMAS input is available.")}),
                "max_sigma": ("FLOAT", {"default": 14.6, "min": 0.000001, "max": 1000.0, "step": 0.01, **_tip("Fallback/model maximum. AUTO / INPUT ignores this whenever incoming SIGMAS are usable.")}),
                "interpolation_type": (INTERPOLATION_TYPES, {"default": "Smoothstep", **_tip("Interpolation used between manual or preset curve anchors.")}),
                "high_to_mid_boundary": ("FLOAT", {"default": 0.66, "min": 0.05, "max": 0.95, "step": 0.01, **_tip("Normalized boundary between high-sigma structure and mid-sigma work.")}),
                "mid_to_low_boundary": ("FLOAT", {"default": 0.22, "min": 0.01, "max": 0.90, "step": 0.01, **_tip("Normalized boundary between mid-sigma material work and low-sigma detail.")}),
                "tail_length": ("FLOAT", {"default": 0.055, "min": 0.001, "max": 0.40, "step": 0.001, **_tip("Normalized size of the final cleanup band.")}),
                "curve_gamma": ("FLOAT", {"default": 1.0, "min": 0.10, "max": 5.0, "step": 0.01, **_tip("Global exponent applied to the generated normalized curve.")}),
                "tail_exponent": ("FLOAT", {"default": 1.0, "min": 0.10, "max": 5.0, "step": 0.01, **_tip("Additional exponent applied inside the low-sigma cleanup tail.")}),
                "txt2img_settings": ("STRING", {"default": "{}", "multiline": False}),
                "img2img_settings": ("STRING", {"default": "{}", "multiline": False}),
                "auto_settings": ("STRING", {"default": "{}", "multiline": False}),
                "manual_curve_points": ("STRING", {"default": '[{"id":"start","x":0,"sigma":14.6},{"id":"end","x":1,"sigma":0}]', "multiline": False, **_tip("Serialized manual curve. Legacy normalized x/y points remain supported.")}),
                "normalized_manual_points": ("STRING", {"default": "", "multiline": False}),
                "lock_monotonic_curve": ("BOOLEAN", {"default": True, **_tip("Prevents sigma increases as sampling progresses.")}),
                "prevent_duplicate_sigmas": ("BOOLEAN", {"default": True, **_tip("Repairs consecutive equal sigma values using an adaptive epsilon.")}),
                "normalize_endpoints": ("BOOLEAN", {"default": True, **_tip("Pins output start/end to the selected input range endpoints.")}),
                "clamp_to_input_range": ("BOOLEAN", {"default": True, **_tip("Keeps all generated values inside the selected incoming sigma range.")}),
                "preserve_final_zero": ("BOOLEAN", {"default": True, **_tip("Preserves zero only for ranges that own a zero endpoint; HIGH SIGMA handoffs remain non-zero.")}),
                "allow_sigma_expansion": ("BOOLEAN", {"default": False, **_tip("Allows generated values up to the available source maximum. AUTO / INPUT never expands a cropped start to fallback max.")}),
                "include_appearance_in_preset": ("BOOLEAN", {"default": False}),
                "denoise_active_range": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01, **_tip("Fraction of the selected range used by IMG2IMG REFINE. Already-cropped inputs are not cropped twice in Auto mode.")}),
                "input_already_cropped": (INPUT_CROPPED_STATES, {"default": "Auto", **_tip("Override numeric cropped-input detection only when necessary.")}),
                "output_steps_override_enabled": ("BOOLEAN", {"default": False, **_tip("Resample the active range to an explicit transition count.")}),
                "output_steps_override": ("INT", {"default": 0, "min": 0, "max": 10000, "step": 1}),
            },
            "optional": {
                "reference_sigmas": ("SIGMAS",),
                "denoise": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "external_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.01}),
                "external_reference_blend": ("FLOAT", {"default": -1.0, "min": -1.0, "max": 100.0, "step": 1.0}),
                # Schema v2 is appended after every legacy widget, including
                # primitive optional inputs, to preserve positional workflows.
                "sigma_range_mode": (SIGMA_RANGE_MODES, {"default": "FULL RANGE", **_tip("FULL uses the available range; HIGH ends at handoff; LOW begins at handoff/available cropped start.")}),
                "range_source": (RANGE_SOURCES, {"default": "AUTO / INPUT", **_tip("AUTO / INPUT trusts incoming SIGMAS. Model/custom sources are explicit opt-ins.")}),
                "custom_max_sigma": ("FLOAT", {"default": 14.6, "min": 0.000001, "max": 1000.0, "step": 0.01, **_tip("Maximum used only when Range Source is CUSTOM MAX SIGMA.")}),
                "handoff_sigma": ("FLOAT", {"default": 1.6, "min": 0.0, "max": 1000.0, "step": 0.001, **_tip("Numeric FIRST-to-SECOND sampler boundary.")}),
                "ui_complexity": (UI_COMPLEXITIES, {"default": "BASIC"}),
                "show_sigma_labels": ("BOOLEAN", {"default": True}),
                "show_step_numbers": ("BOOLEAN", {"default": True}),
                "show_reference_curve": ("BOOLEAN", {"default": True}),
                "show_generated_curve": ("BOOLEAN", {"default": True}),
                "show_final_curve": ("BOOLEAN", {"default": True}),
                "point_table_open": ("BOOLEAN", {"default": False}),
                "workflow_schema_version": ("INT", {"default": 2, "min": 1, "max": 2, "step": 1}),
            },
        }

    RETURN_TYPES = ("SIGMAS", "STRING")
    RETURN_NAMES = ("sigmas", "sigma_info")
    FUNCTION = "equalize"
    CATEGORY = "KoO Tools / Sampling"

    def equalize(
        self,
        mode,
        profile,
        structure_creativity,
        shapes_materials,
        microdetail,
        final_cleanup,
        curve_strength,
        reference_blend,
        smoothness,
        steps,
        max_sigma,
        interpolation_type,
        high_to_mid_boundary,
        mid_to_low_boundary,
        tail_length,
        curve_gamma,
        tail_exponent,
        txt2img_settings,
        img2img_settings,
        auto_settings,
        manual_curve_points,
        normalized_manual_points,
        lock_monotonic_curve,
        prevent_duplicate_sigmas,
        normalize_endpoints,
        clamp_to_input_range,
        preserve_final_zero,
        allow_sigma_expansion,
        include_appearance_in_preset,
        denoise_active_range=1.0,
        input_already_cropped="Auto",
        output_steps_override_enabled=False,
        output_steps_override=0,
        sigma_range_mode="FULL RANGE",
        range_source="AUTO / INPUT",
        custom_max_sigma=14.6,
        handoff_sigma=1.6,
        ui_complexity="BASIC",
        show_sigma_labels=True,
        show_step_numbers=True,
        show_reference_curve=True,
        show_generated_curve=True,
        show_final_curve=True,
        point_table_open=False,
        workflow_schema_version=2,
        reference_sigmas=None,
        denoise=1.0,
        external_strength=1.0,
        external_reference_blend=-1.0,
    ):
        reference_received = reference_sigmas is not None
        reference_type = _qualified_type(reference_sigmas)
        reference_shape = tuple(reference_sigmas.shape) if hasattr(reference_sigmas, "shape") else None
        input_fingerprint = _tensor_fingerprint(reference_sigmas)
        reference_first = None
        reference_last = None
        if reference_sigmas is not None:
            try:
                flattened_reference = reference_sigmas.detach().flatten().to(dtype=torch.float64, device="cpu")
                reference_values = flattened_reference.tolist()
                if flattened_reference.numel():
                    reference_first = float(flattened_reference[0])
                    reference_last = float(flattened_reference[-1])
            except Exception:
                reference_values = reference_sigmas
        else:
            reference_values = None

        result = build_schedule(
            reference_values=reference_values,
            mode=mode,
            profile=profile,
            sigma_range_mode=sigma_range_mode,
            range_source=range_source,
            steps=steps,
            fallback_max_sigma=max_sigma,
            custom_max_sigma=custom_max_sigma,
            handoff_sigma=handoff_sigma,
            denoise_active_range=min(safe_float(denoise_active_range, 1.0), safe_float(denoise, 1.0)),
            input_already_cropped=input_already_cropped,
            output_steps_override_enabled=output_steps_override_enabled,
            output_steps_override=output_steps_override,
            structure_creativity=structure_creativity,
            shapes_materials=shapes_materials,
            microdetail=microdetail,
            final_cleanup=final_cleanup,
            curve_strength=curve_strength,
            reference_blend=reference_blend,
            smoothness=smoothness,
            interpolation_type=interpolation_type,
            high_to_mid_boundary=high_to_mid_boundary,
            mid_to_low_boundary=mid_to_low_boundary,
            tail_length=tail_length,
            curve_gamma=curve_gamma,
            tail_exponent=tail_exponent,
            manual_curve_points=manual_curve_points,
            normalized_manual_points=normalized_manual_points,
            lock_monotonic_curve=lock_monotonic_curve,
            prevent_duplicate_sigmas=prevent_duplicate_sigmas,
            normalize_endpoints=normalize_endpoints,
            clamp_to_input_range=clamp_to_input_range,
            preserve_final_zero=preserve_final_zero,
            allow_sigma_expansion=allow_sigma_expansion,
            external_strength=external_strength,
            external_reference_blend=external_reference_blend,
        )

        device = reference_sigmas.device if hasattr(reference_sigmas, "device") else torch.device("cpu")
        dtype = reference_sigmas.dtype if hasattr(reference_sigmas, "dtype") and reference_sigmas.dtype.is_floating_point else torch.float32
        tensor = torch.tensor(result.values, dtype=dtype, device=device)
        cast_repaired = False
        if bool(prevent_duplicate_sigmas) and bool(lock_monotonic_curve):
            tensor, cast_repaired = _repair_cast_duplicates(tensor)
        finite = bool(torch.isfinite(tensor).all().item())
        monotonic = all(float(tensor[i]) >= float(tensor[i + 1]) for i in range(max(0, tensor.numel() - 1)))
        duplicates = sum(abs(float(tensor[i]) - float(tensor[i + 1])) <= 1e-12 for i in range(max(0, tensor.numel() - 1)))
        output_fingerprint = _tensor_fingerprint(tensor)
        input_equals_output = False
        if isinstance(reference_sigmas, torch.Tensor):
            try:
                comparable_input = reference_sigmas.detach().flatten().to(dtype=tensor.dtype, device="cpu")
                comparable_output = tensor.detach().flatten().to(device="cpu")
                input_equals_output = bool(torch.equal(comparable_input, comparable_output))
            except Exception:
                input_equals_output = False
        manual_present, manual_count = _manual_point_diagnostics(manual_curve_points, normalized_manual_points)
        manual_active = result.workflow == "CUSTOM"
        fallback_generated = result.source_kind == "fallback"
        warning_text = "; ".join(result.warnings) if result.warnings else "none"
        all_repairs = result.repairs + (["removed duplicates introduced by dtype conversion"] if cast_repaired else [])
        repair_text = "; ".join(all_repairs) if all_repairs else "none"
        info = (
            f"KoO Sigma Schedule Designer | reference_sigmas_received {reference_received} | "
            f"reference_sigmas_type {reference_type} | reference_sigmas_shape {reference_shape} | "
            f"reference_sigmas_first {reference_first} | reference_sigmas_last {reference_last} | "
            f"workflow_mode {mode} -> {result.workflow} | range_mode {sigma_range_mode} -> {result.range_mode} | "
            f"preset {profile} | range_source {range_source} -> {result.source_kind} | "
            f"source {result.source_kind} | fallback_generated {fallback_generated} | input_classification {result.classification} | "
            f"reference_blend {safe_float(reference_blend, 0.0):.3f}% -> effective {result.reference_amount:.3f}% | "
            f"manual_points_present {manual_present} | manual_points_count {manual_count} | manual_controlling_output {manual_active} | "
            f"handoff_sigma {safe_float(handoff_sigma, 1.6):.8g} | "
            f"output_steps_override {bool(output_steps_override_enabled)}:{int(output_steps_override)} | "
            f"input {reference_first}->{reference_last} | input_fingerprint {input_fingerprint} | "
            f"output {float(tensor[0]):.8g}->{float(tensor[-1]):.8g} | output_fingerprint {output_fingerprint} | "
            f"input_equals_output {input_equals_output} | transform_applied {not input_equals_output} | "
            f"tensor_length {tensor.numel()} | transitions {max(0, tensor.numel() - 1)} | "
            f"active_range {result.active_reference[0]:.8g}->{result.active_reference[-1]:.8g} | "
            f"finite {finite} | monotonic {monotonic} | duplicates {duplicates} | dtype {tensor.dtype} | device {tensor.device} | "
            f"repairs {repair_text} | warnings {warning_text}"
        )
        return tensor, info


NODE_CLASS_MAPPINGS = {"KoOSigmaEqualizer": KoOSigmaEqualizer}
NODE_DISPLAY_NAME_MAPPINGS = {"KoOSigmaEqualizer": "KoO Sigma Schedule Designer"}
