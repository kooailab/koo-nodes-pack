import { PRESETS, canonicalPreset } from "./koo_sigma_presets.js";
import { clamp, manualValues, sanitizePoints } from "./koo_sigma_editor.js";

export function ease(value, type = "Smoothstep") {
  const t = clamp(value, 0, 1);
  if (type === "Linear") return t;
  if (type === "Cosine") return .5 - .5 * Math.cos(Math.PI * t);
  if (type === "Exponential") return t ** 1.65;
  if (type === "Sigmoid") {
    const raw = 1 / (1 + Math.exp(-10 * (t - .5)));
    const low = 1 / (1 + Math.exp(5));
    const high = 1 / (1 + Math.exp(-5));
    return (raw - low) / (high - low);
  }
  return t * t * (3 - 2 * t);
}

export function resample(values, count) {
  if (!values.length) return Array(Math.max(2, count)).fill(0);
  if (values.length === count) return [...values];
  const output = [];
  for (let index = 0; index < count; index++) {
    const position = index / Math.max(1, count - 1) * (values.length - 1);
    const left = Math.floor(position);
    const right = Math.min(values.length - 1, left + 1);
    const amount = position - left;
    output.push(values[left] * (1 - amount) + values[right] * amount);
  }
  return output;
}

export function sourcePreview(getValue) {
  // Preview complexity is bounded; the Python engine still emits the exact
  // requested runtime count.
  const transitions = Math.min(240, Math.max(1, Math.round(Number(getValue("steps", 30)) || 30)));
  const sourceKind = getValue("range_source", "AUTO / INPUT");
  const maximum = Math.max(1e-6, Number(sourceKind === "CUSTOM MAX SIGMA" ? getValue("custom_max_sigma", 14.6) : getValue("max_sigma", 14.6)) || 14.6);
  return Array.from({ length: transitions + 1 }, (_, index) => index === transitions ? 0 : maximum * (1 - index / transitions) ** 2.35);
}

export function selectRange(values, mode, handoff) {
  if (mode === "FULL RANGE") return values.at(-1) > 1e-9 ? [...values, 0] : [...values];
  const cutoff = Math.max(0, Number(handoff) || 0);
  if (mode === "HIGH SIGMA") {
    if (values[0] <= cutoff) return [...values];
    const output = [values[0]];
    for (let index = 1; index < values.length; index++) {
      if (values[index] >= cutoff) output.push(values[index]);
      else { if (values[index - 1] > cutoff) output.push(cutoff); break; }
    }
    return output.length > 1 ? output : [values[0], cutoff];
  }
  if (values[0] <= cutoff) return [...values];
  const crossing = values.findIndex((value) => value <= cutoff);
  if (crossing < 0) return [values.at(-1), 0];
  const output = [cutoff, ...values.slice(crossing).filter((value) => Math.abs(value - cutoff) > 1e-9)];
  return output.length > 1 ? output : [cutoff, 0];
}

function anchorsValues(anchors, count, interpolation) {
  const output = [];
  let cursor = 0;
  for (let index = 0; index < count; index++) {
    const x = index / Math.max(1, count - 1);
    while (cursor < anchors.length - 2 && x > anchors[cursor + 1][0]) cursor++;
    const left = anchors[cursor];
    const right = anchors[Math.min(cursor + 1, anchors.length - 1)];
    const t = ease((x - left[0]) / Math.max(1e-12, right[0] - left[0]), interpolation);
    output.push(left[1] + (right[1] - left[1]) * t);
  }
  output[0] = 1; output[output.length - 1] = 0;
  return output;
}

function generatedNormalized(getValue, count) {
  const profile = canonicalPreset(getValue("profile", "Balanced Generation"));
  const preset = PRESETS[profile] || PRESETS[getValue("sigma_range_mode", "FULL RANGE") === "LOW SIGMA" ? "Detail Refiner" : "Balanced Generation"];
  let output = anchorsValues(preset.anchors, count, getValue("interpolation_type", "Smoothstep"));
  const gamma = clamp(getValue("curve_gamma", 1), .1, 5);
  const tailExponent = clamp(getValue("tail_exponent", 1), .1, 5);
  const tail = clamp(getValue("tail_length", .055), .001, .4);
  output = output.map((value) => value ** gamma).map((value) => value > tail ? value : tail * (value / tail) ** tailExponent);
  output[0] = 1; output[output.length - 1] = 0;
  return output;
}

function smooth(values, amount) {
  let output = [...values];
  const passes = Math.min(6, Math.round(clamp(amount, 0, 100) / 20));
  const mix = clamp(amount, 0, 100) / 100 * .45;
  for (let pass = 0; pass < passes; pass++) {
    output = output.map((value, index) => index === 0 || index === output.length - 1 ? value : value * (1 - mix) + (output[index - 1] + output[index + 1]) * .5 * mix);
  }
  return output;
}

function blend(reference, generated, referenceAmount) {
  const weight = clamp(referenceAmount, 0, 100) / 100;
  return generated.map((value, index) => {
    const ref = reference[index];
    if (weight <= 0) return value;
    if (weight >= 1) return ref;
    return ref <= 1e-12 || value <= 1e-12 ? ref * weight + value * (1 - weight) : Math.exp(Math.log(ref) * weight + Math.log(value) * (1 - weight));
  });
}

export function schedulePreview(getValue, manualRaw) {
  const source = sourcePreview(getValue);
  let active = selectRange(source, getValue("sigma_range_mode", "FULL RANGE"), getValue("handoff_sigma", 1.6));
  const workflow = getValue("mode", "AUTO");
  const already = getValue("input_already_cropped", "Auto");
  if (workflow === "IMG2IMG REFINE" && already === "No") {
    const transitions = active.length - 1;
    const kept = Math.max(1, Math.ceil(transitions * clamp(getValue("denoise_active_range", 1), 0, 1)));
    active = active.slice(Math.max(0, transitions - kept));
  }
  const override = Boolean(getValue("output_steps_override_enabled", false));
  const count = override ? Math.max(2, Math.round(getValue("output_steps_override", active.length - 1)) + 1) : active.length;
  const reference = resample(active, count);
  const start = reference[0] || 0;
  const end = reference.at(-1) || 0;
  let generated;
  let points = sanitizePoints(manualRaw, start, end, Boolean(getValue("lock_monotonic_curve", true)), Boolean(getValue("normalize_endpoints", true)), Boolean(getValue("prevent_duplicate_sigmas", true)));
  if (workflow === "CUSTOM") {
    generated = manualValues(points, count, (value) => ease(value, getValue("interpolation_type", "Smoothstep")));
  } else {
    const normalized = generatedNormalized(getValue, count);
    const target = normalized.map((value) => end + value * (start - end));
    const strength = clamp(getValue("curve_strength", 70), 0, 100) / 100;
    generated = target.map((value, index) => reference[index] * (1 - strength) + value * strength);
  }
  if (workflow !== "CUSTOM") generated = smooth(generated, getValue("smoothness", 35));
  const normalizeEndpoints = Boolean(getValue("normalize_endpoints", true));
  if (normalizeEndpoints) { generated[0] = start; generated[generated.length - 1] = end; }
  const output = blend(reference, generated, getValue("reference_blend", 30));
  if (normalizeEndpoints) { output[0] = start; output[output.length - 1] = end; }
  if (Boolean(getValue("preserve_final_zero", true)) && Math.abs(end) < 1e-9) output[output.length - 1] = 0;
  return { source, active: reference, generated, output, points, start, end, count };
}
