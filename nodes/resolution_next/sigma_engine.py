"""Numerical engine for KoO Sigma Equalizer.

All public helpers operate on plain Python floats.  Torch/device concerns remain
in the ComfyUI node wrapper so this module is easy to test independently.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from typing import Iterable, Sequence

from .sigma_presets import LEGACY_MODES, WORKFLOW_MODES, resolve_preset


EPSILON = 1e-12


def safe_float(value, default=0.0):
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        return default
    return result if math.isfinite(result) else default


def safe_int(value, default=1):
    try:
        return int(round(float(value)))
    except (TypeError, ValueError, OverflowError):
        return default


def clamp(value, low, high):
    return max(low, min(high, safe_float(value, low)))


@dataclass
class ScheduleResult:
    values: list[float]
    source: list[float]
    active_reference: list[float]
    generated: list[float]
    workflow: str
    range_mode: str
    source_kind: str
    classification: str
    reference_amount: float
    warnings: list[str] = field(default_factory=list)
    repairs: list[str] = field(default_factory=list)


def sanitize_sigmas(sigmas: Iterable[float] | None):
    """Return a finite, non-negative, descending schedule and repair notes.

    Inversions are repaired in-place with a running minimum rather than sorting;
    sorting would silently change the time order of an upstream schedule.
    """
    if sigmas is None:
        return None, ["missing reference SIGMAS"]
    try:
        raw = list(sigmas)
    except Exception:
        return None, ["unreadable reference SIGMAS"]

    values = []
    dropped = 0
    negative = 0
    for item in raw:
        value = safe_float(item, float("nan"))
        if not math.isfinite(value):
            dropped += 1
            continue
        if value < 0:
            negative += 1
            value = 0.0
        values.append(value)

    notes = []
    if dropped:
        notes.append(f"dropped {dropped} non-finite reference values")
    if negative:
        notes.append(f"clamped {negative} negative reference values")
    if not values:
        return None, notes + ["reference contained no usable values"]

    inversions = 0
    for index in range(1, len(values)):
        if values[index] > values[index - 1]:
            values[index] = values[index - 1]
            inversions += 1
    if inversions:
        notes.append(f"repaired {inversions} ascending reference intervals")
    if len(values) == 1:
        values.append(0.0)
        notes.append("added terminal zero to one-point reference")
    return values, notes


def generated_reference(steps, maximum):
    count = max(2, safe_int(steps, 30) + 1)
    maximum = clamp(maximum, 0.000001, 1000.0)
    return [0.0 if i == count - 1 else maximum * ((1.0 - i / (count - 1)) ** 2.35) for i in range(count)]


def classify_schedule(values: Sequence[float], handoff_sigma=1.6):
    if not values:
        return "empty"
    start = values[0]
    end = values[-1]
    handoff = max(EPSILON, safe_float(handoff_sigma, 1.6))
    has_zero = abs(end) <= max(EPSILON, start * 1e-9)
    if has_zero and start <= handoff * 1.25:
        return "cropped-low"
    if not has_zero and start > handoff * 1.05:
        return "cropped-high"
    if not has_zero:
        return "cropped-nonzero"
    return "full"


def resolve_workflow(mode, classification):
    legacy = mode in LEGACY_MODES
    mapping = {
        "Auto": "AUTO",
        "TXT2IMG": "FIRST SAMPLER",
        "IMG2IMG": "IMG2IMG REFINE",
        "Manual": "CUSTOM",
    }
    workflow = mapping.get(mode, mode if mode in WORKFLOW_MODES else "AUTO")
    if workflow == "AUTO":
        if classification == "cropped-low":
            return "SECOND SAMPLER", legacy
        if classification in ("cropped-high", "cropped-nonzero"):
            return "FIRST SAMPLER", legacy
        return "FIRST SAMPLER", legacy
    return workflow, legacy


def _interpolated_boundary(left, right, boundary):
    # A sigma schedule is the independent data here.  The exact cutoff is valid
    # regardless of the scheduler's original step spacing.
    if left >= boundary >= right:
        return boundary
    return min(left, max(right, boundary))


def select_numeric_range(values, range_mode, handoff_sigma, preserve_final_zero=True):
    """Crop by actual sigma values, never by a graph percentage."""
    source = list(values)
    notes = []
    if len(source) < 2:
        source = source + [0.0]
        notes.append("extended short range to two points")
    if range_mode == "FULL RANGE":
        if preserve_final_zero and source[-1] > max(EPSILON, source[0] * 1e-9):
            source.append(0.0)
            notes.append("extended FULL RANGE from the available input end to zero")
        return source, notes

    cutoff = max(0.0, safe_float(handoff_sigma, 1.6))
    tolerance = max(1e-8, cutoff * 1e-6)
    if range_mode == "HIGH SIGMA":
        if source[0] <= cutoff + tolerance:
            notes.append("HIGH SIGMA requested from an already-low input; retained available input without upward expansion")
            return source, notes
        result = [source[0]]
        for left, right in zip(source[:-1], source[1:]):
            if right >= cutoff - tolerance:
                if abs(right - result[-1]) > EPSILON:
                    result.append(right)
                continue
            if left > cutoff and right < cutoff:
                result.append(_interpolated_boundary(left, right, cutoff))
            break
        if len(result) == 1:
            result.append(max(0.0, min(source[-1], cutoff)))
        return result, notes

    # LOW SIGMA
    if source[0] <= cutoff + tolerance:
        return source, notes
    start_index = None
    result_start = None
    for index, (left, right) in enumerate(zip(source[:-1], source[1:])):
        if left >= cutoff >= right:
            start_index = index + 1
            result_start = _interpolated_boundary(left, right, cutoff)
            break
    if start_index is None:
        # A high-only upstream schedule may terminate at the handoff.  Building
        # the tail downwards is safe; importantly, its start is the input's real
        # terminal sigma rather than the global/fallback model maximum.
        start = source[-1]
        result = [start]
        if preserve_final_zero and start > EPSILON:
            result.append(0.0)
            notes.append("constructed a low tail from the upstream terminal sigma")
        else:
            result.append(start)
        return result, notes
    result = [result_start]
    result.extend(source[start_index:])
    deduped = [result[0]]
    for value in result[1:]:
        if abs(value - deduped[-1]) > EPSILON:
            deduped.append(value)
    if len(deduped) == 1:
        deduped.append(0.0 if preserve_final_zero else deduped[0])
    return deduped, notes


def crop_denoise(values, amount, already_cropped):
    denoise = clamp(amount, 0.0, 1.0)
    if already_cropped or denoise >= 0.999 or len(values) <= 2:
        return list(values), 0
    transitions = len(values) - 1
    active = max(1, int(math.ceil(transitions * denoise)))
    index = max(0, transitions - active)
    return list(values[index:]), index


def resample(values: Sequence[float], count: int):
    count = max(2, safe_int(count, 2))
    if not values:
        return [0.0] * count
    if len(values) == count:
        return [float(value) for value in values]
    if len(values) == 1:
        return [float(values[0])] * count
    last = len(values) - 1
    output = []
    for index in range(count):
        position = (index / (count - 1)) * last
        left = int(math.floor(position))
        right = min(last, left + 1)
        amount = position - left
        output.append(float(values[left]) * (1.0 - amount) + float(values[right]) * amount)
    return output


def ease(value, interpolation):
    t = clamp(value, 0.0, 1.0)
    if interpolation == "Linear":
        return t
    if interpolation == "Cosine":
        return 0.5 - 0.5 * math.cos(math.pi * t)
    if interpolation == "Exponential":
        return t**1.65
    if interpolation == "Sigmoid":
        raw = 1.0 / (1.0 + math.exp(-10.0 * (t - 0.5)))
        low = 1.0 / (1.0 + math.exp(5.0))
        high = 1.0 / (1.0 + math.exp(-5.0))
        return (raw - low) / (high - low)
    return t * t * (3.0 - 2.0 * t)


def interpolate_anchors(anchors, count, interpolation="Linear"):
    points = sorted((clamp(x, 0.0, 1.0), clamp(y, 0.0, 1.0)) for x, y in anchors)
    output = []
    cursor = 0
    for index in range(max(2, count)):
        x = index / max(1, count - 1)
        while cursor < len(points) - 2 and x > points[cursor + 1][0]:
            cursor += 1
        left = points[cursor]
        right = points[min(cursor + 1, len(points) - 1)]
        width = max(EPSILON, right[0] - left[0])
        t = ease((x - left[0]) / width, interpolation)
        output.append(left[1] + (right[1] - left[1]) * t)
    output[0], output[-1] = 1.0, 0.0
    return output


def _band_curve(count, controls, interpolation, high_mid, mid_low, tail_length):
    structure, materials, microdetail, cleanup = controls
    boundaries = [1.0, clamp(high_mid, 0.20, 0.92), clamp(mid_low, 0.04, 0.90), clamp(tail_length, 0.005, 0.40), 0.0]
    boundaries[2] = min(boundaries[1] - 0.02, boundaries[2])
    boundaries[3] = min(boundaries[2] - 0.005, boundaries[3])
    weights = []
    for value in (structure, materials, microdetail, cleanup):
        centered = (clamp(value, 0.0, 100.0) - 50.0) / 50.0
        weights.append(max(0.16, 1.0 + centered * 0.85))
    spans = [(boundaries[i] - boundaries[i + 1]) * weights[i] for i in range(4)]
    total = sum(spans) or 1.0
    cumulative = []
    cursor = 0.0
    for span in spans:
        cursor += span / total
        cumulative.append(cursor)
    result = []
    for index in range(count):
        progress = index / max(1, count - 1)
        lower = 0.0
        band = 3
        for candidate, upper in enumerate(cumulative):
            if progress <= upper or candidate == 3:
                band = candidate
                break
            lower = upper
        upper = cumulative[band]
        local = ease(0.0 if upper <= lower else (progress - lower) / (upper - lower), interpolation)
        result.append(boundaries[band] + (boundaries[band + 1] - boundaries[band]) * local)
    result[0], result[-1] = 1.0, 0.0
    return result


def generated_normalized(
    count,
    profile,
    workflow,
    structure,
    materials,
    microdetail,
    cleanup,
    interpolation,
    high_mid,
    mid_low,
    tail_length,
    curve_gamma,
    tail_exponent,
):
    preset, _canonical = resolve_preset(profile)
    if preset:
        base = interpolate_anchors(preset["anchors"], count, interpolation)
    else:
        default_exponent = 2.45 if workflow in ("SECOND SAMPLER", "IMG2IMG REFINE") else 0.95
        base = interpolate_anchors(tuple((x, (1.0 - x) ** default_exponent) for x in (0.0, 0.25, 0.5, 0.75, 1.0)), count, interpolation)
    banded = _band_curve(count, (structure, materials, microdetail, cleanup), interpolation, high_mid, mid_low, tail_length)
    # Preset shape is dominant; controls shift allocation in a bounded way.
    values = [base_value * 0.72 + band_value * 0.28 for base_value, band_value in zip(base, banded)]
    gamma = clamp(curve_gamma, 0.10, 5.0)
    tail_exp = clamp(tail_exponent, 0.10, 5.0)
    cutoff = clamp(tail_length, 0.001, 0.40)
    values = [value**gamma for value in values]
    values = [value if value > cutoff else cutoff * ((value / cutoff) ** tail_exp) for value in values]
    values[0], values[-1] = 1.0, 0.0
    return values


def smooth_curve(values, amount):
    out = list(values)
    passes = min(6, int(round(clamp(amount, 0.0, 100.0) / 20.0)))
    mix = clamp(amount, 0.0, 100.0) / 100.0 * 0.45
    for _ in range(passes):
        next_values = [out[0]]
        for index in range(1, len(out) - 1):
            average = (out[index - 1] + out[index + 1]) * 0.5
            next_values.append(out[index] * (1.0 - mix) + average * mix)
        next_values.append(out[-1])
        out = next_values
    return out


def parse_sigma_list(text):
    if not isinstance(text, str):
        return []
    tokens = re.split(r"(?:\s*->\s*|[,;\s]+)", text.strip())
    values = []
    for token in tokens:
        if not token:
            continue
        value = safe_float(token, float("nan"))
        if math.isfinite(value):
            values.append(value)
    return values


def normalize_manual_points(text, start_sigma, end_sigma, lock_monotonic=True, normalize_endpoints=True):
    warnings = []
    try:
        data = json.loads(text or "[]")
    except Exception:
        data = None
    if not isinstance(data, list):
        sigma_values = parse_sigma_list(text)
        data = [{"x": i / max(1, len(sigma_values) - 1), "sigma": value} for i, value in enumerate(sigma_values)]
    points = []
    for index, item in enumerate(data):
        if isinstance(item, dict):
            x = safe_float(item.get("x", index / max(1, len(data) - 1)), float("nan"))
            if "sigma" in item:
                sigma = safe_float(item.get("sigma"), float("nan"))
            else:
                y = safe_float(item.get("y"), float("nan"))
                sigma = end_sigma + y * (start_sigma - end_sigma)
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            x = safe_float(item[0], float("nan"))
            raw = safe_float(item[1], float("nan"))
            sigma = end_sigma + raw * (start_sigma - end_sigma) if 0.0 <= raw <= 1.0 and start_sigma > 1.0 else raw
        else:
            continue
        if math.isfinite(x) and math.isfinite(sigma):
            points.append({"x": clamp(x, 0.0, 1.0), "sigma": max(0.0, sigma)})
    if len(points) < 2:
        points = [{"x": 0.0, "sigma": start_sigma}, {"x": 1.0, "sigma": end_sigma}]
        warnings.append("manual data was malformed; restored range endpoints")
    points.sort(key=lambda point: point["x"])
    merged = []
    for point in points:
        if merged and abs(point["x"] - merged[-1]["x"]) < 1e-7:
            merged[-1] = point
            warnings.append("merged duplicate manual positions")
        else:
            merged.append(point)
    if normalize_endpoints:
        if merged[0]["x"] > 1e-8:
            merged.insert(0, {"x": 0.0, "sigma": start_sigma})
        else:
            merged[0] = {"x": 0.0, "sigma": start_sigma}
        if merged[-1]["x"] < 1.0 - 1e-8:
            merged.append({"x": 1.0, "sigma": end_sigma})
        else:
            merged[-1] = {"x": 1.0, "sigma": end_sigma}
    else:
        if merged[0]["x"] > 1e-8:
            merged.insert(0, {"x": 0.0, "sigma": merged[0]["sigma"]})
        if merged[-1]["x"] < 1.0 - 1e-8:
            merged.append({"x": 1.0, "sigma": merged[-1]["sigma"]})
    if lock_monotonic:
        previous = merged[0]["sigma"]
        repairs = 0
        for point in merged[1:]:
            if point["sigma"] > previous:
                point["sigma"] = previous
                repairs += 1
            previous = point["sigma"]
        if repairs:
            warnings.append(f"repaired {repairs} non-monotonic manual points")
    return merged, warnings


def manual_curve(points, count, interpolation):
    anchors = [(point["x"], point["sigma"]) for point in points]
    anchors.sort()
    output = []
    cursor = 0
    for index in range(count):
        x = index / max(1, count - 1)
        while cursor < len(anchors) - 2 and x > anchors[cursor + 1][0]:
            cursor += 1
        left, right = anchors[cursor], anchors[min(cursor + 1, len(anchors) - 1)]
        local = ease((x - left[0]) / max(EPSILON, right[0] - left[0]), interpolation)
        output.append(left[1] + (right[1] - left[1]) * local)
    return output


def blend_log(reference, generated, reference_amount):
    """Blend with unambiguous semantics: 100 means stay on reference."""
    reference_weight = clamp(reference_amount, 0.0, 100.0) / 100.0
    if reference_weight <= 0.0:
        return list(generated)
    if reference_weight >= 1.0:
        return list(reference)
    output = []
    for ref, gen in zip(reference, generated):
        if ref <= EPSILON or gen <= EPSILON:
            output.append(ref * reference_weight + gen * (1.0 - reference_weight))
        else:
            output.append(math.exp(math.log(ref) * reference_weight + math.log(gen) * (1.0 - reference_weight)))
    return output


def validate_schedule(values, reference, *, lock_monotonic, prevent_duplicates, normalize_endpoints, clamp_to_input_range, preserve_final_zero, allow_sigma_expansion):
    repairs = []
    out = []
    invalid = 0
    for value in values:
        number = safe_float(value, float("nan"))
        if not math.isfinite(number):
            invalid += 1
            number = out[-1] if out else (reference[0] if reference else 0.0)
        out.append(max(0.0, number))
    if invalid:
        repairs.append(f"replaced {invalid} invalid output values")
    if len(out) < 2:
        out = [out[0] if out else 0.0, 0.0]
        repairs.append("extended output to two sampler-compatible points")

    ref_max = max(reference) if reference else max(out)
    ref_min = min(reference) if reference else min(out)
    if clamp_to_input_range and reference:
        maximum = float("inf") if allow_sigma_expansion else reference[0]
        changed = False
        for index, value in enumerate(out):
            next_value = clamp(value, ref_min, maximum)
            changed |= abs(next_value - value) > EPSILON
            out[index] = next_value
        if changed:
            repairs.append("clamped output to active input range")

    if normalize_endpoints and reference:
        out[0] = reference[0]
        out[-1] = reference[-1]

    # Final zero is preserved only when the selected range actually owns a zero
    # endpoint.  HIGH SIGMA handoffs must remain non-zero.
    reference_has_zero = bool(reference) and abs(reference[-1]) <= max(EPSILON, reference[0] * 1e-9)
    if preserve_final_zero and reference_has_zero:
        out[-1] = 0.0

    if lock_monotonic:
        changed = False
        for index in range(1, len(out)):
            if out[index] > out[index - 1]:
                out[index] = out[index - 1]
                changed = True
        if changed:
            repairs.append("enforced monotonically decreasing output")

    if prevent_duplicates and len(out) > 1:
        span = max(0.0, out[0] - out[-1])
        epsilon = max(1e-12, span / max(1, len(out) - 1) * 1e-7, max(abs(out[0]), 1.0) * 2e-7)
        changed = False
        if lock_monotonic:
            if out[0] <= out[-1] + epsilon and reference and reference[0] > reference[-1]:
                out = [reference[0] + (reference[-1] - reference[0]) * index / (len(out) - 1) for index in range(len(out))]
                changed = True
            for index in range(1, len(out) - 1):
                ceiling = out[index - 1] - epsilon
                floor = out[-1] + epsilon * (len(out) - 1 - index)
                candidate = min(out[index], ceiling)
                if candidate < floor:
                    candidate = floor
                if abs(candidate - out[index]) > EPSILON:
                    changed = True
                out[index] = candidate
            # If strict spacing is impossible, a linear schedule is safer than
            # emitting duplicates or inversions.
            if any(out[i] <= out[i + 1] for i in range(len(out) - 1)):
                start, end = out[0], out[-1]
                if start > end:
                    out = [start + (end - start) * i / (len(out) - 1) for i in range(len(out))]
                    changed = True
        else:
            # Duplicate prevention must not secretly imply monotonic locking.
            for index in range(1, len(out)):
                if abs(out[index] - out[index - 1]) <= epsilon:
                    direction = -1.0 if index == len(out) - 1 or out[index + 1] <= out[index - 1] else 1.0
                    out[index] = max(0.0, out[index] + direction * epsilon)
                    changed = True
        if changed:
            repairs.append("removed duplicate consecutive sigmas")

    if preserve_final_zero and reference_has_zero:
        out[-1] = 0.0
    if prevent_duplicates and any(abs(out[index] - out[index + 1]) <= EPSILON for index in range(len(out) - 1)):
        if lock_monotonic and reference and reference[0] > reference[-1]:
            out = [reference[0] + (reference[-1] - reference[0]) * index / (len(out) - 1) for index in range(len(out))]
        else:
            spacing = max(1e-12, max(abs(out[0]), 1.0) * 2e-7)
            for index in range(len(out) - 2, -1, -1):
                if abs(out[index] - out[index + 1]) <= EPSILON:
                    out[index] = out[index + 1] + spacing
        if "removed duplicate consecutive sigmas" not in repairs:
            repairs.append("removed duplicate consecutive sigmas")
    return out, repairs


def build_schedule(
    *,
    reference_values,
    mode,
    profile,
    sigma_range_mode,
    range_source,
    steps,
    fallback_max_sigma,
    custom_max_sigma,
    handoff_sigma,
    denoise_active_range,
    input_already_cropped,
    output_steps_override_enabled,
    output_steps_override,
    structure_creativity,
    shapes_materials,
    microdetail,
    final_cleanup,
    curve_strength,
    reference_blend,
    smoothness,
    interpolation_type,
    high_to_mid_boundary,
    mid_to_low_boundary,
    tail_length,
    curve_gamma,
    tail_exponent,
    manual_curve_points,
    normalized_manual_points,
    lock_monotonic_curve,
    prevent_duplicate_sigmas,
    normalize_endpoints,
    clamp_to_input_range,
    preserve_final_zero,
    allow_sigma_expansion,
    external_strength=1.0,
    external_reference_blend=-1.0,
):
    warnings = []
    input_values, input_notes = sanitize_sigmas(reference_values)
    warnings.extend(input_notes)
    requested_source = range_source if range_source in ("AUTO / INPUT", "MODEL FULL RANGE", "CUSTOM MAX SIGMA") else "AUTO / INPUT"
    usable_input = bool(input_values) and len(input_values) >= 2 and input_values[0] > input_values[-1] + max(EPSILON, abs(input_values[0]) * 1e-12)
    input_count = len(input_values) if usable_input else max(2, safe_int(steps, 30) + 1)
    if input_values and not usable_input:
        warnings.append("incoming SIGMAS had no usable numeric range; used fallback source")
    if requested_source == "AUTO / INPUT" and usable_input:
        source = input_values
        source_kind = "input"
    elif requested_source == "CUSTOM MAX SIGMA":
        source = generated_reference(input_count - 1, custom_max_sigma)
        source_kind = "custom maximum"
    else:
        source = generated_reference(input_count - 1 if input_values else steps, fallback_max_sigma)
        source_kind = "model/fallback" if requested_source == "MODEL FULL RANGE" else "fallback"

    classification = classify_schedule(source, handoff_sigma)
    workflow, legacy_mode = resolve_workflow(mode, classification)
    effective_range = sigma_range_mode if sigma_range_mode in ("FULL RANGE", "HIGH SIGMA", "LOW SIGMA") else "FULL RANGE"
    if legacy_mode:
        if mode == "TXT2IMG":
            effective_range = "FULL RANGE"
        elif mode in ("IMG2IMG", "Manual"):
            effective_range = "FULL RANGE"

    active, range_notes = select_numeric_range(source, effective_range, handoff_sigma, preserve_final_zero)
    warnings.extend(range_notes)
    forced_crop = input_already_cropped == "Yes"
    forced_not_cropped = input_already_cropped == "No"
    detected_crop = classification != "full"
    already_cropped = forced_crop or (detected_crop and not forced_not_cropped)
    crop_index = 0
    if workflow == "IMG2IMG REFINE" or (legacy_mode and mode in ("IMG2IMG", "Manual")):
        active, crop_index = crop_denoise(active, denoise_active_range, already_cropped)

    if len(active) < 2:
        active = [active[0] if active else 0.0, 0.0]
        warnings.append("extended active schedule to two points")
    count = len(active)
    if output_steps_override_enabled and safe_int(output_steps_override, 0) > 0:
        count = max(2, safe_int(output_steps_override, 1) + 1)
    reference = resample(active, count)
    start_sigma, end_sigma = reference[0], reference[-1]

    manual = workflow == "CUSTOM" or mode == "Manual"
    if manual:
        points, manual_notes = normalize_manual_points(
            normalized_manual_points or manual_curve_points,
            start_sigma,
            end_sigma,
            bool(lock_monotonic_curve),
            bool(normalize_endpoints),
        )
        warnings.extend(manual_notes)
        generated = manual_curve(points, count, interpolation_type)
    else:
        normalized = generated_normalized(
            count,
            profile,
            workflow,
            structure_creativity,
            shapes_materials,
            microdetail,
            final_cleanup,
            interpolation_type,
            high_to_mid_boundary,
            mid_to_low_boundary,
            tail_length,
            curve_gamma,
            tail_exponent,
        )
        target = [end_sigma + value * (start_sigma - end_sigma) for value in normalized]
        strength = clamp(curve_strength * clamp(external_strength, 0.0, 2.0), 0.0, 100.0) / 100.0
        generated = [ref * (1.0 - strength) + shaped * strength for ref, shaped in zip(reference, target)]

    # CUSTOM is precision-first. Smoothing is an explicit point-table action so
    # a pasted numeric sigma list is not altered behind the user's back.
    if not manual:
        generated = smooth_curve(generated, smoothness)
    generated, first_repairs = validate_schedule(
        generated,
        reference,
        lock_monotonic=bool(lock_monotonic_curve),
        prevent_duplicates=bool(prevent_duplicate_sigmas),
        normalize_endpoints=bool(normalize_endpoints),
        clamp_to_input_range=bool(clamp_to_input_range),
        preserve_final_zero=bool(preserve_final_zero),
        allow_sigma_expansion=bool(allow_sigma_expansion),
    )

    blend_value = reference_blend if safe_float(external_reference_blend, -1.0) < 0 else external_reference_blend
    # Old workflows stored generated-curve amount.  Converting here preserves
    # their blend behavior while all new modes use clear reference-amount wording.
    reference_amount = 100.0 - clamp(blend_value, 0.0, 100.0) if legacy_mode else clamp(blend_value, 0.0, 100.0)
    output = blend_log(reference, generated, reference_amount)
    output, final_repairs = validate_schedule(
        output,
        reference,
        lock_monotonic=bool(lock_monotonic_curve),
        prevent_duplicates=bool(prevent_duplicate_sigmas),
        normalize_endpoints=bool(normalize_endpoints),
        clamp_to_input_range=bool(clamp_to_input_range),
        preserve_final_zero=bool(preserve_final_zero),
        allow_sigma_expansion=bool(allow_sigma_expansion),
    )
    repairs = list(dict.fromkeys(first_repairs + final_repairs))
    if crop_index:
        warnings.append(f"applied denoise crop at input index {crop_index}")
    return ScheduleResult(
        values=output,
        source=list(source),
        active_reference=list(reference),
        generated=list(generated),
        workflow=workflow,
        range_mode=effective_range,
        source_kind=source_kind,
        classification=classification,
        reference_amount=reference_amount,
        warnings=list(dict.fromkeys(warnings)),
        repairs=repairs,
    )
