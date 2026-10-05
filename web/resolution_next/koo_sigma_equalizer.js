import { app } from "../../../scripts/app.js";
import {
  DEFAULT_ACCENT, THEMES, SWATCHES, THEME_TOKENS, activeFill, activeForeground,
  buildAccentPalette, drawPaletteIcon, drawRound, drawText, ellipsize, hexToRgba,
  normalizeHex, roundedRect,
} from "./koo_ui_shared.js";
import {
  INTERPOLATIONS, LEGACY_MODE_MAP, LEGACY_PRESET_MAP, PRESETS, RANGE_MODES,
  RANGE_SOURCES, WORKFLOWS, applyPresetValues, canonicalPreset, presetsFor,
} from "./koo_sigma_presets.js";
import { schedulePreview } from "./koo_sigma_math.js";
import {
  addPoint, clamp, deletePoint, movePoint, parseSigmaList,
  pointsFromSigmas, redistributePoints, sanitizePoints, serializePoints,
  simplifyPoints, smoothPoints,
} from "./koo_sigma_editor.js";

const NODE_NAME = "KoOSigmaEqualizer";
const STORAGE_KEY = "koo.sigmaEqualizer.presets.v2";
const OLD_STORAGE_KEY = "koo.sigmaEqualizer.presets.v1";

// This prefix is the exact v1 positional order, including primitive optional
// inputs. New fields are appended so old widgets_values arrays migrate safely.
const LEGACY_WIDGET_NAMES = [
  "mode", "profile", "structure_creativity", "shapes_materials", "microdetail",
  "final_cleanup", "curve_strength", "reference_blend", "smoothness", "steps",
  "max_sigma", "interpolation_type", "high_to_mid_boundary", "mid_to_low_boundary",
  "tail_length", "curve_gamma", "tail_exponent", "txt2img_settings",
  "img2img_settings", "auto_settings", "manual_curve_points",
  "normalized_manual_points", "lock_monotonic_curve", "prevent_duplicate_sigmas",
  "normalize_endpoints", "clamp_to_input_range", "preserve_final_zero",
  "allow_sigma_expansion", "include_appearance_in_preset", "denoise_active_range",
  "input_already_cropped", "output_steps_override_enabled", "output_steps_override",
  "denoise", "external_strength", "external_reference_blend",
];
const NEW_WIDGET_NAMES = [
  "sigma_range_mode", "range_source", "custom_max_sigma", "handoff_sigma",
  "ui_complexity", "show_sigma_labels", "show_step_numbers", "show_reference_curve",
  "show_generated_curve", "show_final_curve", "point_table_open", "workflow_schema_version",
];
const BACKEND_WIDGET_NAMES = [...LEGACY_WIDGET_NAMES, ...NEW_WIDGET_NAMES];
const REQUIRED_V2_WIDGET_NAMES = [
  "mode", "profile", "reference_blend", "manual_curve_points",
  "sigma_range_mode", "range_source", "handoff_sigma", "ui_complexity",
  "point_table_open", "workflow_schema_version",
];

const CONTROL_ROWS = [
  ["structure_creativity", "Structure / Creativity"],
  ["shapes_materials", "Material Definition"],
  ["microdetail", "Microdetail"],
  ["final_cleanup", "Final Cleanup"],
  ["curve_strength", "Curve Strength"],
  ["reference_blend", "Reference Blend"],
  ["smoothness", "Smoothness"],
];
const SAFETY_ROWS = [
  ["lock_monotonic_curve", "Lock Monotonic"],
  ["prevent_duplicate_sigmas", "Prevent Duplicates"],
  ["normalize_endpoints", "Normalize Endpoints"],
  ["clamp_to_input_range", "Clamp to Input"],
  ["preserve_final_zero", "Preserve Final Zero"],
  ["allow_sigma_expansion", "Allow Expansion"],
];
const DISPLAY_ROWS = [
  ["show_sigma_labels", "Sigma Labels"],
  ["show_step_numbers", "Step Numbers"],
  ["show_reference_curve", "Reference Curve"],
  ["show_generated_curve", "Generated Curve"],
  ["show_final_curve", "Final Curve"],
];
const TOOLTIPS = {
  workflow: "Choose the sampler role. AUTO classifies the incoming range at runtime.",
  range: "FULL uses the available range; HIGH ends at handoff; LOW begins at handoff or the cropped input start.",
  range_source: "AUTO / INPUT trusts usable incoming SIGMAS. Other choices explicitly synthesize a full source.",
  handoff_sigma: "Numeric FIRST-to-SECOND sampler boundary; commonly around 1.6 in Krea dual-sampler workflows.",
  structure_creativity: "Allocates more influence to high-sigma structure, composition, and large forms.",
  shapes_materials: "Allocates more influence to mid-sigma shape and material definition.",
  microdetail: "Allocates more evaluations to low-sigma texture and microdetail.",
  final_cleanup: "Allocates more evaluations to the final cleanup tail.",
  curve_strength: "How strongly the selected preset reshapes the reference schedule.",
  reference_blend: "How strongly the final schedule stays near the original input/reference sigma schedule.",
  smoothness: "Reduces abrupt changes between adjacent sigma intervals.",
  denoise_active_range: "Fraction of the selected range used for conservative IMG2IMG refinement; cropped inputs are not cropped twice in Auto mode.",
  interpolation_type: "Interpolation used between preset or manual curve anchors.",
  input_already_cropped: "Override numeric cropped-input detection only when the upstream schedule metadata is ambiguous.",
  curve_gamma: "Global exponent applied to the generated normalized curve.",
  tail_exponent: "Additional exponent inside the final low-sigma tail.",
  tail_length: "Normalized boundary that defines the final cleanup tail.",
  high_to_mid_boundary: "Normalized boundary between structure and material sigma bands.",
  mid_to_low_boundary: "Normalized boundary between material and detail sigma bands.",
  custom_max_sigma: "Maximum used only when Range Source is CUSTOM MAX SIGMA.",
  output_steps_override: "Explicit output transition count when Output Steps Override is enabled.",
  output_steps_override_enabled: "Resample the active numeric range to the explicit output step count.",
  lock_monotonic_curve: "Prevent sigma increases as sampling progresses.",
  prevent_duplicate_sigmas: "Keep consecutive sigma values distinct using scale-aware spacing.",
  normalize_endpoints: "Pin output start and end to the selected range endpoints.",
  clamp_to_input_range: "Keep generated values inside the selected active input range.",
  preserve_final_zero: "Preserve zero for FULL/LOW ranges; HIGH SIGMA handoffs remain nonzero.",
  allow_sigma_expansion: "Permit manual values outside the active range when monotonic locking allows it.",
  graph: "CUSTOM + PRO: click a point to select, drag to move, Shift-drag for precision, Ctrl-drag to snap, Alt-click to add, right-click to delete.",
};

function widgets(node) { return node._kooSigmaWidgets?.length ? node._kooSigmaWidgets : node.widgets || []; }
function widget(node, name) { return widgets(node).find((item) => item?.name === name); }
function getValue(node, name, fallback) { const item = widget(node, name); return item ? item.value : fallback; }
function rawSet(node, name, value) { const item = widget(node, name); if (item) item.value = value; }
function setValue(node, name, value, notify = true) {
  const item = widget(node, name);
  if (!item) return;
  item.value = value;
  if (notify && typeof item.callback === "function" && !node._kooSigmaSuppressCallbacks) {
    try { item.callback(value, app.canvas, node, app.canvas?.graph_mouse); } catch { setStatus(node, `${name}: callback warning`); }
  }
  if (notify) storeActiveMode(node);
  node.setDirtyCanvas?.(true, true);
}
function valueReader(node) { return (name, fallback) => getValue(node, name, fallback); }
function setStatus(node, message) { node.properties = node.properties || {}; node.properties.kooSigmaStatus = message; node.setDirtyCanvas?.(true, true); }
function backendSchemaReady(node) {
  return REQUIRED_V2_WIDGET_NAMES.every((name) => Boolean(widget(node, name)));
}
function requireBackendSchema(node) {
  if (backendSchemaReady(node)) return true;
  setStatus(node, "Backend schema mismatch: restart ComfyUI after removing the legacy Sigma registration");
  return false;
}

function detachWidgets(node, values) {
  const found = new Map();
  for (const item of [...(node._kooSigmaWidgets || []), ...(node.widgets || [])]) {
    if (item?.name && BACKEND_WIDGET_NAMES.includes(item.name) && !found.has(item.name)) found.set(item.name, item);
  }
  node._kooSigmaWidgets = BACKEND_WIDGET_NAMES.map((name) => found.get(name)).filter(Boolean);
  if (Array.isArray(values)) {
    BACKEND_WIDGET_NAMES.forEach((name, index) => {
      if (index < values.length) rawSet(node, name, values[index]);
    });
  }
  for (const item of node._kooSigmaWidgets) {
    item.hidden = true;
    item.type = "hidden";
    item.serialize = true;
    item.draw = () => {};
    item.computeSize = () => [0, 0];
  }
  node.widgets = node._kooSigmaWidgets;
}

function drawSchemaMismatch(node, ctx) {
  const width = Math.max(360, node.size?.[0] || 620);
  ctx.save();
  ctx.fillStyle = "#18191e"; ctx.fillRect(0, 0, width, Math.max(150, node.size?.[1] || 150));
  ctx.fillStyle = "#ff6b7a"; ctx.font = "700 14px sans-serif";
  ctx.fillText("Sigma backend schema mismatch", 18, 42);
  ctx.fillStyle = "#d7d8df"; ctx.font = "12px sans-serif";
  ctx.fillText("Restart ComfyUI after disabling the duplicate legacy Sigma registration.", 18, 68);
  ctx.fillText("Controls are locked so visual state cannot diverge from Python state.", 18, 90);
  ctx.restore();
}

function ensureProperties(node) {
  node.properties = node.properties || {};
  const old = node.properties.kooSigmaAppearance || {};
  node.properties.kooSigmaAppearance = {
    theme: THEMES.includes(old.theme) ? old.theme : "Dark",
    accent: normalizeHex(old.accent) || DEFAULT_ACCENT,
    contrast: Boolean(old.contrast),
  };
  node.properties.kooSigmaStatus ||= "Ready";
  node.properties.kooSigmaPresetName ||= canonicalPreset(getValue(node, "profile", "Balanced Generation"));
  node.properties.kooSigmaAdvancedOpen ??= false;
  node.properties.kooSigmaAppearanceOpen ??= false;
  node.properties.kooSigmaTablePage ||= 0;
  node.properties.kooSigmaUiSchemaVersion = 3;
}

function migrateSnapshotObject(data) {
  if (!data || typeof data !== "object") return data;
  data = { ...data };
  data.mode ||= data.selected_operating_mode;
  Object.assign(data, data.perceptual_controls || {}, data.safety_settings || {});
  data.max_sigma ??= data.maximum_sigma;
  data.high_to_mid_boundary ??= data.sigma_band_boundaries?.high_to_mid;
  data.mid_to_low_boundary ??= data.sigma_band_boundaries?.mid_to_low;
  data.tail_length ??= data.cleanup_tail_settings?.tail_length;
  data.tail_exponent ??= data.cleanup_tail_settings?.tail_exponent;
  data.final_cleanup ??= data.cleanup_tail_settings?.final_cleanup;
  const wasLegacy = LEGACY_MODE_MAP[data.mode];
  if (wasLegacy) {
    data.mode = LEGACY_MODE_MAP[data.mode];
    if (Number.isFinite(Number(data.reference_blend))) data.reference_blend = 100 - clamp(data.reference_blend, 0, 100);
  }
  if (LEGACY_PRESET_MAP[data.profile]) data.profile = LEGACY_PRESET_MAP[data.profile];
  data.sigma_range_mode ||= data.mode === "FIRST SAMPLER" ? "FULL RANGE" : data.mode === "IMG2IMG REFINE" ? "FULL RANGE" : "FULL RANGE";
  return data;
}

function migrateLegacyWorkflow(node, info) {
  const oldMode = getValue(node, "mode", "AUTO");
  const legacy = LEGACY_MODE_MAP[oldMode];
  const oldVector = Array.isArray(info?.widgets_values) && info.widgets_values.length <= LEGACY_WIDGET_NAMES.length;
  if (!legacy && !oldVector) return;
  node._kooSigmaSuppressCallbacks = true;
  if (legacy) {
    rawSet(node, "mode", legacy);
    rawSet(node, "reference_blend", 100 - clamp(getValue(node, "reference_blend", 100), 0, 100));
    rawSet(node, "sigma_range_mode", "FULL RANGE");
  }
  const oldProfile = getValue(node, "profile", "Balanced Generation");
  rawSet(node, "profile", LEGACY_PRESET_MAP[oldProfile] || oldProfile);
  for (const key of ["txt2img_settings", "img2img_settings", "auto_settings"]) {
    try {
      const migrated = migrateSnapshotObject(JSON.parse(getValue(node, key, "{}") || "{}"));
      rawSet(node, key, JSON.stringify(migrated || {}));
    } catch { /* malformed legacy snapshots remain inert */ }
  }
  rawSet(node, "workflow_schema_version", 2);
  node._kooSigmaSuppressCallbacks = false;
  node.properties.kooSigmaPresetName = canonicalPreset(oldProfile);
  setStatus(node, `Migrated legacy ${oldMode} workflow without changing blend intent`);
}

function snapshot(node) {
  return Object.fromEntries(BACKEND_WIDGET_NAMES.filter((name) => !["txt2img_settings", "img2img_settings", "auto_settings"].includes(name)).map((name) => [name, getValue(node, name, null)]));
}
function modeStorageKey(mode) {
  if (mode === "FIRST SAMPLER") return "txt2img_settings";
  if (mode === "SECOND SAMPLER" || mode === "IMG2IMG REFINE") return "img2img_settings";
  if (mode === "AUTO") return "auto_settings";
  return null;
}
function storeActiveMode(node) {
  if (node._kooSigmaRestoring) return;
  const key = modeStorageKey(getValue(node, "mode", "AUTO"));
  if (key && widget(node, key)) rawSet(node, key, JSON.stringify({ schema_version: 2, ...snapshot(node) }));
}
function restoreMode(node, mode) {
  const key = modeStorageKey(mode);
  if (!key) return;
  let data;
  try { data = migrateSnapshotObject(JSON.parse(getValue(node, key, "{}") || "{}")); } catch { return; }
  if (!data || Object.keys(data).length < 3) return;
  node._kooSigmaRestoring = true;
  for (const [name, value] of Object.entries(data)) if (BACKEND_WIDGET_NAMES.includes(name) && value != null) rawSet(node, name, value);
  rawSet(node, "mode", mode);
  node._kooSigmaRestoring = false;
}
function switchWorkflow(node, mode) {
  storeActiveMode(node);
  rawSet(node, "mode", mode);
  restoreMode(node, mode);
  rawSet(node, "mode", mode);
  if (mode === "FIRST SAMPLER") rawSet(node, "sigma_range_mode", "HIGH SIGMA");
  else if (mode === "SECOND SAMPLER" || mode === "IMG2IMG REFINE") rawSet(node, "sigma_range_mode", "LOW SIGMA");
  if (mode === "CUSTOM") {
    rawSet(node, "ui_complexity", "PRO"); rawSet(node, "profile", "Custom");
    rawSet(node, "reference_blend", 0); rawSet(node, "smoothness", 0);
  }
  storeActiveMode(node);
  setStatus(node, `${mode}: ready`);
}

function readUserPresets() {
  const fallback = { schema_version: 2, presets: {} };
  try {
    let data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!data) {
      const old = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY) || "null");
      if (old?.presets) data = { schema_version: 2, presets: Object.fromEntries(Object.entries(old.presets).map(([name, value]) => [name, migrateSnapshotObject(value)])) };
    }
    return data?.presets && typeof data.presets === "object" ? { schema_version: 2, presets: data.presets } : fallback;
  } catch { return fallback; }
}
function writeUserPresets(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ schema_version: 2, presets: data.presets || {} })); return true; } catch { return false; }
}
function saveUserPreset(node) {
  const name = String(prompt("Save sigma preset as", node.properties.kooSigmaPresetName || "My Sigma Schedule") || "").trim();
  if (!name) return;
  const data = readUserPresets();
  data.presets[name] = { schema_version: 2, preset_name: name, values: snapshot(node), appearance: getValue(node, "include_appearance_in_preset", false) ? { ...node.properties.kooSigmaAppearance } : null };
  if (writeUserPresets(data)) { node.properties.kooSigmaPresetName = name; setStatus(node, `Saved preset: ${name}`); }
}
function loadUserPreset(node, name) {
  const payload = readUserPresets().presets[name];
  if (!payload) return;
  const values = payload.values || migrateSnapshotObject(payload);
  node._kooSigmaRestoring = true;
  for (const [key, value] of Object.entries(values || {})) if (BACKEND_WIDGET_NAMES.includes(key) && value != null) rawSet(node, key, value);
  node._kooSigmaRestoring = false;
  if (payload.appearance) node.properties.kooSigmaAppearance = { ...node.properties.kooSigmaAppearance, ...payload.appearance };
  node.properties.kooSigmaPresetName = name;
  storeActiveMode(node);
  setStatus(node, `Loaded preset: ${name}`);
}

function palette(node) {
  const appearance = node.properties.kooSigmaAppearance;
  const key = `${appearance.accent}|${appearance.contrast}`;
  if (node._kooSigmaPaletteKey !== key) {
    node._kooSigmaPalette = buildAccentPalette(appearance.accent, appearance.contrast);
    node._kooSigmaPaletteKey = key;
  }
  return node._kooSigmaPalette;
}
function tokens(node) { return THEME_TOKENS[node.properties.kooSigmaAppearance.theme] || THEME_TOKENS.Dark; }

function currentPreview(node) {
  return schedulePreview(valueReader(node), node._kooSigmaLivePoints || getValue(node, "normalized_manual_points", "") || getValue(node, "manual_curve_points", "[]"));
}
function currentPoints(node, preview = currentPreview(node)) {
  if (node._kooSigmaLivePoints) return node._kooSigmaLivePoints.map((point) => ({ ...point }));
  return sanitizePoints(getValue(node, "normalized_manual_points", "") || getValue(node, "manual_curve_points", "[]"), preview.start, preview.end, Boolean(getValue(node, "lock_monotonic_curve", true)), Boolean(getValue(node, "normalize_endpoints", true)), Boolean(getValue(node, "prevent_duplicate_sigmas", true)));
}
function pushHistory(node) {
  node._kooSigmaUndo ||= [];
  node._kooSigmaRedo = [];
  node._kooSigmaUndo.push(getValue(node, "normalized_manual_points", "") || getValue(node, "manual_curve_points", "[]"));
  if (node._kooSigmaUndo.length > 80) node._kooSigmaUndo.shift();
}
function writePoints(node, points, { history = true, notify = true } = {}) {
  if (history) pushHistory(node);
  const text = serializePoints(points);
  rawSet(node, "manual_curve_points", text);
  rawSet(node, "normalized_manual_points", text);
  node._kooSigmaLivePoints = null;
  if (notify) {
    widget(node, "manual_curve_points")?.callback?.(text, app.canvas, node, app.canvas?.graph_mouse);
    storeActiveMode(node);
  }
  node.setDirtyCanvas?.(true, true);
}
function restoreHistory(node, direction) {
  const from = direction === "undo" ? node._kooSigmaUndo : node._kooSigmaRedo;
  const to = direction === "undo" ? (node._kooSigmaRedo ||= []) : (node._kooSigmaUndo ||= []);
  const next = from?.pop();
  if (!next) return;
  to.push(getValue(node, "normalized_manual_points", "") || getValue(node, "manual_curve_points", "[]"));
  rawSet(node, "manual_curve_points", next); rawSet(node, "normalized_manual_points", next);
  const ids = new Set(currentPoints(node).map((point) => point.id));
  if (!ids.has(node._kooSigmaSelectedId)) node._kooSigmaSelectedId = null;
  storeActiveMode(node); node.setDirtyCanvas?.(true, true);
}

function formatSigma(value, digits = 6) {
  if (!Number.isFinite(Number(value))) return "-";
  const absolute = Math.abs(value);
  return absolute > 0 && absolute < 0.0001 ? Number(value).toExponential(3) : Number(value).toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
}
function rectContains(box, pos) { return box && pos[0] >= box.x && pos[0] <= box.x + box.w && pos[1] >= box.y && pos[1] <= box.y + box.h; }
function addHit(layout, kind, box, value = null, tooltip = null) { layout.hitboxes.push({ ...box, kind, value, tooltip }); return box; }
function wrapped(items, x, y, width, height = 27, gap = 7, min = 92) {
  const output = []; let cursorX = x; let cursorY = y;
  for (const item of items) {
    const label = item.label || item.name || String(item);
    const w = Math.min(width, Math.max(min, label.length * 6.6 + 24));
    if (cursorX > x && cursorX + w > x + width) { cursorX = x; cursorY += height + gap; }
    output.push({ ...item, label, x: cursorX, y: cursorY, w, h: height }); cursorX += w + gap;
  }
  return { boxes: output, height: output.length ? output.at(-1).y + height - y : 0 };
}

function makeLayout(node) {
  const width = Math.max(620, node.size?.[0] || 720);
  const compact = width < 760;
  const margin = compact ? 14 : 18;
  const gap = 10;
  const contentW = width - margin * 2;
  const layout = { width, compact, hitboxes: [] };
  let y = 14;
  const section = (height) => { const box = { x: margin, y, w: contentW, h: height }; y += height + gap; return box; };

  layout.header = section(105);
  const workflowW = (layout.header.w - 28 - gap * 4) / 5;
  WORKFLOWS.forEach((name, index) => addHit(layout, "workflow", { x: layout.header.x + 14 + index * (workflowW + gap), y: layout.header.y + 62, w: workflowW, h: 28 }, name, TOOLTIPS.workflow));
  addHit(layout, "complexity", { x: layout.header.x + layout.header.w - 92, y: layout.header.y + 12, w: 78, h: 26 }, null, "BASIC keeps the essential designer visible. PRO adds precision editing and constraints.");

  layout.range = section(102);
  const rangeW = (layout.range.w - 28 - gap * 2) / 3;
  RANGE_MODES.forEach((name, index) => addHit(layout, "range", { x: layout.range.x + 14 + index * (rangeW + gap), y: layout.range.y + 34, w: rangeW, h: 27 }, name, TOOLTIPS.range));
  layout.rangeSource = addHit(layout, "cycle", { x: layout.range.x + 14, y: layout.range.y + 68, w: layout.range.w * .55, h: 24 }, "range_source", TOOLTIPS.range_source);
  layout.handoff = addHit(layout, "number", { x: layout.range.x + layout.range.w * .59, y: layout.range.y + 68, w: layout.range.w * .39 - 14, h: 24 }, "handoff_sigma", TOOLTIPS.handoff_sigma);

  const builtIns = presetsFor(getValue(node, "mode", "AUTO"), getValue(node, "sigma_range_mode", "FULL RANGE"));
  const users = Object.keys(readUserPresets().presets).map((name) => ({ name, label: name, user: true }));
  const presetWrap = wrapped([...builtIns, ...users], margin + 14, y + 34, contentW - 28, 27, 7, 102);
  layout.presets = section(48 + presetWrap.height);
  layout.presetButtons = presetWrap.boxes;
  for (const box of presetWrap.boxes) addHit(layout, box.user ? "userPreset" : "preset", box, box.name, `Apply ${box.name}`);

  layout.graph = section(compact ? 300 : 324);
  layout.plot = { x: layout.graph.x + 64, y: layout.graph.y + 68, w: layout.graph.w - 82, h: layout.graph.h - 106 };
  addHit(layout, "graph", layout.plot, null, TOOLTIPS.graph);

  const visibleControls = getValue(node, "mode", "AUTO") === "IMG2IMG REFINE" ? [["denoise_active_range", "Denoise / Active Range"], ...CONTROL_ROWS] : CONTROL_ROWS;
  const sliderRows = Math.ceil(visibleControls.length / (compact ? 1 : 2));
  layout.controls = section(42 + sliderRows * 40 + 42);
  layout.sliders = [];
  const columns = compact ? 1 : 2;
  const colW = (layout.controls.w - 28 - gap * (columns - 1)) / columns;
  visibleControls.forEach(([name, label], index) => {
    const box = { x: layout.controls.x + 14 + (index % columns) * (colW + gap), y: layout.controls.y + 34 + Math.floor(index / columns) * 40, w: colW, h: 30, name, label };
    layout.sliders.push(box); addHit(layout, "slider", box, name, TOOLTIPS[name]);
  });
  const basicY = layout.controls.y + layout.controls.h - 34;
  layout.steps = addHit(layout, "number", { x: layout.controls.x + 14, y: basicY, w: (layout.controls.w - 38) / 2, h: 24 }, "steps", "Fallback steps; connected input length wins unless Output Steps Override is enabled.");
  layout.maxSigma = addHit(layout, "number", { x: layout.steps.x + layout.steps.w + 10, y: basicY, w: layout.steps.w, h: 24 }, "max_sigma", "Fallback/model maximum; ignored for usable AUTO / INPUT schedules.");

  const pro = getValue(node, "ui_complexity", "BASIC") === "PRO";
  if (pro) {
    layout.manual = section(128);
    const actions = wrapped(["Undo", "Redo", "Add Point", "Delete Point", "Redistribute", "Smooth Curve", "Simplify", "Reset", "Copy Sigma List", "Paste Sigma List"].map((name) => ({ name })), layout.manual.x + 14, layout.manual.y + 70, layout.manual.w - 28, 24, 6, 70);
    layout.manualActions = actions.boxes;
    for (const box of actions.boxes) addHit(layout, "manualAction", box, box.name);
    layout.positionEdit = addHit(layout, "pointNumber", { x: layout.manual.x + 14, y: layout.manual.y + 38, w: (layout.manual.w - 48) / 3, h: 25 }, "position", "Edit the selected point position as a percentage.");
    layout.sigmaEdit = addHit(layout, "pointNumber", { x: layout.positionEdit.x + layout.positionEdit.w + 10, y: layout.manual.y + 38, w: layout.positionEdit.w, h: 25 }, "sigma", "Edit the selected point sigma with full numeric precision.");
    layout.deltaView = { x: layout.sigmaEdit.x + layout.sigmaEdit.w + 10, y: layout.manual.y + 38, w: layout.positionEdit.w, h: 25 };

    layout.tableHeader = section(getValue(node, "point_table_open", false) ? 326 : 42);
    addHit(layout, "toggle", { x: layout.tableHeader.x, y: layout.tableHeader.y, w: layout.tableHeader.w, h: 42 }, "point_table_open", "Show the editable manual point table.");
    layout.tableRows = [];
    if (getValue(node, "point_table_open", false)) {
      const preview = currentPreview(node); const points = currentPoints(node, preview);
      const pages = Math.max(1, Math.ceil(points.length / 10));
      node.properties.kooSigmaTablePage = clamp(node.properties.kooSigmaTablePage, 0, pages - 1);
      const start = node.properties.kooSigmaTablePage * 10;
      points.slice(start, start + 10).forEach((point, row) => {
        const box = { x: layout.tableHeader.x + 14, y: layout.tableHeader.y + 62 + row * 24, w: layout.tableHeader.w - 28, h: 22, point, index: start + row };
        layout.tableRows.push(box); addHit(layout, "tableRow", box, point.id);
        addHit(layout, "tablePosition", { x: box.x + box.w * .25, y: box.y, w: box.w * .25, h: box.h }, point.id);
        addHit(layout, "tableSigma", { x: box.x + box.w * .50, y: box.y, w: box.w * .25, h: box.h }, point.id);
      });
      addHit(layout, "tablePage", { x: layout.tableHeader.x + layout.tableHeader.w - 126, y: layout.tableHeader.y + 38, w: 52, h: 20 }, -1);
      addHit(layout, "tablePage", { x: layout.tableHeader.x + layout.tableHeader.w - 66, y: layout.tableHeader.y + 38, w: 52, h: 20 }, 1);
    }

    const advancedOpen = node.properties.kooSigmaAdvancedOpen;
    layout.advanced = section(advancedOpen ? 286 : 42);
    addHit(layout, "propertyToggle", { x: layout.advanced.x, y: layout.advanced.y, w: layout.advanced.w, h: 42 }, "kooSigmaAdvancedOpen");
    layout.advancedFields = [];
    layout.advancedToggles = [];
    if (advancedOpen) {
      const fields = [
        ["interpolation_type", "Interpolation", "cycle"], ["input_already_cropped", "Input Cropped", "cycle"],
        ["curve_gamma", "Curve Gamma", "number"], ["tail_exponent", "Tail Exponent", "number"],
        ["tail_length", "Tail Length", "number"], ["high_to_mid_boundary", "High to Mid", "number"],
        ["mid_to_low_boundary", "Mid to Low", "number"], ["custom_max_sigma", "Custom Max", "number"],
        ["output_steps_override", "Output Steps", "number"],
      ];
      const fw = (layout.advanced.w - 28 - gap * 2) / 3;
      fields.forEach(([name, label, kind], index) => {
        const box = { x: layout.advanced.x + 14 + index % 3 * (fw + gap), y: layout.advanced.y + 42 + Math.floor(index / 3) * 30, w: fw, h: 24, name, label };
        layout.advancedFields.push(box); addHit(layout, kind, box, name, TOOLTIPS[name]);
      });
      const toggleY = layout.advanced.y + 140;
      [...SAFETY_ROWS, ["output_steps_override_enabled", "Output Steps Override"]].forEach(([name, label], index) => {
        const box = { x: layout.advanced.x + 14 + index % 3 * (fw + gap), y: toggleY + Math.floor(index / 3) * 27, w: fw, h: 22, name, label };
        layout.advancedToggles.push(box); addHit(layout, "toggle", box, name, TOOLTIPS[name]);
      });
      const displayY = toggleY + 90;
      DISPLAY_ROWS.forEach(([name, label], index) => {
        const box = { x: layout.advanced.x + 14 + index % 3 * (fw + gap), y: displayY + Math.floor(index / 3) * 27, w: fw, h: 22, name, label };
        layout.advancedToggles.push(box); addHit(layout, "toggle", box, name);
      });
      layout.presetTools = wrapped(["Save Preset", "Import Preset", "Export Preset", "Delete Preset"].map((name) => ({ name })), layout.advanced.x + 14, layout.advanced.y + 246, layout.advanced.w - 28, 24, 6, 88).boxes;
      for (const box of layout.presetTools) addHit(layout, "presetTool", box, box.name);
    }

    const appearanceOpen = node.properties.kooSigmaAppearanceOpen;
    layout.appearance = section(appearanceOpen ? 116 : 42);
    addHit(layout, "propertyToggle", { x: layout.appearance.x, y: layout.appearance.y, w: layout.appearance.w, h: 42 }, "kooSigmaAppearanceOpen");
    layout.themeButtons = []; layout.swatches = [];
    if (appearanceOpen) {
      THEMES.forEach((name, index) => {
        const box = { x: layout.appearance.x + 78 + index * 66, y: layout.appearance.y + 44, w: 60, h: 25, name };
        layout.themeButtons.push(box); addHit(layout, "theme", box, name);
      });
      SWATCHES.forEach((color, index) => {
        const box = { x: layout.appearance.x + 78 + index * 28, y: layout.appearance.y + 82, w: 19, h: 19, color };
        layout.swatches.push(box); addHit(layout, "accent", box, color);
      });
      addHit(layout, "contrast", { x: layout.appearance.x + layout.appearance.w - 112, y: layout.appearance.y + 44, w: 98, h: 25 });
    }
  }
  layout.footer = { x: margin, y, w: contentW, h: 30 };
  layout.desiredHeight = Math.max(620, y + 44);
  return layout;
}

function button(ctx, box, label, active, t, p, enabled = true) {
  drawRound(ctx, box, active ? activeFill(p, .20) : t.surfaceRaised, active ? p.accentBorder : t.border, active ? 1.8 : 1, 5);
  drawText(ctx, ellipsize(ctx, label, box.w - 10), box.x + box.w / 2, box.y + box.h / 2 + 1, 10.5, enabled ? (active ? activeForeground(p, t.text) : t.textSecondary) : t.textMuted, active ? "850" : "650", "center");
}
function sectionFrame(ctx, box, title, t, suffix = "") {
  drawRound(ctx, box, t.surface, t.border, 1, 7);
  drawText(ctx, title, box.x + 14, box.y + 19, 11.5, t.textMuted, "850");
  if (suffix) drawText(ctx, suffix, box.x + box.w - 14, box.y + 19, 10.5, t.textMuted, "650", "right");
}
function toggle(ctx, box, label, active, t, p) {
  drawRound(ctx, box, active ? activeFill(p, .14) : t.background, active ? p.accentBorder : t.border, 1, 5);
  ctx.beginPath(); ctx.arc(box.x + 10, box.y + box.h / 2, 3.5, 0, Math.PI * 2); ctx.fillStyle = active ? p.accentSolid : t.textMuted; ctx.fill();
  drawText(ctx, ellipsize(ctx, label, box.w - 36), box.x + 19, box.y + box.h / 2 + 1, 9.5, active ? t.text : t.textSecondary, "700");
  drawText(ctx, active ? "ON" : "OFF", box.x + box.w - 7, box.y + box.h / 2 + 1, 8.5, t.textMuted, "800", "right");
}
function field(ctx, box, label, value, t) {
  drawRound(ctx, box, t.background, t.border, 1, 5);
  drawText(ctx, ellipsize(ctx, label, box.w * .58), box.x + 8, box.y + box.h / 2 + 1, 10.5, t.textMuted, "750");
  drawText(ctx, ellipsize(ctx, String(value), box.w * .40), box.x + box.w - 8, box.y + box.h / 2 + 1, 11, t.textSecondary, "750", "right");
}
function slider(ctx, node, box, t, p) {
  const unit = box.name === "denoise_active_range";
  const value = unit ? clamp(getValue(node, box.name, 1), 0, 1) * 100 : clamp(getValue(node, box.name, 50), 0, 100);
  drawText(ctx, box.label, box.x, box.y + 8, 10.5, t.textMuted, "800");
  drawText(ctx, unit ? `${(value / 100).toFixed(2)} (${Math.round(value)}%)` : `${Math.round(value)}%`, box.x + box.w, box.y + 8, 10.5, t.textSecondary, "750", "right");
  const track = { x: box.x, y: box.y + 18, w: box.w, h: 8 };
  drawRound(ctx, track, t.background, t.border, 1, 4);
  drawRound(ctx, { ...track, w: Math.max(5, track.w * value / 100) }, activeFill(p, .24), p.accentBorder, 1, 4);
}

function graphPointXY(point, plot, start, end) {
  const span = Math.max(1e-12, start - end);
  return { x: plot.x + point.x * plot.w, y: plot.y + (1 - clamp((point.sigma - end) / span, 0, 1)) * plot.h };
}
function drawCurve(ctx, values, plot, start, end, color, width, dashed = false) {
  if (!values?.length) return;
  const span = Math.max(1e-12, start - end);
  ctx.save(); if (dashed) ctx.setLineDash([6, 4]);
  ctx.beginPath(); values.forEach((value, index) => {
    const x = plot.x + index / Math.max(1, values.length - 1) * plot.w;
    const y = plot.y + (1 - clamp((value - end) / span, 0, 1)) * plot.h;
    if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); ctx.restore();
}
function drawGraph(ctx, node, layout, preview, t, p) {
  sectionFrame(ctx, layout.graph, "SIGMA SCHEDULE", t, inputConnected(node) ? "runtime input: preview is approximate" : "fallback preview");
  const plot = layout.plot;
  const points = currentPoints(node, preview);
  const axisStart = Math.max(preview.start, ...preview.active, ...preview.generated, ...preview.output, ...points.map((point) => point.sigma));
  const axisEnd = Math.max(0, Math.min(preview.end, ...preview.active, ...preview.generated, ...preview.output, ...points.map((point) => point.sigma)));
  node._kooSigmaGraphRange = { start: axisStart, end: axisEnd };
  drawRound(ctx, { x: plot.x - 1, y: plot.y - 1, w: plot.w + 2, h: plot.h + 2 }, t.background, t.border, 1, 5);
  ctx.save(); roundedRect(ctx, plot.x, plot.y, plot.w, plot.h, 4); ctx.clip();
  for (let index = 0; index <= 4; index++) {
    const x = plot.x + index / 4 * plot.w; const y = plot.y + index / 4 * plot.h;
    ctx.strokeStyle = hexToRgba(p.accentSolid, .09); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
  }
  if (getValue(node, "show_reference_curve", true)) drawCurve(ctx, preview.active, plot, axisStart, axisEnd, t.textMuted, 1.2);
  if (getValue(node, "show_generated_curve", true)) drawCurve(ctx, preview.generated, plot, axisStart, axisEnd, hexToRgba(p.accentSolid, .58), 1.8, true);
  if (getValue(node, "show_final_curve", true)) drawCurve(ctx, preview.output, plot, axisStart, axisEnd, p.accentSolid, 3);
  ctx.restore();
  for (let index = 0; index <= 4; index++) {
    const sigma = axisStart + (axisEnd - axisStart) * index / 4;
    drawText(ctx, formatSigma(sigma, 4), plot.x - 8, plot.y + index / 4 * plot.h + 1, 9.5, t.textMuted, "700", "right");
    drawText(ctx, `${Math.round(index * 25)}%`, plot.x + index / 4 * plot.w, plot.y + plot.h + 15, 9, t.textMuted, "650", "center");
  }
  drawText(ctx, "Sampling Progression / Steps", plot.x + plot.w / 2, layout.graph.y + layout.graph.h - 9, 10, t.textMuted, "750", "center");
  drawText(ctx, "SIGMA", layout.graph.x + 12, plot.y - 12, 9, t.textMuted, "850");
  const stats = [
    ["START SIGMA", formatSigma(preview.start, 6)], ["END SIGMA", formatSigma(preview.end, 6)],
    ["ACTIVE STEPS", String(runtimeSteps(node, preview))],
  ];
  stats.forEach(([label, value], index) => {
    const x = layout.graph.x + 14 + index * (layout.graph.w - 28) / 3;
    drawText(ctx, label, x, layout.graph.y + 38, 9, t.textMuted, "800");
    drawText(ctx, value, x, layout.graph.y + 54, 12, t.text, "850");
  });
  node._kooSigmaRenderedPoints = [];
  const showLabels = Boolean(getValue(node, "show_sigma_labels", true));
  const showSteps = Boolean(getValue(node, "show_step_numbers", true));
  let lastLabelX = -Infinity;
  if (getValue(node, "mode", "AUTO") === "CUSTOM") {
    const stride = Math.max(1, Math.ceil(points.length / 240));
    points.forEach((point, index) => {
    if (index % stride && index !== points.length - 1 && point.id !== node._kooSigmaSelectedId) return;
    const xy = graphPointXY(point, plot, axisStart, axisEnd);
    node._kooSigmaRenderedPoints.push({ ...xy, id: point.id, index });
    ctx.beginPath(); ctx.arc(xy.x, xy.y, point.id === node._kooSigmaSelectedId ? 6 : 4.5, 0, Math.PI * 2);
    ctx.fillStyle = point.id === node._kooSigmaSelectedId ? activeForeground(p, t.text) : t.textSecondary; ctx.fill();
    ctx.strokeStyle = p.accentSolid; ctx.lineWidth = 1.7; ctx.stroke();
    if ((showLabels || showSteps) && (xy.x - lastLabelX > 48 || index === points.length - 1)) {
      const label = `${showSteps ? `${Math.round(point.x * runtimeSteps(node, preview))}: ` : ""}${showLabels ? formatSigma(point.sigma, 4) : ""}`;
      const y = clamp(xy.y - (index % 2 ? 17 : 8), plot.y + 10, plot.y + plot.h - 7);
      drawText(ctx, label, xy.x + 5, y, 8.5, t.textSecondary, "750"); lastLabelX = xy.x;
    }
    });
  } else if (showLabels || showSteps) {
    const span = Math.max(1e-12, axisStart - axisEnd);
    const stride = Math.max(1, Math.ceil(preview.output.length / 11));
    let previousLabelX = -Infinity;
    preview.output.forEach((sigma, index) => {
      if (index % stride && index !== preview.output.length - 1) return;
      const x = plot.x + index / Math.max(1, preview.output.length - 1) * plot.w;
      const y = plot.y + (1 - clamp((sigma - axisEnd) / span, 0, 1)) * plot.h;
      ctx.beginPath(); ctx.arc(x, y, 2.8, 0, Math.PI * 2); ctx.fillStyle = p.accentSolid; ctx.fill();
      if (x - previousLabelX > 52 || index === preview.output.length - 1) {
        const label = `${showSteps ? `${index}: ` : ""}${showLabels ? formatSigma(sigma, 4) : ""}`;
        drawText(ctx, label, x + 4, clamp(y - 8 - (index % 2) * 10, plot.y + 9, plot.y + plot.h - 7), 8.5, t.textSecondary, "700");
        previousLabelX = x;
      }
    });
  }
  drawText(ctx, "REFERENCE", plot.x + 8, plot.y + 12, 8.5, t.textMuted, "650");
  drawText(ctx, "GENERATED", plot.x + 78, plot.y + 12, 8.5, hexToRgba(p.accentSolid, .65), "650");
  drawText(ctx, "FINAL", plot.x + 154, plot.y + 12, 8.5, p.accentSolid, "850");
}

function runtimeSteps(node, preview) {
  if (getValue(node, "output_steps_override_enabled", false)) return Math.max(1, Math.round(getValue(node, "output_steps_override", preview.count - 1)));
  return inputConnected(node) ? `input (${preview.count - 1} preview)` : Math.max(1, Math.round(getValue(node, "steps", preview.count - 1)));
}
function inputConnected(node) {
  const input = node.inputs?.find((item) => item.name === "reference_sigmas");
  return input?.link != null || Boolean(input?.links?.length);
}
function selectedInfo(node, points, preview) {
  const index = points.findIndex((point) => point.id === node._kooSigmaSelectedId);
  if (index < 0) return null;
  const point = points[index];
  return { point, index, step: Math.round(point.x * (Number(runtimeSteps(node, preview)) || preview.count - 1)), delta: index ? point.sigma - points[index - 1].sigma : null };
}

function drawUI(node, ctx) {
  ensureProperties(node); detachWidgets(node);
  const t = tokens(node); const p = palette(node); const layout = makeLayout(node); const preview = currentPreview(node);
  node._kooSigmaLayout = layout; node._kooSigmaHitboxes = layout.hitboxes;
  if (!node.size || node.size[0] < 620 || node.size[1] < layout.desiredHeight) node.size = [layout.width, Math.max(node.size?.[1] || 0, layout.desiredHeight)];
  drawRound(ctx, { x: 7, y: 7, w: layout.width - 14, h: Math.max(layout.desiredHeight - 14, (node.size?.[1] || layout.desiredHeight) - 14) }, t.background, t.borderStrong, 1.4, 11);
  sectionFrame(ctx, layout.header, "SIGMA SCHEDULE DESIGNER", t, inputConnected(node) ? "SIGMAS connected" : "using fallback source");
  drawText(ctx, `${getValue(node, "mode", "AUTO")}  |  ${getValue(node, "sigma_range_mode", "FULL RANGE")}  |  ${node.properties.kooSigmaPresetName}`, layout.header.x + 14, layout.header.y + 43, 12, t.text, "850");
  button(ctx, layout.hitboxes.find((box) => box.kind === "complexity"), getValue(node, "ui_complexity", "BASIC"), true, t, p);
  layout.hitboxes.filter((box) => box.kind === "workflow").forEach((box) => button(ctx, box, box.value, getValue(node, "mode", "AUTO") === box.value, t, p));

  sectionFrame(ctx, layout.range, "SIGMA RANGE MODE", t, "numeric range selection");
  layout.hitboxes.filter((box) => box.kind === "range").forEach((box) => button(ctx, box, box.value, getValue(node, "sigma_range_mode", "FULL RANGE") === box.value, t, p));
  field(ctx, layout.rangeSource, "Range Source", getValue(node, "range_source", "AUTO / INPUT"), t);
  field(ctx, layout.handoff, "Handoff Sigma", formatSigma(getValue(node, "handoff_sigma", 1.6), 6), t);

  sectionFrame(ctx, layout.presets, "PURPOSE-BUILT PRESETS", t, getValue(node, "sigma_range_mode", "FULL RANGE"));
  layout.presetButtons.forEach((box) => button(ctx, box, box.label, node.properties.kooSigmaPresetName === box.name, t, p));
  drawGraph(ctx, node, layout, preview, t, p);

  sectionFrame(ctx, layout.controls, "PERCEPTUAL CONTROLS", t, "predictable schedule allocation");
  layout.sliders.forEach((box) => slider(ctx, node, box, t, p));
  field(ctx, layout.steps, inputConnected(node) ? "Fallback Steps" : "Steps", getValue(node, "steps", 30), t);
  field(ctx, layout.maxSigma, "Fallback Max Sigma", formatSigma(getValue(node, "max_sigma", 14.6), 4), t);

  if (layout.manual) drawManual(ctx, node, layout, preview, t, p);
  if (layout.advanced) drawAdvanced(ctx, node, layout, t, p);
  if (layout.appearance) drawAppearance(ctx, node, layout, t, p);
  const footer = node._kooSigmaHoverTip || node.properties.kooSigmaStatus || "Ready";
  drawText(ctx, ellipsize(ctx, footer, layout.footer.w - 4), layout.footer.x + 2, layout.footer.y + 13, 10.5, t.textMuted, "600");
}

function drawManual(ctx, node, layout, preview, t, p) {
  sectionFrame(ctx, layout.manual, "PRECISION MANUAL EDITOR", t, "Alt+click add | right-click delete | Shift fine | Ctrl snap");
  const points = currentPoints(node, preview); const selected = selectedInfo(node, points, preview);
  field(ctx, layout.positionEdit, "Position", selected ? `${(selected.point.x * 100).toFixed(4)} %` : "select point", t);
  field(ctx, layout.sigmaEdit, "Sigma", selected ? formatSigma(selected.point.sigma, 6) : "select point", t);
  field(ctx, layout.deltaView, "Delta Sigma", selected?.delta == null ? "-" : formatSigma(selected.delta, 6), t);
  if (selected) drawText(ctx, `Selected Point ${selected.index + 1} / ${points.length}  |  Step ${selected.step}`, layout.manual.x + layout.manual.w - 14, layout.manual.y + 19, 10, t.textMuted, "700", "right");
  layout.manualActions.forEach((box) => button(ctx, box, box.label, false, t, p, actionEnabled(node, box.name, points)));
  drawTable(ctx, node, layout, preview, points, t, p);
}

function drawTable(ctx, node, layout, preview, points, t, p) {
  sectionFrame(ctx, layout.tableHeader, "MANUAL POINT TABLE", t, getValue(node, "point_table_open", false) ? "^" : "v");
  if (!getValue(node, "point_table_open", false)) return;
  const pages = Math.max(1, Math.ceil(points.length / 10));
  drawText(ctx, "STEP", layout.tableHeader.x + 22, layout.tableHeader.y + 52, 9, t.textMuted, "850");
  drawText(ctx, "POSITION", layout.tableHeader.x + layout.tableHeader.w * .28, layout.tableHeader.y + 52, 9, t.textMuted, "850");
  drawText(ctx, "SIGMA", layout.tableHeader.x + layout.tableHeader.w * .53, layout.tableHeader.y + 52, 9, t.textMuted, "850");
  drawText(ctx, "DELTA", layout.tableHeader.x + layout.tableHeader.w * .78, layout.tableHeader.y + 52, 9, t.textMuted, "850");
  for (const row of layout.tableRows) {
    const active = row.point.id === node._kooSigmaSelectedId;
    drawRound(ctx, row, active ? activeFill(p, .12) : t.background, active ? p.accentBorder : t.border, 1, 3);
    const delta = row.index ? row.point.sigma - points[row.index - 1].sigma : null;
    const columns = [String(Math.round(row.point.x * (Number(runtimeSteps(node, preview)) || preview.count - 1))), `${(row.point.x * 100).toFixed(4)}%`, formatSigma(row.point.sigma, 6), delta == null ? "-" : formatSigma(delta, 6)];
    columns.forEach((value, index) => drawText(ctx, value, row.x + row.w * (.02 + index * .25), row.y + row.h / 2 + 1, 10, active ? t.text : t.textSecondary, active ? "800" : "650"));
  }
  const pageButtons = layout.hitboxes.filter((box) => box.kind === "tablePage");
  pageButtons.forEach((box) => button(ctx, box, box.value < 0 ? "Prev" : "Next", false, t, p));
  drawText(ctx, `Page ${node.properties.kooSigmaTablePage + 1} / ${pages}  |  ${points.length} points`, layout.tableHeader.x + 14, layout.tableHeader.y + layout.tableHeader.h - 12, 9.5, t.textMuted, "700");
}

function drawAdvanced(ctx, node, layout, t, p) {
  sectionFrame(ctx, layout.advanced, "ADVANCED & VALIDATION", t, node.properties.kooSigmaAdvancedOpen ? "^" : "v");
  if (!node.properties.kooSigmaAdvancedOpen) return;
  layout.advancedFields.forEach((box) => field(ctx, box, box.label, String(getValue(node, box.name, "")), t));
  layout.advancedToggles.forEach((box) => toggle(ctx, box, box.label, Boolean(getValue(node, box.name, false)), t, p));
  layout.presetTools.forEach((box) => button(ctx, box, box.label, false, t, p));
}
function drawAppearance(ctx, node, layout, t, p) {
  sectionFrame(ctx, layout.appearance, "APPEARANCE", t, node.properties.kooSigmaAppearanceOpen ? "^" : "v");
  if (!node.properties.kooSigmaAppearanceOpen) return;
  drawPaletteIcon(ctx, layout.appearance.x + 14, layout.appearance.y + 43, node.properties.kooSigmaAppearance.accent, t);
  layout.themeButtons.forEach((box) => button(ctx, box, box.name, node.properties.kooSigmaAppearance.theme === box.name, t, p));
  layout.swatches.forEach((box) => {
    ctx.beginPath(); ctx.arc(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, 0, Math.PI * 2); ctx.fillStyle = box.color; ctx.fill();
    if (normalizeHex(box.color) === normalizeHex(node.properties.kooSigmaAppearance.accent)) { ctx.strokeStyle = t.text; ctx.lineWidth = 2; ctx.stroke(); }
  });
  toggle(ctx, layout.hitboxes.find((box) => box.kind === "contrast"), "High Contrast", node.properties.kooSigmaAppearance.contrast, t, p);
}

function hit(node, pos) { return (node._kooSigmaHitboxes || []).slice().reverse().find((box) => rectContains(box, pos)); }
function nearestRenderedPoint(node, pos, radius = 14) {
  let best = null;
  for (const point of node._kooSigmaRenderedPoints || []) {
    const distance = Math.hypot(point.x - pos[0], point.y - pos[1]);
    if (distance <= radius && (!best || distance < best.distance)) best = { ...point, distance };
  }
  return best;
}
function updateHover(node, pos) {
  const target = hit(node, pos);
  node._kooSigmaHoverTip = target?.tooltip || null;
  node.setDirtyCanvas?.(true, false);
}

function handlePointerDown(node, event, pos) {
  if (!requireBackendSchema(node)) return true;
  const target = hit(node, pos);
  if (!target) return false;
  if (target.kind === "graph") return graphPointerDown(node, event, pos);
  switch (target.kind) {
    case "workflow": switchWorkflow(node, target.value); break;
    case "complexity": setValue(node, "ui_complexity", getValue(node, "ui_complexity", "BASIC") === "BASIC" ? "PRO" : "BASIC"); break;
    case "range": setValue(node, "sigma_range_mode", target.value); break;
    case "preset": applyBuiltInPreset(node, target.value); break;
    case "userPreset": loadUserPreset(node, target.value); break;
    case "slider": setSlider(node, target, pos[0]); node._kooSigmaSliderDrag = target; break;
    case "number": openNumberEditor(node, target.value, event); break;
    case "pointNumber": openSelectedPointEditor(node, target.value, event); break;
    case "cycle": cycleField(node, target.value); break;
    case "toggle": {
      const next = !Boolean(getValue(node, target.value, false));
      if (target.value === "output_steps_override_enabled" && next && Number(getValue(node, "output_steps_override", 0)) < 1) rawSet(node, "output_steps_override", Math.max(1, Math.round(getValue(node, "steps", 30))));
      setValue(node, target.value, next); break;
    }
    case "propertyToggle": node.properties[target.value] = !node.properties[target.value]; node.setDirtyCanvas?.(true, true); break;
    case "manualAction": if (actionEnabled(node, target.value, currentPoints(node))) manualAction(node, target.value); break;
    case "tableRow": node._kooSigmaSelectedId = target.value; node.setDirtyCanvas?.(true, true); break;
    case "tablePosition": node._kooSigmaSelectedId = target.value; openSelectedPointEditor(node, "position", event); break;
    case "tableSigma": node._kooSigmaSelectedId = target.value; openSelectedPointEditor(node, "sigma", event); break;
    case "tablePage": node.properties.kooSigmaTablePage = Math.max(0, node.properties.kooSigmaTablePage + target.value); node.setDirtyCanvas?.(true, true); break;
    case "presetTool": presetTool(node, target.value); break;
    case "theme": node.properties.kooSigmaAppearance.theme = target.value; node.setDirtyCanvas?.(true, true); break;
    case "accent": node.properties.kooSigmaAppearance.accent = target.value; node._kooSigmaPaletteKey = null; node.setDirtyCanvas?.(true, true); break;
    case "contrast": node.properties.kooSigmaAppearance.contrast = !node.properties.kooSigmaAppearance.contrast; node._kooSigmaPaletteKey = null; node.setDirtyCanvas?.(true, true); break;
    default: return false;
  }
  return true;
}

function cycleField(node, name) {
  const choices = name === "range_source" ? RANGE_SOURCES : name === "interpolation_type" ? INTERPOLATIONS : name === "input_already_cropped" ? ["Auto", "Yes", "No"] : [];
  const index = choices.indexOf(getValue(node, name, choices[0]));
  setValue(node, name, choices[(index + 1) % choices.length]);
}
function setSlider(node, box, x) {
  const ratio = clamp((x - box.x) / box.w, 0, 1);
  setValue(node, box.value, box.value === "denoise_active_range" ? Number(ratio.toFixed(3)) : Math.round(ratio * 100));
}
function applyBuiltInPreset(node, name) {
  node._kooSigmaSuppressCallbacks = true;
  applyPresetValues((key, value) => rawSet(node, key, value), name);
  node._kooSigmaSuppressCallbacks = false;
  node.properties.kooSigmaPresetName = name;
  if (getValue(node, "mode", "AUTO") === "CUSTOM") rawSet(node, "ui_complexity", "PRO");
  storeActiveMode(node); setStatus(node, `${name}: scale-independent ${PRESETS[name]?.family || "reference"} sigma shape applied`);
}

function openFloatingNumber(event, value, { step = "any", min = null, max = null, onInput, onCommit, onCancel = () => {} }) {
  const input = document.createElement("input"); input.type = "number"; input.step = step; input.value = String(value);
  if (min != null) input.min = String(min); if (max != null) input.max = String(max);
  Object.assign(input.style, { position: "fixed", left: `${event.clientX - 64}px`, top: `${event.clientY - 15}px`, width: "128px", height: "28px", zIndex: 100000, color: "#fff", background: "#17191f", border: "1px solid #8b5cf6", borderRadius: "5px", padding: "2px 7px", font: "12px monospace" });
  document.body.appendChild(input); let closed = false;
  // This function is opened from LiteGraph's mouse-down handler. Focusing
  // immediately lets the canvas's matching mouse-up steal focus and trigger
  // blur before the user can type. Focus on the next frame, after that pointer
  // sequence has completed.
  const focusEditor = () => { if (!closed && input.isConnected) { input.focus(); input.select(); } };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(focusEditor);
  else setTimeout(focusEditor, 0);
  input.addEventListener("input", () => { const number = Number(input.value); if (Number.isFinite(number)) onInput(number); });
  const close = () => { if (closed) return; closed = true; const number = Number(input.value); if (Number.isFinite(number)) onCommit(number); input.remove(); };
  input.addEventListener("keydown", (keyEvent) => { if (keyEvent.key === "Enter") { keyEvent.preventDefault(); close(); } if (keyEvent.key === "Escape") { closed = true; onCancel(); input.remove(); } });
  input.addEventListener("blur", close, { once: true });
}
function openNumberEditor(node, name, event) {
  const limits = name.includes("boundary") || name === "tail_length" ? [0, 1] : name.includes("steps") ? [0, 10000] : [0, 1000];
  const original = getValue(node, name, 0);
  openFloatingNumber(event, original, { min: limits[0], max: limits[1], onInput: (number) => { rawSet(node, name, name.includes("steps") ? Math.round(number) : number); node.setDirtyCanvas?.(true, true); }, onCommit: (number) => setValue(node, name, name.includes("steps") ? Math.round(number) : number), onCancel: () => { rawSet(node, name, original); node.setDirtyCanvas?.(true, true); } });
}
function openSelectedPointEditor(node, fieldName, event) {
  const preview = currentPreview(node); const points = currentPoints(node, preview); const selected = points.find((point) => point.id === node._kooSigmaSelectedId);
  if (!selected) { setStatus(node, "Select a manual point first"); return; }
  const normalize = Boolean(getValue(node, "normalize_endpoints", true));
  const endpoint = selected === points[0] || selected === points.at(-1);
  if (endpoint && normalize) { setStatus(node, "Disable Normalize Endpoints to edit an endpoint"); return; }
  const rawBefore = getValue(node, "normalized_manual_points", "") || getValue(node, "manual_curve_points", "[]");
  pushHistory(node); const original = fieldName === "position" ? selected.x * 100 : selected.sigma;
  const update = (number) => updateSelectedPointValue(node, fieldName, number, preview, points);
  openFloatingNumber(event, original, { min: 0, max: fieldName === "position" ? 100 : Math.max(preview.start, selected.sigma) * 4 + 1, onInput: update, onCommit: (number) => { update(number); writePoints(node, node._kooSigmaLivePoints, { history: false, notify: true }); }, onCancel: () => { rawSet(node, "manual_curve_points", rawBefore); rawSet(node, "normalized_manual_points", rawBefore); node._kooSigmaLivePoints = null; node._kooSigmaUndo?.pop(); node.setDirtyCanvas?.(true, true); } });
}

function updateSelectedPointValue(node, fieldName, number, preview = currentPreview(node), points = currentPoints(node, preview)) {
  const selected = points.find((point) => point.id === node._kooSigmaSelectedId);
  if (!selected) return false;
  const x = fieldName === "position" ? number / 100 : selected.x;
  const sigma = fieldName === "sigma" ? number : selected.sigma;
  node._kooSigmaLivePoints = movePoint(points, selected.id, x, sigma, {
    lockMonotonic: Boolean(getValue(node, "lock_monotonic_curve", true)),
    normalizeEndpoints: Boolean(getValue(node, "normalize_endpoints", true)),
    preventDuplicates: Boolean(getValue(node, "prevent_duplicate_sigmas", true)),
  });
  const text = serializePoints(node._kooSigmaLivePoints);
  rawSet(node, "manual_curve_points", text); rawSet(node, "normalized_manual_points", text);
  node.setDirtyCanvas?.(true, true);
  return true;
}

function graphPointerDown(node, event, pos) {
  if (getValue(node, "mode", "AUTO") !== "CUSTOM" || getValue(node, "ui_complexity", "BASIC") !== "PRO") {
    setStatus(node, "Switch to CUSTOM + PRO for manual point editing"); return true;
  }
  const preview = currentPreview(node); const plot = node._kooSigmaLayout.plot; const nearest = nearestRenderedPoint(node, pos);
  const graphRange = node._kooSigmaGraphRange || { start: preview.start, end: preview.end };
  if (event?.button === 2) {
    const id = nearest?.id || node._kooSigmaSelectedId; if (id) { writePoints(node, deletePoint(currentPoints(node, preview), id)); node._kooSigmaSelectedId = null; setStatus(node, "Point deleted"); }
    event.preventDefault?.(); return true;
  }
  if (event?.altKey) {
    const x = clamp((pos[0] - plot.x) / plot.w, 0, 1); const sigma = graphRange.end + (1 - clamp((pos[1] - plot.y) / plot.h, 0, 1)) * (graphRange.start - graphRange.end);
    const points = addPoint(currentPoints(node, preview), x, sigma); const added = points.reduce((best, point) => Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best, points[0]);
    node._kooSigmaSelectedId = added.id; writePoints(node, points); return true;
  }
  if (!nearest) { node._kooSigmaSelectedId = null; node.setDirtyCanvas?.(true, true); return true; }
  node._kooSigmaSelectedId = nearest.id;
  const point = currentPoints(node, preview).find((item) => item.id === nearest.id);
  node._kooSigmaPointDrag = { id: nearest.id, startPos: [...pos], originX: point.x, originSigma: point.sigma, points: currentPoints(node, preview), plot: { ...plot }, preview: { ...preview, ...graphRange }, history: false, moved: false };
  node.setDirtyCanvas?.(true, true); return true;
}
function dragPoint(node, event, pos) {
  const drag = node._kooSigmaPointDrag; if (!drag) return false;
  const factor = event?.shiftKey ? .1 : 1;
  const dx = (pos[0] - drag.startPos[0]) / drag.plot.w * factor;
  const dy = -(pos[1] - drag.startPos[1]) / drag.plot.h * (drag.preview.start - drag.preview.end) * factor;
  if (!drag.history && (Math.abs(dx) > 1e-7 || Math.abs(dy) > 1e-9)) { pushHistory(node); drag.history = true; }
  drag.moved = true;
  node._kooSigmaLivePoints = movePoint(drag.points, drag.id, drag.originX + dx, drag.originSigma + dy, {
    lockMonotonic: Boolean(getValue(node, "lock_monotonic_curve", true)), normalizeEndpoints: Boolean(getValue(node, "normalize_endpoints", true)), preventDuplicates: Boolean(getValue(node, "prevent_duplicate_sigmas", true)), snapSteps: event?.ctrlKey ? Math.max(1, Number(runtimeSteps(node, drag.preview)) || drag.preview.count - 1) : 0,
  });
  const text = serializePoints(node._kooSigmaLivePoints); rawSet(node, "manual_curve_points", text); rawSet(node, "normalized_manual_points", text);
  node.setDirtyCanvas?.(true, true); return true;
}
function finishPointDrag(node) {
  const drag = node._kooSigmaPointDrag; node._kooSigmaPointDrag = null;
  if (drag?.moved && node._kooSigmaLivePoints) writePoints(node, node._kooSigmaLivePoints, { history: false, notify: true });
  else node._kooSigmaLivePoints = null;
}

function actionEnabled(node, action, points) {
  if (action === "Undo") return Boolean(node._kooSigmaUndo?.length);
  if (action === "Redo") return Boolean(node._kooSigmaRedo?.length);
  if (action === "Delete Point") { const i = points.findIndex((point) => point.id === node._kooSigmaSelectedId); return i > 0 && i < points.length - 1; }
  if (action === "Simplify") return points.length > 3;
  if (action === "Smooth Curve" || action === "Redistribute") return points.length > 2;
  return true;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { prompt("Copy sigma list", text); return false; }
}
async function pasteText() {
  try { return await navigator.clipboard.readText(); } catch { return prompt("Paste sigma list (comma, space, newline, or -> separated)", "") || ""; }
}
function manualAction(node, action) {
  const preview = currentPreview(node); let points = currentPoints(node, preview); const selected = points.find((point) => point.id === node._kooSigmaSelectedId);
  if (action === "Undo") return restoreHistory(node, "undo");
  if (action === "Redo") return restoreHistory(node, "redo");
  if (action === "Add Point") {
    const index = Math.max(0, points.findIndex((point) => point.id === node._kooSigmaSelectedId)); const right = Math.min(points.length - 1, index + 1);
    const x = (points[index].x + points[right].x) / 2; const sigma = (points[index].sigma + points[right].sigma) / 2;
    points = addPoint(points, x || .5, sigma); const added = points.find((point) => Math.abs(point.x - (x || .5)) < 1e-4 && ![points[index]?.id, points[right]?.id].includes(point.id)); node._kooSigmaSelectedId = added?.id || points[Math.floor(points.length / 2)].id;
  } else if (action === "Delete Point") { points = deletePoint(points, selected?.id); node._kooSigmaSelectedId = null;
  } else if (action === "Redistribute") points = redistributePoints(points);
  else if (action === "Smooth Curve") points = smoothPoints(points);
  else if (action === "Simplify") points = simplifyPoints(points);
  else if (action === "Reset") { points = [{ id: "start", x: 0, sigma: preview.start }, { id: "end", x: 1, sigma: preview.end }]; node._kooSigmaSelectedId = "start";
  } else if (action === "Copy Sigma List") { copyText(preview.output.map((sigma) => formatSigma(sigma, 9)).join(", ")); setStatus(node, "Final output sigma list copied"); return;
  } else if (action === "Paste Sigma List") {
    pasteText().then((text) => { const values = parseSigmaList(text); if (values.length < 2) return setStatus(node, "Paste rejected: enter at least two finite sigmas"); rawSet(node, "mode", "CUSTOM"); rawSet(node, "profile", "Custom"); rawSet(node, "ui_complexity", "PRO"); rawSet(node, "reference_blend", 0); rawSet(node, "smoothness", 0); rawSet(node, "output_steps_override_enabled", true); rawSet(node, "output_steps_override", values.length - 1); const next = pointsFromSigmas(values); node._kooSigmaSelectedId = next[0].id; writePoints(node, next); setStatus(node, `Imported ${values.length} exact sigma values`); }); return;
  }
  writePoints(node, points); setStatus(node, `${action}: complete`);
}

function presetTool(node, action) {
  if (action === "Save Preset") return saveUserPreset(node);
  const current = node.properties.kooSigmaPresetName;
  if (action === "Delete Preset") {
    const data = readUserPresets(); if (!data.presets[current]) return setStatus(node, "Built-in presets cannot be deleted");
    if (confirm(`Delete preset "${current}"?`)) { delete data.presets[current]; writeUserPresets(data); node.properties.kooSigmaPresetName = canonicalPreset(getValue(node, "profile", "Balanced Generation")); }
  } else if (action === "Export Preset") {
    copyText(JSON.stringify({ schema_version: 2, preset_name: current, values: snapshot(node) }, null, 2)); setStatus(node, "Preset JSON copied");
  } else if (action === "Import Preset") {
    pasteText().then((text) => { try { const payload = JSON.parse(text); const values = payload.values || migrateSnapshotObject(payload); node._kooSigmaRestoring = true; for (const [key, value] of Object.entries(values)) if (BACKEND_WIDGET_NAMES.includes(key)) rawSet(node, key, value); node._kooSigmaRestoring = false; node.properties.kooSigmaPresetName = payload.preset_name || "Imported Preset"; storeActiveMode(node); setStatus(node, "Preset imported"); } catch { setStatus(node, "Preset import rejected: invalid JSON"); } });
  }
  node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
  name: "KoO.SigmaEqualizer",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments); detachWidgets(this); ensureProperties(this);
      this.resizable = true; this.serialize_widgets = true; this.size = [Math.max(720, this.size?.[0] || 0), Math.max(760, this.size?.[1] || 0)];
      if (backendSchemaReady(this)) rawSet(this, "workflow_schema_version", 2);
      else requireBackendSchema(this);
      return result;
    };
    const configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const result = configured?.apply(this, arguments); ensureProperties(this); detachWidgets(this, info?.widgets_values);
      if (backendSchemaReady(this)) migrateLegacyWorkflow(this, info); else requireBackendSchema(this);
      return result;
    };
    const serialize = nodeType.prototype.serialize;
    nodeType.prototype.serialize = function () {
      storeActiveMode(this); const data = serialize?.apply(this, arguments) || {};
      if (backendSchemaReady(this)) data.widgets_values = BACKEND_WIDGET_NAMES.map((name) => widget(this, name)?.value);
      data.properties = { ...(data.properties || {}), ...(this.properties || {}) }; return data;
    };
    nodeType.prototype.onDrawForeground = function (ctx) { if (backendSchemaReady(this)) drawUI(this, ctx); else drawSchemaMismatch(this, ctx); };
    const mouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (event, pos) { return handlePointerDown(this, event, pos) || mouseDown?.apply(this, arguments); };
    const mouseMove = nodeType.prototype.onMouseMove;
    nodeType.prototype.onMouseMove = function (event, pos) {
      if (this._kooSigmaSliderDrag) { setSlider(this, this._kooSigmaSliderDrag, pos[0]); return true; }
      if (this._kooSigmaPointDrag && dragPoint(this, event, pos)) return true;
      updateHover(this, pos); return mouseMove?.apply(this, arguments);
    };
    const mouseUp = nodeType.prototype.onMouseUp;
    nodeType.prototype.onMouseUp = function () { this._kooSigmaSliderDrag = null; finishPointDrag(this); return mouseUp?.apply(this, arguments); };
    const keyDown = nodeType.prototype.onKeyDown;
    nodeType.prototype.onKeyDown = function (event) {
      if ((event.key === "Delete" || event.key === "Backspace") && this._kooSigmaSelectedId && getValue(this, "mode", "AUTO") === "CUSTOM") { manualAction(this, "Delete Point"); return true; }
      if (event.ctrlKey && event.key.toLowerCase() === "z") { restoreHistory(this, event.shiftKey ? "redo" : "undo"); return true; }
      return keyDown?.apply(this, arguments);
    };
    const removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () { this._kooSigmaPointDrag = null; this._kooSigmaLivePoints = null; this._kooSigmaHitboxes = null; return removed?.apply(this, arguments); };
    const resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () { const result = resize?.apply(this, arguments); this.size[0] = Math.max(620, this.size[0]); this.setDirtyCanvas?.(true, true); return result; };
  },
});

export const __test = {
  BACKEND_WIDGET_NAMES,
  NEW_WIDGET_NAMES,
  backendSchemaReady,
  detachWidgets,
  getValue,
  handlePointerDown,
  migrateLegacyWorkflow,
  rawSet,
  switchWorkflow,
  updateSelectedPointValue,
  writePoints,
  dragPoint,
  finishPointDrag,
};
