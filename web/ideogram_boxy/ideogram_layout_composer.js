import { app } from "../../../scripts/app.js";
import { ASPECTS, PRESETS, clonePreset, createDefaultState } from "./presets.js";

const TYPES = ["object", "text", "background", "logo", "product", "foreground", "atmosphere"];
const COLORS = ["#39ff88", "#4285f4", "#fbbc04", "#a855f7", "#ff6d00", "#ec4899", "#64748b"];
const MIN_BOX = 0.025;
const KOO_THEME = {
  nodeBackground: "#080c0a",
  panel: "#111713",
  button: "#151a17",
  buttonHover: "#202820",
  border: "#234b31",
  borderHover: "#2f6b42",
  borderSoft: "#17351f",
  text: "#e8f5e7",
  muted: "#91a894",
  green: "#39ff88",
  activeFill: "#133b22",
};
const KOO_PRIMARY = KOO_THEME.green;
const KOO_SECONDARY = KOO_THEME.green;
const WIDE_BREAKPOINT = 720;
let stylesInstalled = false;

function installStyles() {
  if (stylesInstalled) return;
  stylesInstalled = true;
  const style = document.createElement("style");
  style.textContent = `
    .ilc-root, .ilc-root * { box-sizing: border-box; }
    .ilc-root {
      --koo-primary: #39ff88; --koo-secondary: #39ff88; --koo-hover: #67ffa2; --koo-accent: #39ff88;
      width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden;
      display: flex; flex-direction: column; gap: 7px;
      color: #e8f5e7; background: #080c0a; border: 0;
      border-radius: 0; font: 12px/1.4 Inter, ui-sans-serif, system-ui, sans-serif;
      padding: 0; user-select: none; scrollbar-width: thin; scrollbar-color: #48504c transparent;
    }
    .ilc-root input, .ilc-root textarea, .ilc-root select { user-select: text; }
    .ilc-brand {
      display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 3px 2px 1px;
    }
    .ilc-brand-title { font-size: 14px; font-weight: 750; letter-spacing: -.015em; color: #e8f5e7; }
    .ilc-brand-subtitle { color: #91a894; font-size: 9px; }
    .ilc-brand-mark {
      width: 8px; height: 8px; border-radius: 50%; background: var(--koo-secondary); flex: 0 0 auto;
    }
    .ilc-presetbar, .ilc-topbar, .ilc-toolbar, .ilc-overlaybar {
      display: flex; flex-wrap: wrap; gap: 5px; align-items: end; min-width: 0;
    }
    .ilc-presetbar { padding: 0; background: transparent; border: 0; border-radius: 0; }
    .ilc-preset-label { flex: 0 0 100%; color: #91a894; font-size: 9px; font-weight: 700; letter-spacing: .055em; text-transform: uppercase; }
    .ilc-field { display: grid; gap: 3px; min-width: 0; }
    .ilc-field.grow { flex: 1 1 180px; }
    .ilc-field > span, .ilc-section-title { color: #91a894; font-size: 9px; font-weight: 700; letter-spacing: .045em; text-transform: uppercase; }
    .ilc-root input, .ilc-root textarea, .ilc-root select, .ilc-root button {
      border: 1px solid #234b31; border-radius: 7px; background: #151a17; color: #e8f5e7;
      min-height: 29px; max-width: 100%; padding: 5px 8px; font: inherit; outline: none;
      transition: background-color .16s ease, border-color .16s ease, box-shadow .16s ease, transform .16s ease;
    }
    .ilc-root input:focus, .ilc-root textarea:focus, .ilc-root select:focus {
      border-color: var(--koo-secondary); box-shadow: 0 0 0 2px rgba(0, 255, 102, .12);
    }
    .ilc-root textarea { resize: vertical; min-height: 56px; width: 100%; }
    .ilc-root button { cursor: pointer; white-space: nowrap; user-select: none; }
    .ilc-root button:hover { background: #202820; border-color: #2f6b42; transform: translateY(-1px); }
    .ilc-root button.primary, .ilc-preset-button.active {
      background: #133b22; border-color: var(--koo-secondary); color: var(--koo-primary); font-weight: 700;
    }
    .ilc-root button.primary:hover, .ilc-preset-button.active:hover { background: #174a29; border-color: var(--koo-hover); color: var(--koo-hover); }
    .ilc-root button.danger { color: #ffb4ab; border-color: #70413d; }
    .ilc-root input[type="checkbox"] { min-height: auto; width: 16px; height: 16px; padding: 0; accent-color: var(--koo-secondary); }
    .ilc-root input[type="range"] { padding: 0; accent-color: var(--koo-secondary); border: 0; }
    .ilc-check {
      display: inline-flex; align-items: center; gap: 6px; min-height: 29px; padding: 4px 7px;
      border: 1px solid #234b31; border-radius: 7px; background: #111713;
    }
    .ilc-main {
      display: grid; grid-template-columns: minmax(0, 1fr); gap: 7px; min-width: 0; min-height: 0;
      flex: 1 1 auto; overflow: hidden;
    }
    .ilc-root.is-wide .ilc-main { grid-template-columns: minmax(0, 7fr) minmax(0, 3fr); align-items: stretch; }
    .ilc-canvas-panel, .ilc-editor-panel, .ilc-global, .ilc-json, .ilc-warnings {
      background: #111713; border: 1px solid #234b31; border-radius: 8px; padding: 7px; min-width: 0;
      box-shadow: none;
    }
    .ilc-canvas-panel { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    .ilc-side-panel { display: flex; flex-direction: column; gap: 7px; min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden; }
    .ilc-canvas-wrap {
      position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; flex: 1 1 auto;
      border-radius: 7px; overflow: hidden; background: #080c0a; border: 1px solid #234b31;
    }
    .ilc-canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
    .ilc-canvas-help { color: #91a894; margin-top: 5px; font-size: 9px; }
    .ilc-box-list { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 0 5px; min-width: 0; max-height: 66px; overflow-y: auto; overflow-x: hidden; }
    .ilc-box-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-width: 0; }
    .ilc-box-chip span:last-child { overflow: hidden; text-overflow: ellipsis; }
    .ilc-box-chip.active {
      border-color: var(--koo-primary); color: var(--koo-primary); background: #173322;
      box-shadow: 0 0 0 1px rgba(0, 255, 102, .28), 0 0 10px rgba(0, 255, 102, .12);
    }
    .ilc-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
    .ilc-editor-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; margin-top: 6px; }
    .ilc-editor-grid .wide { grid-column: 1 / -1; }
    .ilc-editor-actions { display: flex; flex-wrap: wrap; gap: 7px; }
    .ilc-empty { color: #91a894; padding: 24px 8px; text-align: center; }
    .ilc-coords { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
    .ilc-coords input { min-width: 0; width: 100%; }
    .ilc-advanced { grid-column: 1 / -1; }
    .ilc-advanced summary, .ilc-global summary, .ilc-json summary {
      cursor: pointer; font-weight: 700; color: #e8f5e7; padding: 2px 0;
    }
    .ilc-global-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; margin-top: 7px; }
    .ilc-global-grid .wide { grid-column: 1 / -1; }
    .ilc-dna { color: var(--koo-accent); font-size: 9px; padding-top: 2px; }
    .ilc-json pre {
      margin: 7px 0 0; padding: 8px; max-height: 220px; overflow-x: hidden; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere;
      border-radius: 6px; background: #080c0a; border: 1px solid #234b31; color: #e8f5e7;
      font: 10px/1.45 "SFMono-Regular", Consolas, monospace; user-select: text;
    }
    .ilc-json-actions { display: flex; justify-content: flex-end; margin-top: 5px; }
    .ilc-warnings { color: #ffcf7d; background: #302719; flex: 0 0 auto; }
    .ilc-warnings.ok { color: #7ef2a7; background: #18291e; }
    .ilc-root:not(.is-wide) { overflow-y: auto; }
    .ilc-root:not(.is-wide) .ilc-main { overflow: visible; flex: 0 0 auto; }
    .ilc-root:not(.is-wide) .ilc-canvas-panel { height: var(--stacked-canvas-size); }
    .ilc-root:not(.is-wide) .ilc-side-panel { overflow: visible; }
    .ilc-hidden { display: none !important; }
    .lg-node:has(.ilc-root) [data-testid^="node-body-"] {
      gap: 0 !important;
      padding-top: 0 !important;
      padding-bottom: 0 !important;
      min-width: 0 !important;
      min-height: 0 !important;
    }
    .lg-node:has(.ilc-root) [data-testid="node-widgets"] {
      width: 100% !important;
      min-width: 0 !important;
      min-height: 0 !important;
      flex: 1 1 auto !important;
      padding-right: 0 !important;
      grid-template-columns: 0 0 minmax(0, 1fr) !important;
      gap: 0 !important;
    }
    .lg-node:has(.ilc-root) [data-testid="node-widget"],
    .lg-node:has(.ilc-root) .dom-widget,
    .lg-node:has(.ilc-root) .dom-widget > .ilc-root {
      width: 100% !important;
      height: 100% !important;
      min-width: 0 !important;
      min-height: 0 !important;
    }
  `;
  document.head.appendChild(style);
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value)));
const rounded = (value) => Math.round(value * 1000000) / 1000000;

function newId(prefix = "box") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeBox(raw, index = 0) {
  const source = raw || {};
  let [x1, y1, x2, y2] = Array.isArray(source.bbox) ? source.bbox.map(Number) : [0.1, 0.1, 0.4, 0.4];
  x1 = clamp(x1);
  y1 = clamp(y1);
  x2 = clamp(x2);
  y2 = clamp(y2);
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];
  x2 = Math.max(x1 + MIN_BOX, x2);
  y2 = Math.max(y1 + MIN_BOX, y2);
  if (x2 > 1) {
    x1 -= x2 - 1;
    x2 = 1;
  }
  if (y2 > 1) {
    y1 -= y2 - 1;
    y2 = 1;
  }
  return {
    id: String(source.id || newId(`box-${index + 1}`)),
    label: String(source.label || `Element ${index + 1}`),
    type: TYPES.includes(source.type) ? source.type : "object",
    bbox: [rounded(x1), rounded(y1), rounded(x2), rounded(y2)],
    prompt: String(source.prompt || ""),
    text: String(source.text || ""),
    negativePrompt: String(source.negativePrompt || ""),
    weight: clamp(source.weight ?? 1, 0, 2),
    color: /^#[0-9a-f]{6}$/i.test(source.color || "") ? source.color : COLORS[index % COLORS.length],
    locked: Boolean(source.locked),
    visible: source.visible !== false,
  };
}

function normalizeState(raw) {
  const fallback = createDefaultState();
  const source = raw && typeof raw === "object" ? raw : {};
  const aspectRatio = source.aspectRatio in ASPECTS || source.aspectRatio === "custom" ? source.aspectRatio : fallback.aspectRatio;
  const dimensions = ASPECTS[aspectRatio] || [
    clamp(Math.round(Number(source.width) || 1024), 64, 8192),
    clamp(Math.round(Number(source.height) || 1024), 64, 8192),
  ];
  return {
    ...fallback,
    ...source,
    version: 1,
    aspectRatio,
    width: Math.round(dimensions[0]),
    height: Math.round(dimensions[1]),
    style: { ...fallback.style, ...(source.style || {}) },
    promptDNA: { ...fallback.promptDNA, ...(source.promptDNA || {}) },
    guides: { ...fallback.guides, ...(source.guides || {}) },
    overlays: { ...fallback.overlays, ...(source.overlays || {}) },
    boxes: (Array.isArray(source.boxes) ? source.boxes : fallback.boxes).map(normalizeBox),
  };
}

function parseState(value) {
  if (!value) return createDefaultState();
  try {
    return normalizeState(typeof value === "string" ? JSON.parse(value) : value);
  } catch (error) {
    console.warn("KoO.IdeogramBoxy: could not restore layout", error);
    return createDefaultState();
  }
}

function field(label, control, className = "") {
  const wrapper = document.createElement("label");
  wrapper.className = `ilc-field ${className}`;
  const caption = document.createElement("span");
  caption.textContent = label;
  wrapper.append(caption, control);
  return wrapper;
}

function input(type = "text") {
  const element = document.createElement("input");
  element.type = type;
  return element;
}

function textarea() {
  return document.createElement("textarea");
}

function select(options) {
  const element = document.createElement("select");
  for (const item of options) {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = item;
    element.appendChild(option);
  }
  return element;
}

function checkbox(labelText) {
  const label = document.createElement("label");
  label.className = "ilc-check";
  const control = input("checkbox");
  const text = document.createElement("span");
  text.textContent = labelText;
  label.append(control, text);
  return { label, control };
}

function button(label, className = "") {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.className = className;
  return element;
}

function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function mergeHint(primary, fallback) {
  const primaryText = cleanText(primary);
  const fallbackText = cleanText(fallback);
  if (primaryText && fallbackText && !primaryText.toLowerCase().includes(fallbackText.toLowerCase())) {
    return `${primaryText}; ${fallbackText}`;
  }
  return primaryText || fallbackText;
}

function elementDescription(item) {
  const parts = [];
  if (item.label) parts.push(`${cleanText(item.label)} (${cleanText(item.type)})`);
  if (item.prompt) parts.push(cleanText(item.prompt));
  if (item.type === "text" && item.text) parts.push(`Exact text: "${cleanText(item.text)}"`);
  parts.push(`Importance: ${Number(item.weight || 0).toFixed(2)}`);
  if (item.negativePrompt) parts.push(`Avoid: ${cleanText(item.negativePrompt)}`);
  return parts.join(". ");
}

function buildLivePayload(state) {
  const typeMap = {
    text: "text",
    background: "background",
    object: "obj",
    logo: "obj",
    product: "obj",
    foreground: "obj",
    atmosphere: "obj",
  };
  const backgrounds = [];
  const elements = [];
  state.boxes.filter((item) => item.visible).forEach((item) => {
    const description = elementDescription(item);
    if (item.type === "background") {
      backgrounds.push(description);
      return;
    }
    elements.push({
      type: typeMap[item.type] || "obj",
      bbox: [
        Math.max(0, Math.min(state.width - 1, Math.round(item.bbox[0] * state.width))),
        Math.max(0, Math.min(state.height - 1, Math.round(item.bbox[1] * state.height))),
        Math.max(1, Math.min(state.width, Math.round(item.bbox[2] * state.width))),
        Math.max(1, Math.min(state.height, Math.round(item.bbox[3] * state.height))),
      ],
      desc: description,
    });
  });
  const dna = state.promptDNA || {};
  const style = state.style || {};
  return {
    high_level_description: mergeHint(state.highLevelDescription, dna.high_level_hint),
    style_description: {
      aesthetics: mergeHint(style.aesthetics, dna.aesthetics),
      lighting: mergeHint(style.lighting, dna.lighting),
      medium: mergeHint(style.medium, dna.medium),
      composition: mergeHint(style.composition, dna.composition),
    },
    compositional_deconstruction: {
      background: backgrounds.join("; ") || "A coherent background supporting the composition.",
      elements,
    },
  };
}

function isIdeogramBoxyNode(node) {
  const comfyClass = node?.comfyClass || node?.constructor?.comfyClass;
  return comfyClass === "KoOIdeogramBoxy" || comfyClass === "IdeogramLayoutComposer";
}

function styleOuterNode(node) {
  node.title = "KoO.IdeogramBoxy";
  node.bgcolor = KOO_THEME.nodeBackground;
  node.color = KOO_THEME.borderSoft;
  delete node.boxcolor;
  node.resizable = true;
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
  app.canvas?.setDirty?.(true, true);
}

function createComposer(node, initialValue) {
  installStyles();
  let state = parseState(initialValue);
  let selectedId = state.boxes.find((item) => item.type !== "background")?.id || state.boxes[0]?.id || null;
  let drag = null;
  let drawMetrics = null;
  let persistTimer = null;

  const root = document.createElement("div");
  root.className = "ilc-root";
  const initialNodeWidth = Math.max(0, Number(node.size?.[0]) || 0);
  root.classList.toggle("is-wide", initialNodeWidth >= WIDE_BREAKPOINT);

  const brand = document.createElement("header");
  brand.className = "ilc-brand";
  const brandCopy = document.createElement("div");
  const brandTitle = document.createElement("div");
  brandTitle.className = "ilc-brand-title";
  brandTitle.textContent = "KoO.IdeogramBoxy";
  const brandSubtitle = document.createElement("div");
  brandSubtitle.className = "ilc-brand-subtitle";
  brandSubtitle.textContent = "Visual composition workspace for structured Ideogram prompts";
  const brandMark = document.createElement("span");
  brandMark.className = "ilc-brand-mark";
  brandCopy.append(brandTitle, brandSubtitle);
  brand.append(brandCopy, brandMark);

  const presetbar = document.createElement("nav");
  presetbar.className = "ilc-presetbar";
  const presetLabel = document.createElement("div");
  presetLabel.className = "ilc-preset-label";
  presetLabel.textContent = "Composition presets";
  presetbar.appendChild(presetLabel);
  const presetButtons = new Map();
  const presetLabels = {
    "Golden Ratio": "Golden",
    "Rule of Thirds": "Thirds",
    "Archviz Hero": "Archviz",
    "Cinematic Close-Up": "Portrait",
    "Luxury Product": "Luxury",
    "Fashion Editorial": "Fashion",
    "Character Sheet": "Character",
    "Movie Poster": "Poster",
    "YouTube Thumbnail": "Thumbnail",
    "Product Ad": "Product Ad",
  };
  Object.keys(PRESETS).forEach((name) => {
    const presetButton = button(presetLabels[name] || name, "ilc-preset-button");
    presetButton.title = name;
    presetButton.addEventListener("click", () => applyPreset(name));
    presetButtons.set(name, presetButton);
    presetbar.appendChild(presetButton);
  });

  const topbar = document.createElement("div");
  topbar.className = "ilc-topbar";
  const aspectSelect = select([...Object.keys(ASPECTS), "custom"]);
  const widthInput = input("number");
  widthInput.min = "64";
  widthInput.max = "8192";
  const heightInput = input("number");
  heightInput.min = "64";
  heightInput.max = "8192";
  const applySize = button("Apply size");
  const refreshNode = button("REFRESH NODE", "primary");
  const fitToContent = button("FIT TO CONTENT");
  const resetPreset = button("Reset preset");
  topbar.append(
    field("Aspect ratio", aspectSelect),
    field("Width", widthInput),
    field("Height", heightInput),
    applySize,
    refreshNode,
    fitToContent,
    resetPreset,
  );

  const toolbar = document.createElement("div");
  toolbar.className = "ilc-toolbar";
  const addBox = button("+ Box", "primary");
  const duplicateBox = button("Duplicate");
  const deleteBox = button("Delete", "danger");
  const exportLayout = button("Export JSON");
  const importLayout = button("Import JSON");
  const importInput = input("file");
  importInput.accept = "application/json,.json";
  importInput.className = "ilc-hidden";
  const snapToggle = checkbox("Snap to guides");
  const preserveToggle = checkbox("Preserve hierarchy");
  toolbar.append(addBox, exportLayout, importLayout, importInput, snapToggle.label, preserveToggle.label);

  const overlaybar = document.createElement("div");
  overlaybar.className = "ilc-overlaybar";
  const thirdsToggle = checkbox("Rule of thirds");
  const spiralToggle = checkbox("Golden spiral");
  const safeToggle = checkbox("Safe zone");
  const safePlatform = select(["generic", "instagram", "youtube", "tiktok"]);
  overlaybar.append(thirdsToggle.label, spiralToggle.label, safeToggle.label, field("Safe zone target", safePlatform));

  const main = document.createElement("div");
  main.className = "ilc-main";
  const canvasPanel = document.createElement("section");
  canvasPanel.className = "ilc-canvas-panel";
  const boxList = document.createElement("div");
  boxList.className = "ilc-box-list";
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "ilc-canvas-wrap";
  const canvas = document.createElement("canvas");
  canvas.className = "ilc-canvas";
  canvasWrap.appendChild(canvas);
  const canvasHelp = document.createElement("div");
  canvasHelp.className = "ilc-canvas-help";
  canvasHelp.textContent = "Drag boxes to move them. Drag the square handle to resize. Coordinates remain normalized.";
  canvasPanel.append(boxList, canvasWrap, canvasHelp);

  const editorPanel = document.createElement("section");
  editorPanel.className = "ilc-editor-panel";
  const sidePanel = document.createElement("aside");
  sidePanel.className = "ilc-side-panel";
  sidePanel.appendChild(editorPanel);
  main.append(canvasPanel, sidePanel);

  const globalPanel = document.createElement("details");
  globalPanel.className = "ilc-global";
  globalPanel.open = false;
  const globalSummary = document.createElement("summary");
  globalSummary.textContent = "Global prompt and Preset Prompt DNA";
  const globalGrid = document.createElement("div");
  globalGrid.className = "ilc-global-grid";
  const highLevel = textarea();
  const aesthetics = textarea();
  const lighting = textarea();
  const medium = textarea();
  const composition = textarea();
  const dnaText = document.createElement("div");
  dnaText.className = "ilc-dna wide";
  globalGrid.append(
    field("High-level description", highLevel, "wide"),
    field("Aesthetics override", aesthetics),
    field("Lighting override", lighting),
    field("Medium override", medium),
    field("Composition override", composition),
    dnaText,
  );
  globalPanel.append(globalSummary, globalGrid);

  const jsonPanel = document.createElement("details");
  jsonPanel.className = "ilc-json";
  const jsonSummary = document.createElement("summary");
  jsonSummary.textContent = "Generated JSON";
  const jsonPreview = document.createElement("pre");
  const jsonActions = document.createElement("div");
  jsonActions.className = "ilc-json-actions";
  const copyJson = button("Copy JSON");
  jsonActions.appendChild(copyJson);
  jsonPanel.append(jsonSummary, jsonPreview, jsonActions);
  sidePanel.append(globalPanel, jsonPanel);

  const warnings = document.createElement("div");
  warnings.className = "ilc-warnings";
  root.append(brand, presetbar, topbar, toolbar, overlaybar, main, warnings);

  function selectedBox() {
    return state.boxes.find((item) => item.id === selectedId) || null;
  }

  function markChanged() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      node.graph?.change?.();
      app.canvas?.setDirty?.(true, true);
    }, 40);
  }

  function serialize() {
    return JSON.stringify(state);
  }

  function commit({ editor = false, list = true } = {}) {
    if (list) renderBoxList();
    if (editor) renderEditor();
    renderWarnings();
    renderLiveJson();
    draw();
    markChanged();
  }

  function renderLiveJson() {
    jsonPreview.textContent = JSON.stringify(buildLivePayload(state), null, 2);
  }

  function applyPreset(name) {
    const selected = clonePreset(name);
    state.preset = name;
    state.promptDNA = selected.promptDNA;
    state.guides = selected.guides;
    state.overlays = {
      ...state.overlays,
      ...selected.overlays,
    };
    state.boxes = selected.boxes.map(normalizeBox);
    selectedId = state.boxes.find((item) => item.type !== "background")?.id || state.boxes[0]?.id || null;
    syncFixedControls();
    commit({ editor: true });
  }

  function convertDimensions(newWidth, newHeight) {
    newWidth = clamp(Math.round(Number(newWidth) || state.width), 64, 8192);
    newHeight = clamp(Math.round(Number(newHeight) || state.height), 64, 8192);
    const oldWidth = state.width;
    const oldHeight = state.height;
    if (state.preserveHierarchy && oldWidth > 0 && oldHeight > 0) {
      const scale = Math.min(newWidth / oldWidth, newHeight / oldHeight);
      const offsetX = (newWidth - oldWidth * scale) / 2;
      const offsetY = (newHeight - oldHeight * scale) / 2;
      state.boxes.forEach((item) => {
        const [x1, y1, x2, y2] = item.bbox;
        item.bbox = normalizeBox({
          ...item,
          bbox: [
            (x1 * oldWidth * scale + offsetX) / newWidth,
            (y1 * oldHeight * scale + offsetY) / newHeight,
            (x2 * oldWidth * scale + offsetX) / newWidth,
            (y2 * oldHeight * scale + offsetY) / newHeight,
          ],
        }).bbox;
      });
    }
    state.width = newWidth;
    state.height = newHeight;
    widthInput.value = String(newWidth);
    heightInput.value = String(newHeight);
    commit({ editor: true });
  }

  function renderBoxList() {
    boxList.replaceChildren();
    state.boxes.forEach((item) => {
      const chip = button("");
      chip.className = `ilc-box-chip ${item.id === selectedId ? "active" : ""}`;
      chip.style.setProperty("--tag", item.color);
      const dot = document.createElement("span");
      dot.className = "ilc-dot";
      dot.style.background = item.color;
      const label = document.createElement("span");
      label.textContent = `${item.visible ? "" : "Hidden: "}${item.label}`;
      chip.append(dot, label);
      chip.addEventListener("click", () => {
        selectedId = item.id;
        renderBoxList();
        renderEditor();
        draw();
      });
      boxList.appendChild(chip);
    });
  }

  function bindEditorControl(control, key, parser = (value) => value) {
    const eventName = control.type === "checkbox" || control.tagName === "SELECT" ? "change" : "input";
    control.addEventListener(eventName, () => {
      const item = selectedBox();
      if (!item) return;
      item[key] = parser(control.type === "checkbox" ? control.checked : control.value);
      if (key === "type") renderEditor();
      commit({ list: key === "label" || key === "visible" });
    });
  }

  function renderEditor() {
    editorPanel.replaceChildren();
    const item = selectedBox();
    if (!item) {
      const empty = document.createElement("div");
      empty.className = "ilc-empty";
      empty.textContent = "Add or select a box to edit it.";
      editorPanel.appendChild(empty);
      return;
    }

    const title = document.createElement("div");
    title.className = "ilc-section-title";
    title.textContent = "Selected Box";
    const grid = document.createElement("div");
    grid.className = "ilc-editor-grid";

    const labelInput = input();
    labelInput.value = item.label;
    bindEditorControl(labelInput, "label");
    const typeSelect = select(TYPES);
    typeSelect.value = item.type;
    bindEditorControl(typeSelect, "type");
    const promptInput = textarea();
    promptInput.value = item.prompt;
    bindEditorControl(promptInput, "prompt");
    const negativeInput = textarea();
    negativeInput.value = item.negativePrompt;
    bindEditorControl(negativeInput, "negativePrompt");
    const textInput = textarea();
    textInput.value = item.text;
    bindEditorControl(textInput, "text");
    const weightInput = input("range");
    weightInput.min = "0";
    weightInput.max = "2";
    weightInput.step = "0.05";
    weightInput.value = String(item.weight);
    const weightLabel = document.createElement("span");
    weightLabel.textContent = `Weight / importance: ${Number(item.weight).toFixed(2)}`;
    weightInput.addEventListener("input", () => {
      item.weight = Number(weightInput.value);
      weightLabel.textContent = `Weight / importance: ${item.weight.toFixed(2)}`;
      commit({ list: false });
    });
    const weightField = document.createElement("label");
    weightField.className = "ilc-field wide";
    weightLabel.className = "ilc-section-title";
    weightField.append(weightLabel, weightInput);
    const colorInput = input("color");
    colorInput.value = item.color;
    bindEditorControl(colorInput, "color");
    const lock = checkbox("Locked");
    lock.control.checked = item.locked;
    bindEditorControl(lock.control, "locked", Boolean);
    const visible = checkbox("Visible");
    visible.control.checked = item.visible;
    bindEditorControl(visible.control, "visible", Boolean);

    const coords = document.createElement("div");
    coords.className = "ilc-coords";
    ["x1", "y1", "x2", "y2"].forEach((name, index) => {
      const coordinate = input("number");
      coordinate.min = "0";
      coordinate.max = "1";
      coordinate.step = "0.001";
      coordinate.value = String(item.bbox[index]);
      coordinate.title = name;
      coordinate.addEventListener("change", () => {
        const next = [...item.bbox];
        next[index] = Number(coordinate.value);
        item.bbox = normalizeBox({ ...item, bbox: next }).bbox;
        renderEditor();
        commit({ list: false });
      });
      coords.appendChild(coordinate);
    });
    const advanced = document.createElement("details");
    advanced.className = "ilc-advanced";
    const advancedSummary = document.createElement("summary");
    advancedSummary.textContent = "Position and advanced controls";
    advanced.append(advancedSummary, coords);

    const editorActions = document.createElement("div");
    editorActions.className = "ilc-editor-actions wide";
    const inspectorDuplicate = button("Duplicate");
    const inspectorDelete = button("Delete", "danger");
    inspectorDuplicate.addEventListener("click", () => duplicateBox.click());
    inspectorDelete.addEventListener("click", () => deleteBox.click());
    editorActions.append(inspectorDuplicate, inspectorDelete);

    grid.append(
      field("Label", labelInput, "wide"),
      field("Type", typeSelect, "wide"),
      field("Prompt", promptInput, "wide"),
    );
    if (item.type === "text") grid.append(field("Exact text content", textInput, "wide"));
    grid.append(
      field("Negative Prompt", negativeInput, "wide"),
      weightField,
      field("Color Tag", colorInput, "wide"),
      lock.label,
      visible.label,
      advanced,
      editorActions,
    );
    editorPanel.append(title, grid);
  }

  function overlapRatio(first, second) {
    const x = Math.max(0, Math.min(first[2], second[2]) - Math.max(first[0], second[0]));
    const y = Math.max(0, Math.min(first[3], second[3]) - Math.max(first[1], second[1]));
    const intersection = x * y;
    const areaA = Math.max(0.000001, (first[2] - first[0]) * (first[3] - first[1]));
    const areaB = Math.max(0.000001, (second[2] - second[0]) * (second[3] - second[1]));
    return intersection / Math.min(areaA, areaB);
  }

  function renderWarnings() {
    const messages = [];
    const visibleBoxes = state.boxes.filter((item) => item.visible);
    for (let index = 0; index < visibleBoxes.length; index += 1) {
      for (let other = index + 1; other < visibleBoxes.length; other += 1) {
        const first = visibleBoxes[index];
        const second = visibleBoxes[other];
        if (first.type === "background" || second.type === "background") continue;
        if (overlapRatio(first.bbox, second.bbox) >= 0.2) {
          messages.push(`Overlap: ${first.label} / ${second.label}`);
        }
      }
    }
    visibleBoxes.filter((item) => item.type === "text").forEach((item) => {
      const boxWidth = (item.bbox[2] - item.bbox[0]) * state.width;
      const boxHeight = (item.bbox[3] - item.bbox[1]) * state.height;
      if (boxWidth < 180 || boxHeight < 64) messages.push(`Text readability: enlarge "${item.label}"`);
      if (!item.text.trim()) messages.push(`Text readability: "${item.label}" has no exact text`);
    });
    warnings.classList.toggle("ok", messages.length === 0);
    warnings.textContent = messages.length ? messages.join("  |  ") : "Layout checks passed: no strong overlap or text readability warnings.";
  }

  function canvasFrame() {
    const cssWidth = Math.max(1, canvas.clientWidth);
    const cssHeight = Math.max(1, canvas.clientHeight);
    const padding = Math.max(2, Math.min(8, Math.min(cssWidth, cssHeight) * 0.015));
    const scale = Math.min((cssWidth - padding * 2) / state.width, (cssHeight - padding * 2) / state.height);
    const width = state.width * scale;
    const height = state.height * scale;
    const shortestSide = Math.min(width, height);
    return {
      x: (cssWidth - width) / 2,
      y: (cssHeight - height) / 2,
      width,
      height,
      scale,
      handleSize: Math.max(14, Math.min(24, shortestSide * 0.045)),
      labelSize: Math.max(9, Math.min(14, shortestSide * 0.026)),
      selectedStroke: Math.max(2.5, Math.min(4.5, shortestSide * 0.009)),
    };
  }

  function drawSpiral(ctx, frame) {
    const phi = (1 + Math.sqrt(5)) / 2;
    const centerX = frame.x + frame.width * 0.618;
    const centerY = frame.y + frame.height * 0.382;
    const maxRadius = Math.hypot(frame.width, frame.height) * 0.62;
    ctx.beginPath();
    let started = false;
    for (let step = 0; step <= 240; step += 1) {
      const theta = -2.5 * Math.PI + step * (4.5 * Math.PI / 240);
      const radius = maxRadius * phi ** (theta / (Math.PI / 2) - 4.5);
      const x = centerX + radius * Math.cos(theta);
      const y = centerY + radius * Math.sin(theta);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = "rgba(251,191,36,.8)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function draw() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssWidth = Math.max(1, canvas.clientWidth);
    const cssHeight = Math.max(1, canvas.clientHeight);
    if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = KOO_THEME.nodeBackground;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const frame = canvasFrame();
    drawMetrics = frame;
    ctx.fillStyle = KOO_THEME.panel;
    ctx.fillRect(frame.x, frame.y, frame.width, frame.height);
    ctx.strokeStyle = "#4a534e";
    ctx.lineWidth = 1;
    ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);

    const vertical = new Set(state.guides?.vertical || []);
    const horizontal = new Set(state.guides?.horizontal || []);
    if (state.overlays.ruleOfThirds) {
      vertical.add(1 / 3);
      vertical.add(2 / 3);
      horizontal.add(1 / 3);
      horizontal.add(2 / 3);
    }
    ctx.strokeStyle = "rgba(172,184,177,.34)";
    ctx.lineWidth = 1;
    for (const position of vertical) {
      const x = frame.x + Number(position) * frame.width;
      ctx.beginPath();
      ctx.moveTo(x, frame.y);
      ctx.lineTo(x, frame.y + frame.height);
      ctx.stroke();
    }
    for (const position of horizontal) {
      const y = frame.y + Number(position) * frame.height;
      ctx.beginPath();
      ctx.moveTo(frame.x, y);
      ctx.lineTo(frame.x + frame.width, y);
      ctx.stroke();
    }
    if (state.overlays.goldenSpiral) drawSpiral(ctx, frame);

    if (state.overlays.safeZone) {
      const zones = {
        generic: [0.05, 0.05, 0.95, 0.95],
        instagram: [0.08, 0.08, 0.92, 0.92],
        youtube: [0.05, 0.10, 0.95, 0.90],
        tiktok: [0.08, 0.12, 0.88, 0.82],
      };
      const zone = zones[state.overlays.safeZonePlatform] || zones.generic;
      ctx.strokeStyle = "rgba(74,222,128,.9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(
        frame.x + zone[0] * frame.width,
        frame.y + zone[1] * frame.height,
        (zone[2] - zone[0]) * frame.width,
        (zone[3] - zone[1]) * frame.height,
      );
      ctx.setLineDash([]);
    }

    state.boxes.forEach((item) => {
      if (!item.visible) return;
      const [x1, y1, x2, y2] = item.bbox;
      const left = frame.x + x1 * frame.width;
      const top = frame.y + y1 * frame.height;
      const width = (x2 - x1) * frame.width;
      const height = (y2 - y1) * frame.height;
      const isSelected = item.id === selectedId;
      ctx.fillStyle = isSelected ? "rgba(0,255,102,.13)" : `${item.color}1c`;
      ctx.fillRect(left, top, width, height);
      ctx.strokeStyle = isSelected ? KOO_SECONDARY : item.color;
      ctx.lineWidth = isSelected ? frame.selectedStroke : Math.max(1, frame.selectedStroke * 0.45);
      if (isSelected) {
        ctx.shadowColor = "rgba(0,255,102,.48)";
        ctx.shadowBlur = Math.max(6, frame.handleSize * 0.65);
      }
      ctx.strokeRect(left, top, width, height);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.font = `600 ${frame.labelSize}px Inter, sans-serif`;
      const label = `${item.label}${item.locked ? " [L]" : ""}`;
      const labelHeight = frame.labelSize + 8;
      const labelWidth = Math.min(width, ctx.measureText(label).width + 10);
      ctx.fillStyle = isSelected ? KOO_PRIMARY : item.color;
      ctx.fillRect(left, top, labelWidth, labelHeight);
      ctx.fillStyle = "#102217";
      ctx.fillText(label, left + 5, top + frame.labelSize + 3, Math.max(10, labelWidth - 8));
      if (isSelected && !item.locked) {
        const handle = frame.handleSize;
        ctx.fillStyle = KOO_PRIMARY;
        ctx.fillRect(left + width - handle / 2, top + height - handle / 2, handle, handle);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.strokeRect(left + width - handle / 2, top + height - handle / 2, handle, handle);
      }
    });

    ctx.fillStyle = "#9aa49e";
    ctx.font = `${Math.max(9, frame.labelSize - 1)}px Inter, sans-serif`;
    ctx.fillText(`${state.width} x ${state.height}px`, frame.x + 5, frame.y + frame.height - 6);
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function toNormalized(point) {
    const frame = drawMetrics || canvasFrame();
    return {
      x: clamp((point.x - frame.x) / frame.width),
      y: clamp((point.y - frame.y) / frame.height),
    };
  }

  function snapBox(bbox, mode) {
    if (!state.snapToGuides) return bbox;
    const vertical = [...(state.guides?.vertical || [])];
    const horizontal = [...(state.guides?.horizontal || [])];
    if (state.overlays.ruleOfThirds) {
      vertical.push(1 / 3, 2 / 3);
      horizontal.push(1 / 3, 2 / 3);
    }
    vertical.push(0, 0.5, 1);
    horizontal.push(0, 0.5, 1);
    const threshold = 0.012;
    const next = [...bbox];
    const snapValue = (value, guides) => {
      const closest = guides.reduce((best, guide) => Math.abs(guide - value) < Math.abs(best - value) ? guide : best, guides[0]);
      return Math.abs(closest - value) <= threshold ? closest : value;
    };
    if (mode === "resize") {
      next[2] = snapValue(next[2], vertical);
      next[3] = snapValue(next[3], horizontal);
    } else {
      const width = next[2] - next[0];
      const height = next[3] - next[1];
      const centerX = (next[0] + next[2]) / 2;
      const centerY = (next[1] + next[3]) / 2;
      const snappedCenterX = snapValue(centerX, vertical);
      const snappedCenterY = snapValue(centerY, horizontal);
      if (snappedCenterX !== centerX) {
        next[0] = snappedCenterX - width / 2;
        next[2] = snappedCenterX + width / 2;
      }
      if (snappedCenterY !== centerY) {
        next[1] = snappedCenterY - height / 2;
        next[3] = snappedCenterY + height / 2;
      }
    }
    return next;
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!drawMetrics) return;
    const point = pointerPosition(event);
    const norm = toNormalized(point);
    const selected = selectedBox();
    if (selected && selected.visible && !selected.locked) {
      const handleX = drawMetrics.x + selected.bbox[2] * drawMetrics.width;
      const handleY = drawMetrics.y + selected.bbox[3] * drawMetrics.height;
      if (Math.hypot(point.x - handleX, point.y - handleY) <= drawMetrics.handleSize) {
        drag = { mode: "resize", id: selected.id, start: norm, bbox: [...selected.bbox] };
        canvas.setPointerCapture(event.pointerId);
        return;
      }
    }
    const hit = [...state.boxes].reverse().find((item) => item.visible
      && norm.x >= item.bbox[0] && norm.x <= item.bbox[2]
      && norm.y >= item.bbox[1] && norm.y <= item.bbox[3]);
    if (!hit) return;
    selectedId = hit.id;
    renderBoxList();
    renderEditor();
    draw();
    if (!hit.locked) {
      drag = { mode: "move", id: hit.id, start: norm, bbox: [...hit.bbox] };
      canvas.setPointerCapture(event.pointerId);
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const item = state.boxes.find((candidate) => candidate.id === drag.id);
    if (!item) return;
    const current = toNormalized(pointerPosition(event));
    const dx = current.x - drag.start.x;
    const dy = current.y - drag.start.y;
    let next = [...drag.bbox];
    if (drag.mode === "resize") {
      next[2] = clamp(Math.max(next[0] + MIN_BOX, drag.bbox[2] + dx));
      next[3] = clamp(Math.max(next[1] + MIN_BOX, drag.bbox[3] + dy));
    } else {
      const width = drag.bbox[2] - drag.bbox[0];
      const height = drag.bbox[3] - drag.bbox[1];
      next[0] = clamp(drag.bbox[0] + dx, 0, 1 - width);
      next[1] = clamp(drag.bbox[1] + dy, 0, 1 - height);
      next[2] = next[0] + width;
      next[3] = next[1] + height;
    }
    item.bbox = normalizeBox({ ...item, bbox: snapBox(next, drag.mode) }).bbox;
    draw();
    renderWarnings();
    renderLiveJson();
    markChanged();
  });

  const endDrag = (event) => {
    if (!drag) return;
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    renderEditor();
    commit({ list: false });
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  aspectSelect.addEventListener("change", () => {
    state.aspectRatio = aspectSelect.value;
    if (ASPECTS[state.aspectRatio]) {
      convertDimensions(...ASPECTS[state.aspectRatio]);
    } else {
      widthInput.disabled = false;
      heightInput.disabled = false;
      commit({ list: false });
    }
    syncFixedControls();
  });
  applySize.addEventListener("click", () => {
    if (state.aspectRatio !== "custom") state.aspectRatio = "custom";
    aspectSelect.value = "custom";
    convertDimensions(widthInput.value, heightInput.value);
    syncFixedControls();
  });
  refreshNode.addEventListener("click", () => {
    fitEditorToNode(true);
    refreshNode.textContent = "NODE REFRESHED";
    setTimeout(() => {
      refreshNode.textContent = "REFRESH NODE";
    }, 900);
  });
  fitToContent.addEventListener("click", () => {
    fitNodeToContent();
    fitToContent.textContent = "CONTENT FITTED";
    setTimeout(() => {
      fitToContent.textContent = "FIT TO CONTENT";
    }, 900);
  });
  resetPreset.addEventListener("click", () => applyPreset(state.preset));

  addBox.addEventListener("click", () => {
    const item = normalizeBox({
      id: newId(),
      label: `Element ${state.boxes.length + 1}`,
      type: "object",
      bbox: [0.30, 0.30, 0.65, 0.65],
      prompt: "",
      color: COLORS[state.boxes.length % COLORS.length],
    }, state.boxes.length);
    state.boxes.push(item);
    selectedId = item.id;
    commit({ editor: true });
  });
  duplicateBox.addEventListener("click", () => {
    const source = selectedBox();
    if (!source) return;
    const copy = normalizeBox({
      ...clone(source),
      id: newId(),
      label: `${source.label} Copy`,
      bbox: source.bbox.map((value, index) => clamp(value + (index < 2 ? 0.025 : 0.025))),
      locked: false,
    }, state.boxes.length);
    state.boxes.push(copy);
    selectedId = copy.id;
    commit({ editor: true });
  });
  deleteBox.addEventListener("click", () => {
    if (!selectedId) return;
    state.boxes = state.boxes.filter((item) => item.id !== selectedId);
    selectedId = state.boxes[0]?.id || null;
    commit({ editor: true });
  });

  exportLayout.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ideogram-layout-${state.preset.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  copyJson.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(jsonPreview.textContent || "");
      copyJson.textContent = "Copied";
      setTimeout(() => {
        copyJson.textContent = "Copy JSON";
      }, 1200);
    } catch {
      copyJson.textContent = "Copy unavailable";
    }
  });
  importLayout.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    try {
      state = normalizeState(JSON.parse(await file.text()));
      selectedId = state.boxes[0]?.id || null;
      syncFixedControls();
      commit({ editor: true });
    } catch (error) {
      warnings.classList.remove("ok");
      warnings.textContent = `Import failed: ${error.message}`;
    } finally {
      importInput.value = "";
    }
  });

  snapToggle.control.addEventListener("change", () => {
    state.snapToGuides = snapToggle.control.checked;
    commit({ list: false });
  });
  preserveToggle.control.addEventListener("change", () => {
    state.preserveHierarchy = preserveToggle.control.checked;
    commit({ list: false });
  });
  thirdsToggle.control.addEventListener("change", () => {
    state.overlays.ruleOfThirds = thirdsToggle.control.checked;
    commit({ list: false });
  });
  spiralToggle.control.addEventListener("change", () => {
    state.overlays.goldenSpiral = spiralToggle.control.checked;
    commit({ list: false });
  });
  safeToggle.control.addEventListener("change", () => {
    state.overlays.safeZone = safeToggle.control.checked;
    commit({ list: false });
  });
  safePlatform.addEventListener("change", () => {
    state.overlays.safeZonePlatform = safePlatform.value;
    commit({ list: false });
  });

  [
    [highLevel, "highLevelDescription", null],
    [aesthetics, "aesthetics", "style"],
    [lighting, "lighting", "style"],
    [medium, "medium", "style"],
    [composition, "composition", "style"],
  ].forEach(([control, key, parent]) => {
    control.addEventListener("input", () => {
      if (parent) state[parent][key] = control.value;
      else state[key] = control.value;
      renderLiveJson();
      markChanged();
    });
  });

  function syncFixedControls() {
    aspectSelect.value = state.aspectRatio;
    widthInput.value = String(state.width);
    heightInput.value = String(state.height);
    widthInput.disabled = state.aspectRatio !== "custom";
    heightInput.disabled = state.aspectRatio !== "custom";
    presetButtons.forEach((presetButton, name) => {
      presetButton.classList.toggle("active", name === state.preset);
    });
    snapToggle.control.checked = state.snapToGuides;
    preserveToggle.control.checked = state.preserveHierarchy;
    thirdsToggle.control.checked = Boolean(state.overlays.ruleOfThirds);
    spiralToggle.control.checked = Boolean(state.overlays.goldenSpiral);
    safeToggle.control.checked = Boolean(state.overlays.safeZone);
    safePlatform.value = state.overlays.safeZonePlatform || "generic";
    highLevel.value = state.highLevelDescription || "";
    aesthetics.value = state.style.aesthetics || "";
    lighting.value = state.style.lighting || "";
    medium.value = state.style.medium || "";
    composition.value = state.style.composition || "";
    const dna = state.promptDNA || {};
    dnaText.textContent = `Preset DNA: ${[dna.aesthetics, dna.lighting, dna.medium, dna.composition].filter(Boolean).join(" | ")}`;
  }

  function load(value) {
    state = parseState(value);
    selectedId = state.boxes.find((item) => item.id === selectedId)?.id || state.boxes[0]?.id || null;
    syncFixedControls();
    renderBoxList();
    renderEditor();
    renderWarnings();
    renderLiveJson();
    updateResponsiveLayout();
  }

  let nodeContainer = null;
  let layoutFrame = 0;

  function findNodeContainer() {
    const direct = root.closest?.(".lg-node");
    if (direct) return direct;
    const nodeId = String(node?.id ?? "");
    if (!nodeId || nodeId === "-1") return null;
    return document.querySelector(`.lg-node[data-node-id="${CSS.escape(nodeId)}"]`);
  }

  function readEditorDimensions() {
    const host = root.parentElement;
    const nodeWidth = Number(node.size?.[0]) || 0;
    const nodeHeight = Number(node.size?.[1]) || 0;
    const hostWidth = Number(host?.clientWidth) || Number(root.clientWidth) || 0;
    const hostHeight = Number(host?.clientHeight) || Number(root.clientHeight) || 0;
    return {
      width: Math.max(1, hostWidth || nodeWidth || 1),
      height: Math.max(1, hostHeight || nodeHeight || 1),
    };
  }

  function updateResponsiveLayout(dimensions = readEditorDimensions()) {
    const { width, height } = dimensions;
    const isWide = width >= WIDE_BREAKPOINT;
    root.classList.toggle("is-wide", isWide);
    const stackedCanvasSize = Math.min(height * 0.58, width * 0.78);
    root.style.setProperty("--stacked-canvas-size", `${Math.max(1, stackedCanvasSize)}px`);
    draw();
  }

  function scheduleResponsiveLayout() {
    if (layoutFrame) cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      updateResponsiveLayout();
    });
  }

  function attachNodeContainerObserver() {
    const nextContainer = findNodeContainer();
    if (!nextContainer || nextContainer === nodeContainer) return Boolean(nextContainer);
    nodeContainer = nextContainer;
    resizeObserver.observe(nodeContainer);
    const nodeBody = nodeContainer.querySelector(`[data-testid^="node-body-"]`);
    const nodeWidgets = nodeContainer.querySelector('[data-testid="node-widgets"]');
    if (nodeBody) resizeObserver.observe(nodeBody);
    if (nodeWidgets) resizeObserver.observe(nodeWidgets);
    return true;
  }

  function fitEditorToNode(forceNodeLayout = false) {
    root.style.width = "100%";
    root.style.height = "100%";
    root.style.minWidth = "0";
    root.style.minHeight = "0";
    attachNodeContainerObserver();

    if (forceNodeLayout && node.setSize && Array.isArray(node.size)) {
      const width = Math.max(1, Number(node.size[0]) || 1);
      const height = Math.max(1, Number(node.size[1]) || 1);
      node.setSize([width, height]);
    }
    updateResponsiveLayout();
    scheduleResponsiveLayout();
    node.setDirtyCanvas?.(true, true);
    node.graph?.setDirtyCanvas?.(true, true);
    node.graph?.incrementVersion?.();
    app.canvas?.setDirty?.(true, true);
  }

  function fitNodeToContent() {
    if (!node.setSize) return;
    const naturalRowWidth = (element) => {
      const children = [...element.children].filter((child) => !child.classList.contains("ilc-hidden"));
      const style = getComputedStyle(element);
      const gap = Number.parseFloat(style.columnGap || style.gap) || 0;
      return children.reduce((total, child) => total + child.scrollWidth, 0)
        + Math.max(0, children.length - 1) * gap;
    };
    const toolbarWidth = Math.max(
      naturalRowWidth(presetbar),
      naturalRowWidth(topbar),
      naturalRowWidth(toolbar),
      naturalRowWidth(overlaybar),
    );
    const sideWidth = Math.max(
      editorPanel.scrollWidth,
      globalPanel.scrollWidth,
      jsonPanel.scrollWidth,
    );
    const currentChromeWidth = Math.max(0, (Number(node.size?.[0]) || 0) - root.clientWidth);
    const targetEditorWidth = Math.ceil(Math.max(
      WIDE_BREAKPOINT + 1,
      toolbarWidth,
      sideWidth / 0.3,
    ));
    const targetWidth = targetEditorWidth + currentChromeWidth;
    const targetCanvasWidth = targetEditorWidth * 0.7;
    const canvasContentHeight = targetCanvasWidth * (state.height / state.width)
      + boxList.scrollHeight + canvasHelp.scrollHeight;
    const mainHeight = Math.max(canvasContentHeight, sidePanel.scrollHeight);
    const chromeHeight = Math.max(0, (Number(node.size?.[1]) || 0) - root.clientHeight);
    const headerHeight = brand.scrollHeight + presetbar.scrollHeight + topbar.scrollHeight
      + toolbar.scrollHeight + overlaybar.scrollHeight + warnings.scrollHeight;
    const targetHeight = Math.ceil(headerHeight + mainHeight + chromeHeight + 14);
    node.setSize([targetWidth, targetHeight]);
    fitEditorToNode(true);
    node.graph?.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
  }

  const resizeObserver = new ResizeObserver(() => scheduleResponsiveLayout());
  resizeObserver.observe(root);
  if (root.parentElement) resizeObserver.observe(root.parentElement);
  resizeObserver.observe(canvasWrap);
  const mountObserver = new MutationObserver(() => {
    if (attachNodeContainerObserver()) mountObserver.disconnect();
  });
  mountObserver.observe(document.body, { childList: true, subtree: true });

  syncFixedControls();
  renderBoxList();
  renderEditor();
  renderWarnings();
  renderLiveJson();
  attachNodeContainerObserver();
  updateResponsiveLayout();

  return { root, serialize, load, fitEditorToNode };
}

app.registerExtension({
  name: "KoO.IdeogramBoxy",
  nodeCreated(node) {
    if (isIdeogramBoxyNode(node)) styleOuterNode(node);
  },
  afterConfigureGraph() {
    for (const node of app.graph?._nodes ?? []) {
      if (isIdeogramBoxyNode(node)) styleOuterNode(node);
    }
  },
  getCustomWidgets() {
    return {
      IDEOGRAM_LAYOUT(node, inputName) {
        styleOuterNode(node);
        const composer = createComposer(node, "");
        const widget = node.addDOMWidget(inputName, "IDEOGRAM_LAYOUT", composer.root, {
          getValue: () => composer.serialize(),
          setValue: (value) => composer.load(value),
          getMinHeight: () => 0,
          getHeight: () => "100%",
          hideOnZoom: false,
          margin: 0,
          afterResize: () => composer.fitEditorToNode(),
        });
        widget.serializeValue = () => composer.serialize();
        composer.fitEditorToNode();
        return { widget };
      },
    };
  },
});
