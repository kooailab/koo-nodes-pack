export const WORKFLOWS = ["AUTO", "FIRST SAMPLER", "SECOND SAMPLER", "IMG2IMG REFINE", "CUSTOM"];
export const RANGE_MODES = ["FULL RANGE", "HIGH SIGMA", "LOW SIGMA"];
export const RANGE_SOURCES = ["AUTO / INPUT", "MODEL FULL RANGE", "CUSTOM MAX SIGMA"];
export const INTERPOLATIONS = ["Smoothstep", "Linear", "Cosine", "Exponential", "Sigmoid"];

const powerAnchors = (exponent) => [0, .125, .25, .375, .5, .625, .75, .875, 1]
  .map((x) => [x, (1 - x) ** exponent]);

export const PRESETS = Object.freeze({
  "Balanced Generation": { family: "high", workflow: "FIRST SAMPLER", range: "HIGH SIGMA", anchors: powerAnchors(.92), controls: [56, 52, 48, 44, 72, 25, 30] },
  "Creative Expansion": { family: "high", workflow: "FIRST SAMPLER", range: "HIGH SIGMA", anchors: powerAnchors(.66), controls: [76, 45, 42, 36, 84, 18, 24] },
  "Structural Lock": { family: "high", workflow: "FIRST SAMPLER", range: "HIGH SIGMA", anchors: [[0, 1], [.18, .90], [.42, .68], [.70, .36], [1, 0]], controls: [70, 60, 38, 32, 78, 30, 42] },
  "Architectural Base": { family: "high", workflow: "FIRST SAMPLER", range: "HIGH SIGMA", anchors: [[0, 1], [.14, .88], [.34, .70], [.58, .47], [.80, .24], [1, 0]], controls: [62, 74, 42, 38, 74, 38, 52] },
  "Photoreal Base": { family: "high", workflow: "FIRST SAMPLER", range: "HIGH SIGMA", anchors: powerAnchors(1.08), controls: [54, 66, 55, 48, 72, 48, 58] },
  "Fast Composition": { family: "high", workflow: "FIRST SAMPLER", range: "HIGH SIGMA", anchors: powerAnchors(1.55), controls: [45, 52, 40, 35, 76, 20, 28] },
  "Early Handoff": { family: "high", workflow: "FIRST SAMPLER", range: "HIGH SIGMA", anchors: [[0, 1], [.20, .84], [.48, .55], [.76, .25], [1, 0]], controls: [58, 56, 44, 34, 80, 28, 44] },
  "Detail Refiner": { family: "low", workflow: "SECOND SAMPLER", range: "LOW SIGMA", anchors: [[0, 1], [.125, .71875], [.25, .5125], [.375, .3625], [.5, .25], [.625, .1625], [.75, .0875], [.875, .034375], [1, 0]], controls: [30, 60, 72, 68, 86, 22, 48] },
  "Material Polish": { family: "low", workflow: "SECOND SAMPLER", range: "LOW SIGMA", anchors: powerAnchors(2.15), controls: [28, 78, 62, 58, 80, 34, 52] },
  "Microdetail": { family: "low", workflow: "SECOND SAMPLER", range: "LOW SIGMA", anchors: powerAnchors(2.85), controls: [22, 55, 86, 62, 88, 20, 46] },
  "Final Cleanup": { family: "low", workflow: "SECOND SAMPLER", range: "LOW SIGMA", anchors: powerAnchors(3.35), controls: [18, 46, 64, 88, 84, 30, 64] },
  "Turbo Tail": { family: "low", workflow: "SECOND SAMPLER", range: "LOW SIGMA", anchors: powerAnchors(4), controls: [18, 42, 82, 78, 92, 12, 30] },
  "Skin Detail": { family: "low", workflow: "SECOND SAMPLER", range: "LOW SIGMA", anchors: powerAnchors(2.4), controls: [16, 50, 78, 70, 76, 58, 68] },
  "Identity Refine": { family: "low", workflow: "IMG2IMG REFINE", range: "LOW SIGMA", anchors: powerAnchors(1.75), controls: [10, 48, 56, 70, 58, 74, 72] },
  "Conservative Refine": { family: "low", workflow: "IMG2IMG REFINE", range: "LOW SIGMA", anchors: powerAnchors(1.55), controls: [14, 52, 58, 74, 52, 82, 76] },
  "Reference / Bypass": { family: "all", workflow: "AUTO", range: "FULL RANGE", anchors: powerAnchors(1), controls: [50, 50, 50, 50, 0, 100, 0] },
});

export const LEGACY_MODE_MAP = Object.freeze({ Auto: "AUTO", TXT2IMG: "FIRST SAMPLER", IMG2IMG: "IMG2IMG REFINE", Manual: "CUSTOM" });
export const LEGACY_PRESET_MAP = Object.freeze({
  "Balanced TXT2IMG": "Balanced Generation",
  "Photoreal TXT2IMG": "Photoreal Base",
  "Creative TXT2IMG": "Creative Expansion",
  "Balanced IMG2IMG": "Detail Refiner",
  "Conservative Enhance": "Conservative Refine",
  "Skin Detail Enhance": "Skin Detail",
  "Architectural Materials": "Architectural Base",
  "Identity Preservation": "Identity Refine",
  "Reference / Bypass": "Reference / Bypass",
});

export function canonicalPreset(name) {
  return LEGACY_PRESET_MAP[name] || (PRESETS[name] ? name : "Custom");
}

export function presetsFor(workflow, rangeMode) {
  const wanted = rangeMode === "HIGH SIGMA" ? "high"
    : rangeMode === "LOW SIGMA" ? "low"
      : workflow === "FIRST SAMPLER" ? "high"
        : workflow === "SECOND SAMPLER" || workflow === "IMG2IMG REFINE" ? "low"
      : "all";
  return Object.entries(PRESETS)
    .filter(([, preset]) => preset.family === wanted || preset.family === "all" || wanted === "all")
    .map(([name, preset]) => ({ name, ...preset }));
}

export function applyPresetValues(setValue, name) {
  const canonical = canonicalPreset(name);
  const preset = PRESETS[canonical];
  if (!preset) return false;
  const [structure, materials, detail, cleanup, strength, reference, smoothness] = preset.controls;
  const values = {
    mode: preset.workflow,
    profile: canonical,
    sigma_range_mode: preset.range,
    structure_creativity: structure,
    shapes_materials: materials,
    microdetail: detail,
    final_cleanup: cleanup,
    curve_strength: strength,
    reference_blend: reference,
    smoothness,
  };
  for (const [key, value] of Object.entries(values)) setValue(key, value, false);
  return true;
}
