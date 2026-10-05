import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  movePoint, parseSigmaList, sanitizePoints, serializePoints,
} from "../web/resolution_next/koo_sigma_editor.js";
import { schedulePreview } from "../web/resolution_next/koo_sigma_math.js";
import { LEGACY_MODE_MAP, canonicalPreset } from "../web/resolution_next/koo_sigma_presets.js";

const parsed = parseSigmaList("1.6 -> 1.15, 0.82\n0.58 0");
assert.deepEqual(parsed, [1.6, 1.15, 0.82, 0.58, 0]);

const initial = sanitizePoints('[{"id":"a","x":0,"sigma":1.6},{"id":"stable","x":0.5,"sigma":0.58},{"id":"z","x":1,"sigma":0}]', 1.6, 0, true, true, true);
assert.equal(initial[1].id, "stable", "stable point identity must survive sanitization");
const roundTrip = sanitizePoints(serializePoints(initial), 1.6, 0, true, true, true);
assert.equal(roundTrip[1].id, "stable", "stable point identity must survive serialization");
assert.equal(roundTrip[1].sigma, 0.58, "numeric sigma precision must survive serialization");

const moved = movePoint(initial, "stable", 0.999, 5, { lockMonotonic: true, normalizeEndpoints: true, preventDuplicates: true, snapSteps: 8 });
assert.ok(moved[1].x < moved[2].x, "point must not cross its neighbor");
assert.ok(moved[1].sigma < moved[0].sigma && moved[1].sigma > moved[2].sigma, "monotonic duplicate lock must stay strict");
assert.equal(moved[1].x, 0.875, "Ctrl-style step snapping must be deterministic");

const base = {
  steps: 30, max_sigma: 14.6, custom_max_sigma: 14.6, range_source: "AUTO / INPUT",
  sigma_range_mode: "LOW SIGMA", handoff_sigma: 1.6, mode: "SECOND SAMPLER",
  profile: "Detail Refiner", interpolation_type: "Linear", curve_gamma: 1,
  tail_exponent: 1, tail_length: 0.055, curve_strength: 100, reference_blend: 0,
  smoothness: 0, output_steps_override_enabled: true, output_steps_override: 8,
  input_already_cropped: "Auto", lock_monotonic_curve: true,
  normalize_endpoints: true, prevent_duplicate_sigmas: true,
};
const getValue = (name, fallback) => base[name] ?? fallback;
const low = schedulePreview(getValue, "[]");
assert.equal(low.output.length, 9);
assert.ok(Math.abs(low.output[0] - 1.6) < 1e-9);
assert.equal(low.output.at(-1), 0);
assert.ok(low.output[1] < 1.3 && low.output[1] > 1.0, "Detail Refiner should descend strongly at the beginning");
assert.ok(low.output[7] < 0.1, "Detail Refiner should retain a dense low-sigma tail");

const highValues = { ...base, mode: "FIRST SAMPLER", profile: "Architectural Base", sigma_range_mode: "HIGH SIGMA" };
const high = schedulePreview((name, fallback) => highValues[name] ?? fallback, "[]");
assert.ok(Math.abs(high.output.at(-1) - 1.6) < 1e-9, "HIGH SIGMA preview must preserve a nonzero handoff");

assert.equal(LEGACY_MODE_MAP.Manual, "CUSTOM");
assert.equal(canonicalPreset("Balanced TXT2IMG"), "Balanced Generation");

// Import the complete frontend module against a minimal ComfyUI app shim. This
// catches top-level import/registration failures in addition to `node --check`.
globalThis.__sigmaExtensions = [];
const mainUrl = new URL("../web/resolution_next/koo_sigma_equalizer.js", import.meta.url);
let mainSource = await readFile(mainUrl, "utf8");
const appShim = Buffer.from("export const app={canvas:{},registerExtension(extension){globalThis.__sigmaExtensions.push(extension)}}", "utf8").toString("base64");
mainSource = mainSource.replace("../../../scripts/app.js", `data:text/javascript;base64,${appShim}`);
for (const file of ["koo_ui_shared.js", "koo_sigma_presets.js", "koo_sigma_math.js", "koo_sigma_editor.js"]) {
  mainSource = mainSource.replace(`./${file}`, new URL(`../web/resolution_next/${file}`, import.meta.url).href);
}
const frontend = await import(`data:text/javascript;base64,${Buffer.from(mainSource, "utf8").toString("base64")}`);
assert.equal(globalThis.__sigmaExtensions.length, 1, "frontend must register exactly one ComfyUI extension");
assert.equal(globalThis.__sigmaExtensions[0].name, "KoO.SigmaEqualizer");

const ui = frontend.__test;
function makeNode(overrides = {}) {
  const defaults = {
    ...base,
    mode: "AUTO",
    profile: "Balanced Generation",
    manual_curve_points: '[{"id":"start","x":0,"sigma":1.6},{"id":"middle","x":0.5,"sigma":0.8},{"id":"end","x":1,"sigma":0}]',
    normalized_manual_points: "",
    point_table_open: false,
    workflow_schema_version: 2,
    ui_complexity: "BASIC",
    range_source: "AUTO / INPUT",
    custom_max_sigma: 14.6,
    show_sigma_labels: true,
    show_step_numbers: true,
    show_reference_curve: true,
    show_generated_curve: true,
    show_final_curve: true,
  };
  const values = { ...defaults, ...overrides };
  const node = {
    widgets: ui.BACKEND_WIDGET_NAMES.map((name) => ({ name, value: values[name] ?? null })),
    properties: {}, size: [720, 760],
    setDirtyCanvas() {},
  };
  ui.detachWidgets(node);
  return node;
}
function click(node, kind, value) {
  node._kooSigmaHitboxes = [{ kind, value, x: 0, y: 0, w: 100, h: 30 }];
  assert.equal(ui.handlePointerDown(node, {}, [10, 10]), true);
}

const stateNode = makeNode();
assert.equal(ui.backendSchemaReady(stateNode), true, "complete v2 schema must be recognized");
click(stateNode, "range", "HIGH SIGMA");
assert.equal(ui.getValue(stateNode, "sigma_range_mode"), "HIGH SIGMA", "HIGH click must update canonical range state");
click(stateNode, "range", "LOW SIGMA");
assert.equal(ui.getValue(stateNode, "sigma_range_mode"), "LOW SIGMA", "LOW click must update canonical range state");
click(stateNode, "workflow", "FIRST SAMPLER");
assert.equal(ui.getValue(stateNode, "mode"), "FIRST SAMPLER", "FIRST click must update canonical workflow state");
click(stateNode, "workflow", "SECOND SAMPLER");
assert.equal(ui.getValue(stateNode, "mode"), "SECOND SAMPLER", "SECOND click must update canonical workflow state");
click(stateNode, "workflow", "CUSTOM");
assert.equal(ui.getValue(stateNode, "mode"), "CUSTOM");
assert.equal(ui.getValue(stateNode, "ui_complexity"), "PRO", "CUSTOM must expose PRO editing");

stateNode._kooSigmaSelectedId = "middle";
assert.equal(ui.updateSelectedPointValue(stateNode, "sigma", 0.61, { start: 1.6, end: 0 }, currentManualPoints(stateNode)), true);
ui.writePoints(stateNode, stateNode._kooSigmaLivePoints, { history: false, notify: false });
assert.equal(currentManualPoints(stateNode).find((point) => point.id === "middle").sigma, 0.61, "numeric Sigma entry must update serialized manual state");

const beforeDrag = currentManualPoints(stateNode);
stateNode._kooSigmaPointDrag = {
  id: "middle", startPos: [50, 50], originX: beforeDrag[1].x, originSigma: beforeDrag[1].sigma,
  points: beforeDrag, plot: { x: 0, y: 0, w: 100, h: 100 }, preview: { start: 1.6, end: 0 }, history: false, moved: false,
};
assert.equal(ui.dragPoint(stateNode, {}, [60, 60]), true);
ui.finishPointDrag(stateNode);
assert.notEqual(currentManualPoints(stateNode).find((point) => point.id === "middle").sigma, 0.61, "dragging must update serialized manual state");

const savedValues = ui.BACKEND_WIDGET_NAMES.map((name) => ui.getValue(stateNode, name));
const reloaded = makeNode();
ui.detachWidgets(reloaded, savedValues);
assert.equal(ui.getValue(reloaded, "mode"), "CUSTOM");
assert.equal(ui.getValue(reloaded, "sigma_range_mode"), "LOW SIGMA");
assert.equal(ui.getValue(reloaded, "profile"), "Custom");
assert.equal(ui.getValue(reloaded, "reference_blend"), 0);
assert.equal(ui.getValue(reloaded, "manual_curve_points"), ui.getValue(stateNode, "manual_curve_points"), "manual state must survive positional save/reload");

const migrated = makeNode({ mode: "Auto", profile: "Balanced TXT2IMG", reference_blend: 80 });
ui.migrateLegacyWorkflow(migrated, { widgets_values: Array(36) });
assert.equal(ui.getValue(migrated, "mode"), "AUTO");
assert.equal(ui.getValue(migrated, "reference_blend"), 20, "legacy generated-amount blend must migrate once");
click(migrated, "range", "LOW SIGMA");
click(migrated, "workflow", "SECOND SAMPLER");
const migratedSaved = ui.BACKEND_WIDGET_NAMES.map((name) => ui.getValue(migrated, name));
const migratedReload = makeNode();
ui.detachWidgets(migratedReload, migratedSaved);
ui.migrateLegacyWorkflow(migratedReload, { widgets_values: migratedSaved });
assert.equal(ui.getValue(migratedReload, "mode"), "SECOND SAMPLER", "migration must not overwrite a new workflow interaction");
assert.equal(ui.getValue(migratedReload, "sigma_range_mode"), "LOW SIGMA", "migration must not overwrite a new range interaction");
assert.equal(migratedReload._kooSigmaWidgets.filter((item) => item.name === "mode").length, 1, "there must be one canonical workflow widget");
assert.equal(migratedReload._kooSigmaWidgets.filter((item) => item.name === "sigma_range_mode").length, 1, "there must be one canonical range widget");

const staleSchema = makeNode();
staleSchema._kooSigmaWidgets = staleSchema._kooSigmaWidgets.filter((item) => !ui.NEW_WIDGET_NAMES.includes(item.name));
assert.equal(ui.backendSchemaReady(staleSchema), false, "legacy backend must be detected instead of showing editable v2 controls");

console.log("Sigma editor/math JS tests passed");

function currentManualPoints(node) {
  return sanitizePoints(ui.getValue(node, "normalized_manual_points", "") || ui.getValue(node, "manual_curve_points", "[]"), 1.6, 0, true, true, true);
}
