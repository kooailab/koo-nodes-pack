import { app } from "../../../../scripts/app.js";

const NODE_NAME = "KoOWorkflowPresetManager";
const DISPLAY_NAME = "KoO Workflow Preset Manager";
const LEGACY_DISPLAY_NAME = "KoO.Workflow Preset Manager";
const EXTENSION_NAME = "koo.workflowPresetManager";
const LOG_PREFIX = "[KoO Preset Manager]";

const UID_PROPERTY = "koo_preset_uid";
const PRESETS_PROPERTY = "koo_presets";
const SELECTED_PROPERTY = "koo_preset_selected";
const DRAFT_NAME_PROPERTY = "koo_preset_draft_name";
const APPEARANCE_PROPERTY = "kooPresetManagerAppearance";

const FONT_STACK = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
const DEFAULT_WIDTH = 420;
const NO_PRESET_LABEL = "(no presets)";
const MAX_DROPDOWN_ROWS = 5;
const DEFAULT_ACCENT = "#FF4FA3";
const THEMES = ["Light", "Dark", "Spicy"];
const KOOL_GREEN = "#7ED957";

const LEGACY_WIDGET_NAMES = [
  "Preset Name",
  "Selected Preset",
  "Capture Selected",
  "Apply Preset",
  "Update Preset",
  "Delete Preset",
  "Status",
];

const THEME_TOKENS = {
  Dark: {
    background: "#15161A",
    surface: "#22242A",
    surfaceRaised: "#2D3037",
    surfaceHover: "#373A43",
    text: "#FFFFFF",
    textSecondary: "#CED1D8",
    textMuted: "#8D929C",
    border: "#444852",
    borderStrong: "#5A5F6B",
  },
  Light: {
    background: "#F1F3F6",
    surface: "#FFFFFF",
    surfaceRaised: "#E5E8ED",
    surfaceHover: "#DCE1E7",
    text: "#17191D",
    textSecondary: "#4D525A",
    textMuted: "#777D87",
    border: "#C7CCD4",
    borderStrong: "#AAB1BC",
  },
  Spicy: {
    background: "#0D071F",
    surface: "#231937",
    surfaceRaised: "#2D2145",
    surfaceHover: "#382854",
    text: "#FFFFFF",
    textSecondary: "#D8D0E5",
    textMuted: "#9C90AE",
    border: "rgba(255,255,255,0.12)",
    borderStrong: "rgba(255,255,255,0.20)",
    primaryPurple: "#7B3FF2",
    secondaryTeal: "#00D4B8",
    accentGold: "#FFB800",
  },
};

const DEFAULT_APPEARANCE = {
  theme: "Dark",
  accent: DEFAULT_ACCENT,
  appearanceOpen: true,
  contrastMode: false,
};

const SWATCHES = ["#FF4FA3", "#FF3048", "#FF7A30", "#FFC93A", "#7ED957", "#2ED6D6", "#3D8BFF", "#9B6CFF", "#FF66C4"];

function log(message, ...args) {
  console.log(`${LOG_PREFIX} ${message}`, ...args);
}

function warn(message, ...args) {
  console.warn(`${LOG_PREFIX} ${message}`, ...args);
}

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function normalizeHex(value, fallback = null) {
  const text = String(value || "").trim();
  const match = text.match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toUpperCase()}` : fallback;
}

function hexToRgb(hex) {
  const clean = normalizeHex(hex, DEFAULT_ACCENT);
  const intValue = parseInt(clean.slice(1), 16);
  return {
    r: (intValue >> 16) & 255,
    g: (intValue >> 8) & 255,
    b: intValue & 255,
  };
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const linear = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function foregroundFor(hex) {
  return relativeLuminance(hex) > 0.58 ? "#17191D" : "#FFFFFF";
}

function buildAccentPalette(accent, contrastMode) {
  const accentSolid = normalizeHex(accent, DEFAULT_ACCENT);
  return {
    contrastMode,
    accentSolid,
    accentForeground: foregroundFor(accentSolid),
    accentBorder: accentSolid,
    accentTint: hexToRgba(accentSolid, 0.2),
    accentTintStrong: hexToRgba(accentSolid, 0.28),
  };
}

function getAccentPalette(node) {
  const appearance = ensureAppearance(node);
  const accent = normalizeHex(appearance.accent, DEFAULT_ACCENT);
  const contrastMode = Boolean(appearance.contrastMode);
  const cache = node._kooPresetManagerAccentPalette;
  if (!cache || cache.sourceAccent !== accent || cache.sourceContrast !== contrastMode) {
    node._kooPresetManagerAccentPalette = {
      sourceAccent: accent,
      sourceContrast: contrastMode,
      ...buildAccentPalette(accent, contrastMode),
    };
  }
  return node._kooPresetManagerAccentPalette;
}

function activeFill(palette, fallbackAlpha = 0.2) {
  return palette.contrastMode ? palette.accentSolid : hexToRgba(palette.accentSolid, fallbackAlpha);
}

function activeForeground(palette, normalColor) {
  return palette.contrastMode ? palette.accentForeground : normalColor;
}

function themeTokens(appearance) {
  return THEME_TOKENS[appearance.theme] || THEME_TOKENS.Dark;
}

function graphNodes(graph = app.graph) {
  return Array.isArray(graph?._nodes) ? graph._nodes.filter(Boolean) : [];
}

function isManagerNode(node) {
  return (
    node?.type === NODE_NAME ||
    node?.comfyClass === NODE_NAME ||
    node?.constructor?.type === NODE_NAME ||
    node?.title === DISPLAY_NAME ||
    node?.title === LEGACY_DISPLAY_NAME
  );
}

function findLegacyWidget(node, name) {
  return [...(node._kooPresetManagerNativeWidgets || []), ...(node.widgets || [])].find((widget) => widget?.name === name) || null;
}

function markDirty(node) {
  node?.setDirtyCanvas?.(true, true);
  app.graph?.setDirtyCanvas?.(true, true);
  app.canvas?.setDirty?.(true, true);
  app.graph?.change?.();
}

function ensureManagerState(node) {
  node._kooPresetManager = node._kooPresetManager || {
    status: "Ready",
    dropdownOpen: false,
    dropdownScroll: 0,
    hoverKey: "",
  };
  node.properties = node.properties || {};
  if (!node.properties[PRESETS_PROPERTY] || typeof node.properties[PRESETS_PROPERTY] !== "object" || Array.isArray(node.properties[PRESETS_PROPERTY])) {
    node.properties[PRESETS_PROPERTY] = {};
  }
  if (typeof node.properties[DRAFT_NAME_PROPERTY] !== "string") {
    node.properties[DRAFT_NAME_PROPERTY] = "";
  }
  ensureAppearance(node);
  return node._kooPresetManager;
}

function ensureAppearance(node) {
  node.properties = node.properties || {};
  const incoming = node.properties[APPEARANCE_PROPERTY];
  const appearance = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming : {};
  const legacyAccent = normalizeHex(appearance.accentColor);
  const migratedAccent = legacyAccent && legacyAccent !== KOOL_GREEN ? legacyAccent : DEFAULT_ACCENT;
  const next = {
    ...DEFAULT_APPEARANCE,
    theme: THEMES.includes(appearance.theme) ? appearance.theme : DEFAULT_APPEARANCE.theme,
    accent: normalizeHex(appearance.accent, migratedAccent) || DEFAULT_ACCENT,
    appearanceOpen: appearance.appearanceOpen ?? appearance.advancedOpen ?? DEFAULT_APPEARANCE.appearanceOpen,
    contrastMode: appearance.contrastMode ?? appearance.kooContrastMode ?? DEFAULT_APPEARANCE.contrastMode,
  };
  next.appearanceOpen = next.appearanceOpen !== false;
  next.contrastMode = Boolean(next.contrastMode);
  node.properties[APPEARANCE_PROPERTY] = next;
  const tokens = themeTokens(next);
  node.color = tokens.surface;
  node.bgcolor = tokens.background;
  return next;
}

function presetNames(managerNode) {
  ensureManagerState(managerNode);
  return Object.keys(managerNode.properties[PRESETS_PROPERTY]).sort((a, b) => a.localeCompare(b));
}

function selectedPresetName(managerNode) {
  const names = presetNames(managerNode);
  const selected = managerNode.properties[SELECTED_PROPERTY];
  if (selected && names.includes(selected)) {
    return selected;
  }
  return names[0] || "";
}

function selectedPreset(managerNode) {
  const name = selectedPresetName(managerNode);
  return name ? managerNode.properties[PRESETS_PROPERTY][name] : null;
}

function refreshPresetState(managerNode, preferredName = null, dirty = true) {
  ensureManagerState(managerNode);
  const names = presetNames(managerNode);
  const selected = preferredName && names.includes(preferredName) ? preferredName : selectedPresetName(managerNode);
  if (selected) {
    managerNode.properties[SELECTED_PROPERTY] = selected;
  } else {
    delete managerNode.properties[SELECTED_PROPERTY];
  }
  const state = ensureManagerState(managerNode);
  state.dropdownScroll = Math.max(0, Math.min(state.dropdownScroll || 0, Math.max(0, names.length - MAX_DROPDOWN_ROWS)));
  if (dirty) {
    markDirty(managerNode);
  }
}

function selectPreset(managerNode, name) {
  ensureManagerState(managerNode);
  const clean = name && name !== NO_PRESET_LABEL ? String(name) : "";
  if (clean && presetNames(managerNode).includes(clean)) {
    managerNode.properties[SELECTED_PROPERTY] = clean;
    managerNode.properties[DRAFT_NAME_PROPERTY] = clean;
  } else {
    delete managerNode.properties[SELECTED_PROPERTY];
  }
  ensureManagerState(managerNode).dropdownOpen = false;
  refreshPresetState(managerNode, clean);
}

function getPresetNameDraft(managerNode) {
  return String(managerNode.properties?.[DRAFT_NAME_PROPERTY] ?? "").trim();
}

function setStatus(managerNode, message) {
  ensureManagerState(managerNode).status = message;
  markDirty(managerNode);
}

function ensureNodeUid(node) {
  if (!node || isManagerNode(node)) {
    return null;
  }
  node.properties = node.properties || {};
  if (!node.properties[UID_PROPERTY]) {
    node.properties[UID_PROPERTY] = uuid();
    markDirty(node);
  }
  return node.properties[UID_PROPERTY];
}

function repairDuplicateUids(graph = app.graph, force = false) {
  if (!graph) {
    return 0;
  }
  const nodes = graphNodes(graph);
  const now = Date.now();
  if (
    !force &&
    graph._kooPresetLastUidRepairAt &&
    graph._kooPresetLastUidRepairNodeCount === nodes.length &&
    now - graph._kooPresetLastUidRepairAt < 1000
  ) {
    return 0;
  }

  graph._kooPresetLastUidRepairAt = now;
  graph._kooPresetLastUidRepairNodeCount = nodes.length;

  const seen = new Map();
  let repaired = 0;
  for (const node of nodes) {
    const uid = node?.properties?.[UID_PROPERTY];
    if (!uid) {
      continue;
    }
    if (!seen.has(uid)) {
      seen.set(uid, node);
      continue;
    }
    node.properties[UID_PROPERTY] = uuid();
    repaired += 1;
    warn("Duplicate UID detected and repaired.", { original: seen.get(uid)?.id, duplicate: node.id });
  }
  if (repaired) {
    markDirty();
  }
  return repaired;
}

function getSelectedNodes() {
  const selected = app.canvas?.selected_nodes;
  if (!selected) {
    return [];
  }
  return Array.isArray(selected) ? selected.filter(Boolean) : Object.values(selected).filter(Boolean);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isJsonSafe(value, seen = new WeakSet()) {
  if (value === null) {
    return true;
  }
  const type = typeof value;
  if (type === "string" || type === "boolean") {
    return true;
  }
  if (type === "number") {
    return Number.isFinite(value);
  }
  if (type !== "object") {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.every((item) => isJsonSafe(item, seen));
  }
  if (!isPlainObject(value)) {
    return false;
  }
  return Object.entries(value).every(([key, item]) => typeof key === "string" && isJsonSafe(item, seen));
}

function deepClone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function valuesEqual(a, b) {
  return stableJson(a) === stableJson(b);
}

function captureWidget(node, widget, index) {
  if (!widget || widget.type === "button" || widget.serialize === false) {
    return null;
  }
  if (!isJsonSafe(widget.value)) {
    warn(`Unsupported widget skipped: ${node.title || node.type || node.id} / ${widget.name || index}`);
    return null;
  }
  return {
    name: typeof widget.name === "string" ? widget.name : null,
    index,
    type: typeof widget.type === "string" ? widget.type : null,
    value: deepClone(widget.value),
  };
}

function captureNode(node) {
  const uid = ensureNodeUid(node);
  const widgets = (node.widgets || [])
    .map((widget, index) => captureWidget(node, widget, index))
    .filter(Boolean);

  if (!uid || !widgets.length) {
    return null;
  }

  return {
    koo_uid: uid,
    type: node.type || node.comfyClass || node.constructor?.type || "",
    title: node.title || "",
    id_at_capture: node.id,
    widgets,
  };
}

function buildPreset(name, nodes, previousPreset = null) {
  const time = nowIso();
  return {
    version: 1,
    name,
    created_at: previousPreset?.created_at || time,
    updated_at: time,
    nodes,
  };
}

function validatePreset(preset) {
  if (!preset || typeof preset !== "object" || preset.version !== 1 || !Array.isArray(preset.nodes)) {
    return false;
  }
  return preset.nodes.every((node) => node && typeof node.koo_uid === "string" && Array.isArray(node.widgets));
}

function nodeMapByUid(repair = true, forceRepair = false) {
  if (repair) {
    repairDuplicateUids(app.graph, forceRepair);
  }
  const byUid = new Map();
  for (const node of graphNodes()) {
    const uid = node?.properties?.[UID_PROPERTY];
    if (uid) {
      byUid.set(uid, node);
    }
  }
  return byUid;
}

function findSavedWidget(node, savedWidget) {
  const widgets = node.widgets || [];
  if (savedWidget.name) {
    const byName = widgets.find((widget) => widget?.name === savedWidget.name);
    if (byName) {
      return byName;
    }
  }
  return widgets[savedWidget.index] || null;
}

function applyWidget(node, savedWidget) {
  const widget = findSavedWidget(node, savedWidget);
  if (!widget) {
    warn(`Missing widget: ${node.title || node.type || node.id} / ${savedWidget.name || savedWidget.index}`);
    return { changed: false, missing: true };
  }
  if (!isJsonSafe(savedWidget.value)) {
    warn(`Malformed widget value skipped: ${node.title || node.type || node.id} / ${savedWidget.name || savedWidget.index}`);
    return { changed: false, unsupported: true };
  }

  const value = deepClone(savedWidget.value);
  const previous = isJsonSafe(widget.value) ? deepClone(widget.value) : widget.value;
  if (isJsonSafe(widget.value) && valuesEqual(widget.value, value)) {
    return { changed: false, missing: false };
  }

  widget.value = value;
  try {
    widget.callback?.call(widget, value, app.canvas, node, app.canvas?.graph_mouse);
  } catch (error) {
    warn(`Widget callback failed: ${node.title || node.type || node.id} / ${savedWidget.name || savedWidget.index}`, error);
  }
  try {
    node.onWidgetChanged?.(widget.name, value, previous, widget);
  } catch (error) {
    warn(`Node onWidgetChanged failed: ${node.title || node.type || node.id} / ${savedWidget.name || savedWidget.index}`, error);
  }
  node.setDirtyCanvas?.(true, true);
  return { changed: true, missing: false };
}

function comparisonLabel(managerNode) {
  const preset = selectedPreset(managerNode);
  if (!validatePreset(preset)) {
    return "No preset selected";
  }

  const nodesByUid = nodeMapByUid(false);
  let missingNodes = 0;
  let missingWidgets = 0;
  let diffValues = 0;

  for (const savedNode of preset.nodes) {
    const node = nodesByUid.get(savedNode.koo_uid);
    if (!node) {
      missingNodes += 1;
      continue;
    }
    for (const savedWidget of savedNode.widgets) {
      const widget = findSavedWidget(node, savedWidget);
      if (!widget) {
        missingWidgets += 1;
        continue;
      }
      if (!isJsonSafe(widget.value) || !valuesEqual(widget.value, savedWidget.value)) {
        diffValues += 1;
      }
    }
  }

  const parts = [];
  if (diffValues) {
    parts.push(`${diffValues} values differ`);
  }
  if (missingNodes) {
    parts.push(`${missingNodes} node${missingNodes === 1 ? "" : "s"} missing`);
  }
  if (missingWidgets) {
    parts.push(`${missingWidgets} widget${missingWidgets === 1 ? "" : "s"} missing`);
  }
  return parts.length ? parts.join(" | ") : "MATCH";
}

function captureSelection(managerNode) {
  repairDuplicateUids(app.graph, true);
  const name = getPresetNameDraft(managerNode);
  managerNode.properties[DRAFT_NAME_PROPERTY] = name;

  if (!name) {
    setStatus(managerNode, "Enter a preset name");
    return null;
  }
  if (managerNode.properties[PRESETS_PROPERTY][name]) {
    setStatus(managerNode, "Already exists - use Update");
    warn(`Preset "${name}" already exists. Use Update Preset.`);
    return null;
  }

  const nodes = getSelectedNodes()
    .filter((node) => node && node !== managerNode && !isManagerNode(node))
    .map(captureNode)
    .filter(Boolean);

  if (!nodes.length) {
    setStatus(managerNode, "No nodes selected");
    return null;
  }

  const preset = buildPreset(name, nodes);
  managerNode.properties[PRESETS_PROPERTY][name] = preset;
  managerNode.properties[SELECTED_PROPERTY] = name;
  refreshPresetState(managerNode, name);
  const valueCount = nodes.reduce((total, node) => total + node.widgets.length, 0);
  setStatus(managerNode, `Saved ${nodes.length} node${nodes.length === 1 ? "" : "s"} / ${valueCount} value${valueCount === 1 ? "" : "s"}`);
  log(`Captured preset "${name}": ${nodes.length} nodes, ${valueCount} values`);
  return preset;
}

function applyPreset(managerNode) {
  const name = selectedPresetName(managerNode);
  const preset = selectedPreset(managerNode);
  if (!validatePreset(preset)) {
    setStatus(managerNode, "No preset selected");
    warn(`Malformed preset detected: ${name || "(none)"}`);
    return null;
  }

  const nodesByUid = nodeMapByUid(true, true);
  let appliedNodes = 0;
  let missingNodes = 0;
  let changedValues = 0;
  let missingWidgets = 0;

  for (const savedNode of preset.nodes) {
    const node = nodesByUid.get(savedNode.koo_uid);
    if (!node) {
      missingNodes += 1;
      warn(`Missing target node: ${savedNode.koo_uid}`);
      continue;
    }
    appliedNodes += 1;
    for (const savedWidget of savedNode.widgets) {
      const result = applyWidget(node, savedWidget);
      if (result.missing) {
        missingWidgets += 1;
      }
      if (result.changed) {
        changedValues += 1;
      }
    }
  }

  markDirty(managerNode);
  const parts = [`Applied ${changedValues} value${changedValues === 1 ? "" : "s"}`, `${appliedNodes}/${preset.nodes.length} nodes`];
  if (missingNodes) {
    parts.push(`${missingNodes} missing`);
  }
  if (missingWidgets) {
    parts.push(`${missingWidgets} widgets missing`);
  }
  setStatus(managerNode, parts.join(" | "));
  log(`Applied preset "${name}": ${changedValues} values changed`);
  return { appliedNodes, missingNodes, changedValues, missingWidgets };
}

function updatePreset(managerNode) {
  const name = selectedPresetName(managerNode);
  const preset = selectedPreset(managerNode);
  if (!validatePreset(preset)) {
    setStatus(managerNode, "No preset selected");
    return null;
  }

  const nodesByUid = nodeMapByUid(true, true);
  let missingNodes = 0;
  const refreshed = preset.nodes.map((savedNode) => {
    const node = nodesByUid.get(savedNode.koo_uid);
    if (!node) {
      missingNodes += 1;
      warn(`Missing target node while updating: ${savedNode.koo_uid}`);
      return savedNode;
    }
    return captureNode(node) || savedNode;
  });

  const nextPreset = buildPreset(name, refreshed, preset);
  managerNode.properties[PRESETS_PROPERTY][name] = nextPreset;
  refreshPresetState(managerNode, name);
  const valueCount = refreshed.reduce((total, node) => total + node.widgets.length, 0);
  setStatus(managerNode, `Updated ${refreshed.length - missingNodes} node${refreshed.length - missingNodes === 1 ? "" : "s"} / ${valueCount} values${missingNodes ? ` | ${missingNodes} missing` : ""}`);
  log(`Updated preset "${name}": ${refreshed.length - missingNodes} nodes, ${valueCount} values`);
  return nextPreset;
}

function deletePreset(managerNode, presetName = null) {
  const name = presetName || selectedPresetName(managerNode);
  if (!name || !managerNode.properties[PRESETS_PROPERTY][name]) {
    setStatus(managerNode, "No preset selected");
    return false;
  }

  const wasSelected = selectedPresetName(managerNode) === name;
  delete managerNode.properties[PRESETS_PROPERTY][name];
  if (wasSelected) {
    const next = presetNames(managerNode)[0] || "";
    if (next) {
      managerNode.properties[SELECTED_PROPERTY] = next;
    } else {
      delete managerNode.properties[SELECTED_PROPERTY];
    }
  }
  ensureManagerState(managerNode).dropdownOpen = false;
  refreshPresetState(managerNode, selectedPresetName(managerNode));
  setStatus(managerNode, `Deleted "${name}"`);
  log(`Deleted preset "${name}"`);
  return true;
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawRound(ctx, box, fill, stroke, lineWidth = 1, radius = 7) {
  roundedRect(ctx, box.x, box.y, box.w, box.h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function drawText(ctx, text, x, y, size, color, weight = "500", align = "left") {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${FONT_STACK}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function ellipsize(ctx, text, maxWidth) {
  const value = String(text ?? "");
  if (ctx.measureText(value).width <= maxWidth) {
    return value;
  }
  let out = value;
  while (out.length > 3 && ctx.measureText(`${out.slice(0, -1)}...`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

function hoverKey(state, kind, value = "") {
  return state.hoverKey === `${kind}:${value ?? ""}`;
}

function makeLayout(node) {
  const state = ensureManagerState(node);
  const width = Math.max(DEFAULT_WIDTH, node.size?.[0] || DEFAULT_WIDTH);
  const appearance = ensureAppearance(node);
  const compact = width < 460;
  const x = compact ? 14 : 18;
  const right = width - x;
  const gap = compact ? 8 : 12;
  const sectionGap = compact ? 9 : 12;
  const innerPad = compact ? 12 : 14;
  let y = compact ? 14 : 18;
  const hitboxes = [];
  const addHit = (kind, box, value = null) => hitboxes.push({ kind, value, ...box });

  const header = { x, y, w: right - x, h: 42 };
  y += header.h + sectionGap;

  const namePanel = { x, y, w: right - x, h: compact ? 70 : 74 };
  const nameField = { x: namePanel.x + innerPad, y: namePanel.y + 32, w: namePanel.w - innerPad * 2, h: compact ? 30 : 34 };
  addHit("name", nameField);
  y += namePanel.h + sectionGap;

  const selectorPanel = { x, y, w: right - x, h: compact ? 70 : 74 };
  const selector = { x: selectorPanel.x + innerPad, y: selectorPanel.y + 32, w: selectorPanel.w - innerPad * 2, h: compact ? 30 : 34 };
  addHit("selector", selector);
  y += selectorPanel.h + sectionGap;

  const names = presetNames(node);
  const dropdownRows = state.dropdownOpen && names.length ? Math.min(MAX_DROPDOWN_ROWS, names.length) : 0;
  const rowH = compact ? 29 : 31;
  const dropdown = dropdownRows ? { x: selector.x, y: selector.y + selector.h + 4, w: selector.w, h: dropdownRows * rowH + 8 } : null;
  const rows = [];
  if (dropdown) {
    const maxScroll = Math.max(0, names.length - MAX_DROPDOWN_ROWS);
    state.dropdownScroll = Math.max(0, Math.min(state.dropdownScroll || 0, maxScroll));
    names.slice(state.dropdownScroll, state.dropdownScroll + dropdownRows).forEach((name, index) => {
      const row = { x: dropdown.x + 6, y: dropdown.y + 4 + index * rowH, w: dropdown.w - 12, h: rowH - 2 };
      const remove = { x: row.x + row.w - 29, y: row.y + 4, w: 22, h: 22 };
      rows.push({ name, row, remove });
      addHit("selectPreset", row, name);
      addHit("deletePreset", remove, name);
    });
    y += dropdown.h + gap;
  }

  const capture = { x, y, w: right - x, h: compact ? 32 : 34 };
  addHit("capture", capture);
  y += capture.h + gap;

  const halfW = (right - x - gap) / 2;
  const apply = { x, y, w: halfW, h: compact ? 32 : 34 };
  const update = { x: x + halfW + gap, y, w: halfW, h: 38 };
  update.h = apply.h;
  addHit("apply", apply);
  addHit("update", update);
  y += apply.h + sectionGap;

  const status = { x, y, w: right - x, h: 24 };
  y += status.h + sectionGap;

  const divider = { x, y: y - 2, w: right - x, h: 1 };
  y += sectionGap;

  const appearancePad = compact ? 12 : 14;
  const appearanceLabelW = compact ? 54 : 64;
  const swatchSize = compact ? 17 : 20;
  const swatchGap = compact ? 8 : 10;
  const swatchAreaW = Math.max(160, right - x - appearancePad * 2 - appearanceLabelW);
  const swatchCols = Math.min(SWATCHES.length, Math.max(4, Math.floor((swatchAreaW + swatchGap) / (swatchSize + swatchGap))));
  const swatchRows = Math.ceil(SWATCHES.length / swatchCols);
  const swatchXRel = appearancePad + appearanceLabelW;
  const swatchRightRel = swatchXRel + (swatchCols - 1) * (swatchSize + swatchGap) + swatchSize;
  const actionW = (compact ? 48 : 56) + 12 + (compact ? 76 : 88);
  const actionsInline = swatchRightRel + 12 + actionW <= right - x - appearancePad;
  const actionYRel = actionsInline ? 75 : 76 + swatchRows * (swatchSize + 8) - 1;
  const appearanceHeight = appearance.appearanceOpen ? actionYRel + 18 + appearancePad : 44;
  const appearanceBox = { x, y, w: right - x, h: appearanceHeight };
  y += appearanceBox.h;
  const appearanceToggle = { x: appearanceBox.x + appearanceBox.w - 38, y: appearanceBox.y + 10, w: 28, h: 28 };
  addHit("appearanceToggle", appearanceToggle);
  const themeButtons = [];
  let contrastToggle = null;
  const swatches = [];
  let customAccent = null;
  let resetAccent = null;
  if (appearance.appearanceOpen) {
    const themeY = appearanceBox.y + 42;
    const themeX = appearanceBox.x + appearancePad + appearanceLabelW;
    const themeButtonGap = 6;
    const contrastW = compact ? 84 : 96;
    const themeRowW = appearanceBox.w - appearancePad * 2 - appearanceLabelW;
    const themeButtonW = Math.min(64, (themeRowW - contrastW - 12 - themeButtonGap * 2) / 3);
    THEMES.forEach((name, index) => {
      const box = { x: themeX + index * (themeButtonW + themeButtonGap), y: themeY, w: themeButtonW, h: 28 };
      themeButtons.push({ name, ...box });
      addHit("theme", box, name);
    });
    contrastToggle = { x: themeX + 3 * (themeButtonW + themeButtonGap) + 6, y: themeY, w: contrastW, h: 28 };
    addHit("contrast", contrastToggle);
    const swatchX = appearanceBox.x + appearancePad + appearanceLabelW;
    const swatchY = appearanceBox.y + 76;
    SWATCHES.forEach((color, index) => {
      const col = index % swatchCols;
      const row = Math.floor(index / swatchCols);
      const box = { x: swatchX + col * (swatchSize + swatchGap), y: swatchY + row * (swatchSize + 8), w: swatchSize, h: swatchSize };
      swatches.push({ color, ...box });
      addHit("accent", box, color);
    });
    const actionY = appearanceBox.y + actionYRel;
    const actionX = actionsInline ? swatchX + (swatchCols - 1) * (swatchSize + swatchGap) + swatchSize + 12 : swatchX;
    customAccent = { x: actionX, y: actionY, w: compact ? 48 : 56, h: 18 };
    resetAccent = { x: customAccent.x + customAccent.w + 12, y: actionY, w: compact ? 76 : 88, h: 18 };
    addHit("customAccent", customAccent);
    addHit("resetAccent", resetAccent);
  }

  const desiredHeight = Math.max(330, y + (compact ? 14 : 18));
  return {
    width,
    desiredHeight,
    hitboxes,
    compact,
    header,
    namePanel,
    nameField,
    selectorPanel,
    selector,
    dropdown,
    rows,
    capture,
    apply,
    update,
    status,
    divider,
    appearanceBox,
    appearanceToggle,
    themeButtons,
    contrastToggle,
    swatches,
    customAccent,
    resetAccent,
  };
}

function drawPaletteIcon(ctx, x, y, color, tokens) {
  ctx.fillStyle = hexToRgba(color, 0.16);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x + 9, y + 9, 9, 0.22 * Math.PI, 1.95 * Math.PI);
  ctx.quadraticCurveTo(x + 17, y + 18, x + 10, y + 18);
  ctx.quadraticCurveTo(x + 2, y + 18, x, y + 10);
  ctx.quadraticCurveTo(x, y + 2, x + 9, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (const dot of [[6, 7], [11, 5], [14, 10]]) {
    ctx.beginPath();
    ctx.arc(x + dot[0], y + dot[1], 1.7, 0, Math.PI * 2);
    ctx.fillStyle = tokens.textSecondary;
    ctx.fill();
  }
}

function drawKoOButton(ctx, box, label, { tokens, palette, hover = false, active = false, primary = false, disabled = false }) {
  const fill = active || primary ? activeFill(palette, primary ? 0.22 : 0.18) : tokens.surfaceRaised;
  const stroke = active || primary ? palette.accentBorder : tokens.border;
  const text = disabled ? tokens.textMuted : active || primary ? activeForeground(palette, tokens.text) : tokens.textSecondary;
  const hoverFill = active || primary ? activeFill(palette, primary ? 0.28 : 0.24) : tokens.surfaceHover;
  drawRound(ctx, box, hover && !disabled ? hoverFill : fill, hover && !disabled && !(active || primary) ? tokens.borderStrong : stroke, active || primary ? 2 : 1, 5);
  drawText(ctx, label, box.x + box.w / 2, box.y + box.h / 2 + 1, 13, text, active || primary ? "850" : "650", "center");
}

function drawUI(node, ctx) {
  const state = ensureManagerState(node);
  const appearance = ensureAppearance(node);
  const tokens = themeTokens(appearance);
  const palette = getAccentPalette(node);
  const layout = makeLayout(node);
  node._kooPresetManager.hitboxes = layout.hitboxes;
  node._kooPresetManager.dropdownBox = layout.dropdown;

  if (!node.size || Math.abs(node.size[1] - layout.desiredHeight) > 2) {
    node.size = [layout.width, layout.desiredHeight];
  }

  const accent = appearance.accent;
  const selected = selectedPresetName(node);
  const names = presetNames(node);
  const draft = node.properties[DRAFT_NAME_PROPERTY] || "";

  drawRound(ctx, { x: 8, y: 8, w: layout.width - 16, h: layout.desiredHeight - 16 }, tokens.background, tokens.borderStrong, 1.5, 12);
  drawText(ctx, DISPLAY_NAME, layout.header.x + 2, layout.header.y + 15, 16, tokens.text, "900");
  drawText(ctx, `${names.length} preset${names.length === 1 ? "" : "s"} embedded in workflow`, layout.header.x + 2, layout.header.y + 36, 12, tokens.textMuted, "550");

  drawRound(ctx, layout.namePanel, tokens.surface, tokens.border, 1, 7);
  drawText(ctx, "PRESET NAME", layout.namePanel.x + 14, layout.namePanel.y + 18, 13, tokens.textMuted, "800");
  drawRound(ctx, layout.nameField, hoverKey(state, "name") ? tokens.surfaceHover : tokens.background, hoverKey(state, "name") ? tokens.borderStrong : tokens.border, 1, 5);
  drawText(ctx, draft ? ellipsize(ctx, draft, layout.nameField.w - 24) : "Click to name preset", layout.nameField.x + 12, layout.nameField.y + layout.nameField.h / 2 + 1, 14, draft ? tokens.text : tokens.textMuted, draft ? "700" : "650");

  drawRound(ctx, layout.selectorPanel, tokens.surface, tokens.border, 1, 7);
  drawText(ctx, "SELECTED PRESET", layout.selectorPanel.x + 14, layout.selectorPanel.y + 18, 13, tokens.textMuted, "800");
  drawRound(ctx, layout.selector, state.dropdownOpen ? activeFill(palette, 0.14) : hoverKey(state, "selector") ? tokens.surfaceHover : tokens.background, state.dropdownOpen ? palette.accentBorder : tokens.border, state.dropdownOpen ? 2 : 1, 5);
  drawText(ctx, selected ? ellipsize(ctx, selected, layout.selector.w - 52) : NO_PRESET_LABEL, layout.selector.x + 12, layout.selector.y + layout.selector.h / 2 + 1, 14, selected ? tokens.text : tokens.textMuted, "700");
  drawText(ctx, state.dropdownOpen ? "^" : "v", layout.selector.x + layout.selector.w - 20, layout.selector.y + layout.selector.h / 2, 14, palette.accentSolid, "900", "center");

  if (layout.dropdown) {
    drawRound(ctx, layout.dropdown, tokens.surfaceRaised, tokens.border, 1, 7);
    for (const item of layout.rows) {
      const rowHover = hoverKey(state, "selectPreset", item.name);
      const deleteHover = hoverKey(state, "deletePreset", item.name);
      const isSelected = item.name === selected;
      drawRound(ctx, item.row, isSelected ? activeFill(palette, 0.2) : rowHover ? tokens.surfaceHover : tokens.surfaceRaised, isSelected ? palette.accentBorder : "transparent", isSelected ? 1 : 0, 5);
      drawText(ctx, ellipsize(ctx, item.name, item.row.w - 46), item.row.x + 9, item.row.y + item.row.h / 2 + 1, 13, isSelected ? activeForeground(palette, tokens.text) : tokens.textSecondary, isSelected ? "800" : "650");
      drawRound(ctx, item.remove, deleteHover ? hexToRgba("#FF3048", 0.22) : "transparent", deleteHover ? "#FF3048" : "transparent", 1, 5);
      drawText(ctx, "x", item.remove.x + item.remove.w / 2, item.remove.y + item.remove.h / 2, 14, deleteHover ? "#FFFFFF" : tokens.textMuted, "900", "center");
    }
    if (names.length > MAX_DROPDOWN_ROWS) {
      drawText(ctx, `${state.dropdownScroll + 1}-${Math.min(names.length, state.dropdownScroll + MAX_DROPDOWN_ROWS)} / ${names.length}`, layout.dropdown.x + layout.dropdown.w - 12, layout.dropdown.y + layout.dropdown.h - 8, 10, tokens.textMuted, "650", "right");
    }
  }

  drawKoOButton(ctx, layout.capture, "Capture Selected", { tokens, palette, hover: hoverKey(state, "capture"), primary: true });
  drawKoOButton(ctx, layout.apply, "Apply Preset", { tokens, palette, hover: hoverKey(state, "apply"), active: Boolean(selected) });
  drawKoOButton(ctx, layout.update, "Update Preset", { tokens, palette, hover: hoverKey(state, "update"), disabled: !selected });

  drawText(ctx, "STATUS", layout.status.x + 2, layout.status.y + layout.status.h / 2 + 1, 12, tokens.textMuted, "850");
  drawText(ctx, ellipsize(ctx, state.status || comparisonLabel(node), layout.status.w - 88), layout.status.x + layout.status.w - 2, layout.status.y + layout.status.h / 2 + 1, 12, state.status === "Ready" ? tokens.textMuted : tokens.textSecondary, "650", "right");
  ctx.strokeStyle = tokens.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(layout.divider.x, layout.divider.y);
  ctx.lineTo(layout.divider.x + layout.divider.w, layout.divider.y);
  ctx.stroke();

  drawRound(ctx, layout.appearanceBox, tokens.surface, tokens.border, 1, 7);
  drawPaletteIcon(ctx, layout.appearanceBox.x + 14, layout.appearanceBox.y + 13, accent, tokens);
  drawText(ctx, "APPEARANCE", layout.appearanceBox.x + 42, layout.appearanceBox.y + 22, 13, tokens.textMuted, "850");
  drawText(ctx, appearance.appearanceOpen ? "^" : "v", layout.appearanceToggle.x + layout.appearanceToggle.w / 2, layout.appearanceToggle.y + layout.appearanceToggle.h / 2, 15, tokens.textSecondary, "900", "center");
  if (appearance.appearanceOpen) {
    drawText(ctx, "THEME", layout.appearanceBox.x + (layout.compact ? 12 : 14), layout.appearanceBox.y + 56, 12, tokens.textMuted, "850");
    for (const button of layout.themeButtons) {
      const active = appearance.theme === button.name;
      drawRound(ctx, button, active ? activeFill(palette, 0.16) : tokens.surfaceRaised, active ? palette.accentBorder : tokens.border, active ? 2 : 1, 5);
      drawText(ctx, button.name, button.x + button.w / 2, button.y + button.h / 2 + 1, layout.compact ? 12 : 13, active ? activeForeground(palette, tokens.text) : tokens.textSecondary, active ? "850" : "650", "center");
    }
    const contrastActive = Boolean(appearance.contrastMode);
    drawRound(ctx, layout.contrastToggle, contrastActive ? activeFill(palette, 0.18) : tokens.surfaceRaised, contrastActive ? palette.accentBorder : tokens.border, contrastActive ? 2 : 1, 5);
    const knobSize = layout.compact ? 10 : 11;
    const knobX = layout.contrastToggle.x + layout.contrastToggle.w - 16;
    const knobY = layout.contrastToggle.y + layout.contrastToggle.h / 2;
    drawText(ctx, "Contrast", layout.contrastToggle.x + 8, layout.contrastToggle.y + layout.contrastToggle.h / 2 + 1, layout.compact ? 10 : 11, contrastActive ? activeForeground(palette, tokens.text) : tokens.textSecondary, "750");
    ctx.beginPath();
    ctx.arc(knobX, knobY, knobSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = contrastActive ? activeForeground(palette, tokens.text) : tokens.textMuted;
    ctx.fill();
    drawText(ctx, "ACCENT", layout.appearanceBox.x + (layout.compact ? 12 : 14), layout.appearanceBox.y + 85, 12, tokens.textMuted, "850");
    for (const swatch of layout.swatches) {
      const cx = swatch.x + swatch.w / 2;
      const cy = swatch.y + swatch.h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, swatch.w / 2, 0, Math.PI * 2);
      ctx.fillStyle = swatch.color;
      ctx.fill();
      if (normalizeHex(swatch.color) === normalizeHex(accent)) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = palette.contrastMode ? palette.accentForeground : tokens.text;
        ctx.stroke();
      }
    }
    drawText(ctx, "Hex", layout.customAccent.x, layout.customAccent.y + 9, 11, tokens.textMuted, "750");
    drawText(ctx, "Reset Accent", layout.resetAccent.x, layout.resetAccent.y + 9, 11, tokens.textMuted, "750");
  }
}

function hitboxAt(node, pos) {
  const hitboxes = node._kooPresetManager?.hitboxes || makeLayout(node).hitboxes;
  for (let index = hitboxes.length - 1; index >= 0; index -= 1) {
    const box = hitboxes[index];
    if (pos[0] >= box.x && pos[0] <= box.x + box.w && pos[1] >= box.y && pos[1] <= box.y + box.h) {
      return box;
    }
  }
  return null;
}

function setDraftName(node) {
  const current = node.properties[DRAFT_NAME_PROPERTY] || "";
  const answer = prompt("Preset name", current);
  if (answer === null) {
    return;
  }
  node.properties[DRAFT_NAME_PROPERTY] = String(answer).trim();
  markDirty(node);
}

function promptAccent(node) {
  const appearance = ensureAppearance(node);
  const answer = prompt("Accent hex color", appearance.accent || DEFAULT_ACCENT);
  const color = normalizeHex(answer);
  if (!color) {
    setStatus(node, "Invalid hex color");
    return;
  }
  appearance.accent = color;
  node.properties[APPEARANCE_PROPERTY] = appearance;
  node._kooPresetManagerAccentPalette = null;
  markDirty(node);
}

function handleClick(node, pos) {
  const state = ensureManagerState(node);
  const hit = hitboxAt(node, pos);
  if (!hit) {
    state.dropdownOpen = false;
    markDirty(node);
    return false;
  }

  switch (hit.kind) {
    case "name":
      state.dropdownOpen = false;
      setDraftName(node);
      return true;
    case "selector":
      state.dropdownOpen = !state.dropdownOpen;
      markDirty(node);
      return true;
    case "selectPreset":
      selectPreset(node, hit.value);
      setStatus(node, comparisonLabel(node));
      return true;
    case "deletePreset":
      deletePreset(node, hit.value);
      return true;
    case "capture":
      state.dropdownOpen = false;
      captureSelection(node);
      return true;
    case "apply":
      state.dropdownOpen = false;
      applyPreset(node);
      return true;
    case "update":
      state.dropdownOpen = false;
      updatePreset(node);
      return true;
    case "appearanceToggle": {
      const appearance = ensureAppearance(node);
      appearance.appearanceOpen = !appearance.appearanceOpen;
      node.properties[APPEARANCE_PROPERTY] = appearance;
      state.dropdownOpen = false;
      markDirty(node);
      return true;
    }
    case "theme": {
      const appearance = ensureAppearance(node);
      appearance.theme = hit.value;
      node.properties[APPEARANCE_PROPERTY] = appearance;
      state.dropdownOpen = false;
      markDirty(node);
      return true;
    }
    case "contrast": {
      const appearance = ensureAppearance(node);
      appearance.contrastMode = !appearance.contrastMode;
      node.properties[APPEARANCE_PROPERTY] = appearance;
      node._kooPresetManagerAccentPalette = null;
      state.dropdownOpen = false;
      markDirty(node);
      return true;
    }
    case "customAccent":
      promptAccent(node);
      return true;
    case "accent": {
      const appearance = ensureAppearance(node);
      appearance.accent = hit.value;
      node.properties[APPEARANCE_PROPERTY] = appearance;
      node._kooPresetManagerAccentPalette = null;
      markDirty(node);
      return true;
    }
    case "resetAccent": {
      const appearance = ensureAppearance(node);
      appearance.accent = DEFAULT_ACCENT;
      node.properties[APPEARANCE_PROPERTY] = appearance;
      node._kooPresetManagerAccentPalette = null;
      markDirty(node);
      return true;
    }
    default:
      state.dropdownOpen = false;
      markDirty(node);
      return false;
  }
}

function handleMove(node, pos) {
  const state = ensureManagerState(node);
  const hit = hitboxAt(node, pos);
  const key = hit ? `${hit.kind}:${hit.value ?? ""}` : "";
  if (state.hoverKey !== key) {
    state.hoverKey = key;
    markDirty(node);
  }
  return Boolean(hit);
}

function handleWheel(node, event, pos) {
  const state = ensureManagerState(node);
  const dropdown = state.dropdownBox;
  const names = presetNames(node);
  if (!state.dropdownOpen || !dropdown || names.length <= MAX_DROPDOWN_ROWS) {
    return false;
  }
  const inside = pos[0] >= dropdown.x && pos[0] <= dropdown.x + dropdown.w && pos[1] >= dropdown.y && pos[1] <= dropdown.y + dropdown.h;
  if (!inside) {
    return false;
  }
  const direction = (event?.deltaY || event?.wheelDelta || 0) > 0 ? 1 : -1;
  state.dropdownScroll = Math.max(0, Math.min(state.dropdownScroll + direction, names.length - MAX_DROPDOWN_ROWS));
  event?.preventDefault?.();
  markDirty(node);
  return true;
}

function graphPointFromPointer(event) {
  const canvas = app.canvas?.canvas;
  const ds = app.canvas?.ds || {};
  if (!canvas || event.target !== canvas) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  const offset = ds.offset || ds.state?.offset || [0, 0];
  const scale = ds.scale || ds.state?.scale || 1;
  return [
    (event.clientX - rect.left) / scale - offset[0],
    (event.clientY - rect.top) / scale - offset[1],
  ];
}

function installOutsideDropdownCloser() {
  if (globalThis.__kooPresetManagerOutsideDropdownCloser) {
    return;
  }
  const closeDropdowns = (event) => {
    queueMicrotask(() => {
      const graphPoint = graphPointFromPointer(event);
      let changed = false;
      for (const node of graphNodes()) {
        if (!isManagerNode(node) || !node._kooPresetManager?.dropdownOpen) {
          continue;
        }
        const insideNode =
          graphPoint &&
          graphPoint[0] >= node.pos[0] &&
          graphPoint[0] <= node.pos[0] + (node.size?.[0] || DEFAULT_WIDTH) &&
          graphPoint[1] >= node.pos[1] &&
          graphPoint[1] <= node.pos[1] + (node.size?.[1] || 0);
        if (!insideNode) {
          node._kooPresetManager.dropdownOpen = false;
          changed = true;
        }
      }
      if (changed) {
        markDirty();
      }
    });
  };
  globalThis.__kooPresetManagerOutsideDropdownCloser = closeDropdowns;
  window.addEventListener("pointerdown", closeDropdowns, false);
}

function migrateLegacyWidgets(node) {
  const current = node.widgets || [];
  const legacy = [...(node._kooPresetManagerNativeWidgets || []), ...current].filter((widget) => widget?.name && LEGACY_WIDGET_NAMES.includes(widget.name));
  if (legacy.length) {
    node._kooPresetManagerNativeWidgets = legacy;
  }

  const nameWidget = findLegacyWidget(node, "Preset Name");
  if (!node.properties?.[DRAFT_NAME_PROPERTY] && typeof nameWidget?.value === "string") {
    node.properties[DRAFT_NAME_PROPERTY] = nameWidget.value;
  }
  const selectedWidget = findLegacyWidget(node, "Selected Preset");
  if (!node.properties?.[SELECTED_PROPERTY] && typeof selectedWidget?.value === "string" && selectedWidget.value !== NO_PRESET_LABEL) {
    node.properties[SELECTED_PROPERTY] = selectedWidget.value;
  }

  for (const widget of legacy) {
    widget.hidden = true;
    widget.type = "hidden";
    widget.serialize = widget.serialize === false ? false : widget.serialize;
    widget.draw = () => {};
    widget.computeSize = () => [0, 0];
  }

  node.widgets = current.filter((widget) => !LEGACY_WIDGET_NAMES.includes(widget?.name));
  node.serialize_widgets = false;
}

function prepareNode(node, info = null) {
  installOutsideDropdownCloser();
  ensureManagerState(node);
  if (info?.properties) {
    node.properties = { ...(node.properties || {}), ...info.properties };
  }
  migrateLegacyWidgets(node);
  refreshPresetState(node, null, false);
  node.resizable = true;
  node.size = node.size || [DEFAULT_WIDTH, 330];
  node.size[0] = Math.max(DEFAULT_WIDTH, node.size[0]);
  ensureAppearance(node);
}

app.registerExtension({
  name: EXTENSION_NAME,
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME && nodeData?.display_name !== DISPLAY_NAME && nodeData?.display_name !== LEGACY_DISPLAY_NAME) {
      return;
    }
    if (nodeType.prototype._kooWorkflowPresetManagerInstalled) {
      return;
    }
    nodeType.prototype._kooWorkflowPresetManagerInstalled = true;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      prepareNode(this);
      repairDuplicateUids(app.graph, true);
      return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const result = onConfigure?.apply(this, arguments);
      prepareNode(this, info);
      repairDuplicateUids(app.graph, true);
      return result;
    };

    const serialize = nodeType.prototype.serialize;
    nodeType.prototype.serialize = function () {
      const data = serialize?.apply(this, arguments) || {};
      ensureManagerState(this);
      data.properties = { ...(data.properties || {}), ...(this.properties || {}) };
      delete data.widgets_values;
      return data;
    };

    nodeType.prototype.onDrawForeground = function (ctx) {
      prepareNode(this);
      drawUI(this, ctx);
    };

    const onMouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (event, pos, canvas) {
      if (handleClick(this, pos)) {
        return true;
      }
      return onMouseDown?.apply(this, arguments);
    };

    const onMouseMove = nodeType.prototype.onMouseMove;
    nodeType.prototype.onMouseMove = function (event, pos, canvas) {
      if (handleMove(this, pos)) {
        return true;
      }
      return onMouseMove?.apply(this, arguments);
    };

    const onMouseWheel = nodeType.prototype.onMouseWheel;
    nodeType.prototype.onMouseWheel = function (event, pos, canvas) {
      if (handleWheel(this, event, pos)) {
        return true;
      }
      return onMouseWheel?.apply(this, arguments);
    };

    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      const result = onResize?.apply(this, arguments);
      markDirty(this);
      return result;
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      if (this._kooPresetManager) {
        this._kooPresetManager.dropdownOpen = false;
      }
      return onRemoved?.apply(this, arguments);
    };
  },
});
