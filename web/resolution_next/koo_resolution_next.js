import { app } from "../../../scripts/app.js";

const NODE_NAME = "KoOResolutionNext";
const DEFAULT_ACCENT = "#FF4FA3";
const FONT_STACK = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
const BACKEND_WIDGET_NAMES = [
  "base_width",
  "base_height",
  "ratio",
  "max_side",
  "max_side_lock",
  "scale",
  "latent_mode",
  "batch_size",
];

const RATIO_DEFAULTS = {
  "1:1": [1024, 1024],
  "16:9": [1536, 864],
  "9:16": [864, 1536],
  "4:3": [1152, 864],
  "3:4": [864, 1152],
  "3:2": [1248, 832],
  "2:3": [832, 1248],
  "21:9": [1344, 576],
  "4:5": [1024, 1280],
};

const RATIO_LABELS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "4:5", "Custom"];
const MAX_SIDES = [1024, 1536, 2048, 2560, 4096];
const LATENT_MODES = ["Resolution Only", "Standard SD / SDXL", "SD3 / Flux 1 / Qwen", "Flux 2"];
const THEMES = ["Light", "Dark", "Spicy"];
const SWATCHES = ["#FF4FA3", "#FF3048", "#FF7A30", "#FFC93A", "#7ED957", "#2ED6D6", "#3D8BFF", "#9B6CFF", "#FF66C4"];

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

function snap8(value) {
  return Math.max(8, Math.round(Number(value) / 8) * 8);
}

function clampDimension(value) {
  return Math.max(8, Math.min(16384, snap8(value)));
}

function normalizeHex(value) {
  const text = String(value || "").trim();
  const match = text.match(/^#?([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toUpperCase()}` : null;
}

function hexToRgba(hex, alpha) {
  const clean = normalizeHex(hex) || DEFAULT_ACCENT;
  const intValue = parseInt(clean.slice(1), 16);
  const r = (intValue >> 16) & 255;
  const g = (intValue >> 8) & 255;
  const b = intValue & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function hexToRgb(hex) {
  const clean = normalizeHex(hex) || DEFAULT_ACCENT;
  const intValue = parseInt(clean.slice(1), 16);
  return {
    r: (intValue >> 16) & 255,
    g: (intValue >> 8) & 255,
    b: intValue & 255,
  };
}

function relativeLuminance({ r, g, b }) {
  const linear = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(lumaA, lumaB) {
  const light = Math.max(lumaA, lumaB);
  const dark = Math.min(lumaA, lumaB);
  return (light + 0.05) / (dark + 0.05);
}

function buildAccentPalette(accent, contrastMode) {
  const accentSolid = normalizeHex(accent) || DEFAULT_ACCENT;
  const accentLuma = relativeLuminance(hexToRgb(accentSolid));
  const darkForeground = "#17191D";
  const accentForeground = accentLuma > 0.58 ? darkForeground : "#FFFFFF";
  return {
    contrastMode,
    accentSolid,
    accentForeground,
    accentBorder: accentSolid,
    accentTint: hexToRgba(accentSolid, 0.2),
    accentTintStrong: hexToRgba(accentSolid, 0.28),
  };
}

function getAccentPalette(node) {
  const accent = normalizeHex(node.properties?.kooResolutionNextAccent) || DEFAULT_ACCENT;
  const contrastMode = Boolean(node.properties?.kooContrastMode);
  const cache = node._kooResolutionNextAccentPalette;
  if (!cache || cache.sourceAccent !== accent || cache.sourceContrast !== contrastMode) {
    node._kooResolutionNextAccentPalette = {
      sourceAccent: accent,
      sourceContrast: contrastMode,
      ...buildAccentPalette(accent, contrastMode),
    };
  }
  return node._kooResolutionNextAccentPalette;
}

function activeFill(palette, fallbackAlpha = 0.2) {
  return palette.contrastMode ? palette.accentSolid : hexToRgba(palette.accentSolid, fallbackAlpha);
}

function activeForeground(palette, normalColor) {
  return palette.contrastMode ? palette.accentForeground : normalColor;
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
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let out = text;
  while (out.length > 3 && ctx.measureText(`${out.slice(0, -1)}...`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

function backendWidgets(node) {
  if (node.widgets?.length) {
    return node.widgets;
  }
  if (node._kooResolutionNextWidgets?.length) {
    return node._kooResolutionNextWidgets;
  }
  return [];
}

function widget(node, name) {
  return backendWidgets(node).find((item) => item.name === name);
}

function setWidget(node, name, value) {
  const item = widget(node, name);
  if (!item) {
    return;
  }
  item.value = value;
  node.setDirtyCanvas(true, true);
}

function getState(node) {
  const baseWidth = Number(widget(node, "base_width")?.value ?? 1536);
  const baseHeight = Number(widget(node, "base_height")?.value ?? 864);
  const ratio = widget(node, "ratio")?.value ?? "16:9";
  const maxSide = Number(widget(node, "max_side")?.value ?? 2048);
  const locked = Boolean(widget(node, "max_side_lock")?.value);
  const scale = widget(node, "scale")?.value ?? "x1";
  const latentMode = widget(node, "latent_mode")?.value ?? "Standard SD / SDXL";
  const batch = Number(widget(node, "batch_size")?.value ?? 1);
  return { baseWidth, baseHeight, ratio, maxSide, locked, scale, latentMode, batch };
}

function lockedDimensions(ratio, maxSide, fallbackWidth, fallbackHeight) {
  const side = clampDimension(maxSide);
  const pair = RATIO_DEFAULTS[ratio] || [Math.max(8, fallbackWidth), Math.max(8, fallbackHeight)];
  const [rw, rh] = pair;
  if (rw >= rh) {
    return [side, clampDimension(side * (rh / rw))];
  }
  return [clampDimension(side * (rw / rh)), side];
}

function finalDimensions(state) {
  let baseWidth = clampDimension(state.baseWidth);
  let baseHeight = clampDimension(state.baseHeight);
  if (state.locked) {
    [baseWidth, baseHeight] = lockedDimensions(state.ratio, state.maxSide, baseWidth, baseHeight);
  }
  const mult = state.scale === "x2" ? 2 : 1;
  return {
    baseWidth,
    baseHeight,
    width: clampDimension(baseWidth * mult),
    height: clampDimension(baseHeight * mult),
  };
}

function applyRatio(node, ratio) {
  const state = getState(node);
  setWidget(node, "ratio", ratio);
  if (ratio !== "Custom") {
    const [w, h] = state.locked
      ? lockedDimensions(ratio, state.maxSide, state.baseWidth, state.baseHeight)
      : RATIO_DEFAULTS[ratio];
    setWidget(node, "base_width", w);
    setWidget(node, "base_height", h);
  }
}

function applyMaxSide(node, value) {
  setWidget(node, "max_side", value);
  const state = getState(node);
  if (state.locked && state.ratio !== "Custom") {
    const [w, h] = lockedDimensions(state.ratio, value, state.baseWidth, state.baseHeight);
    setWidget(node, "base_width", w);
    setWidget(node, "base_height", h);
  }
}

function toggleLock(node) {
  const state = getState(node);
  setWidget(node, "max_side_lock", !state.locked);
  const next = getState(node);
  if (next.locked) {
    const [w, h] = lockedDimensions(next.ratio, next.maxSide, next.baseWidth, next.baseHeight);
    setWidget(node, "base_width", w);
    setWidget(node, "base_height", h);
  }
}

function manualSize(node, field) {
  const state = getState(node);
  const current = field === "width" ? state.baseWidth : state.baseHeight;
  const answer = prompt(field === "width" ? "Base width" : "Base height", String(current));
  if (answer === null) {
    return;
  }
  const value = clampDimension(Number(answer));
  if (!Number.isFinite(value)) {
    return;
  }
  setWidget(node, field === "width" ? "base_width" : "base_height", value);
  setWidget(node, "ratio", "Custom");
  setWidget(node, "max_side_lock", false);
}

function ensureProperties(node) {
  node.properties = node.properties || {};
  node.properties.kooResolutionNextTheme = THEMES.includes(node.properties.kooResolutionNextTheme)
    ? node.properties.kooResolutionNextTheme
    : "Dark";
  node.properties.kooResolutionNextAccent = normalizeHex(node.properties.kooResolutionNextAccent) || DEFAULT_ACCENT;
  node.properties.kooResolutionNextAppearanceOpen = node.properties.kooResolutionNextAppearanceOpen !== false;
  node.properties.kooContrastMode = Boolean(node.properties.kooContrastMode);
}

function detachNativeWidgets(node, values) {
  const current = node.widgets || [];
  const byName = new Map();
  for (const item of [...(node._kooResolutionNextWidgets || []), ...current]) {
    if (item?.name && BACKEND_WIDGET_NAMES.includes(item.name) && !byName.has(item.name)) {
      byName.set(item.name, item);
    }
  }

  node._kooResolutionNextWidgets = BACKEND_WIDGET_NAMES.map((name) => byName.get(name)).filter(Boolean);

  if (Array.isArray(values)) {
    BACKEND_WIDGET_NAMES.forEach((name, index) => {
      const item = widget(node, name);
      if (item && values[index] !== undefined) {
        item.value = values[index];
      }
    });
  }

  for (const item of node._kooResolutionNextWidgets) {
    item.hidden = true;
    item.type = "hidden";
    item.serialize = item.serialize === false ? true : item.serialize;
    item.draw = () => {};
    item.computeSize = () => [0, 0];
  }

  node.widgets = node._kooResolutionNextWidgets;
}

function makeLayout(node) {
  const minWidth = 460;
  const width = Math.max(minWidth, node.size?.[0] || 620);
  const compact = width < 560;
  const x = compact ? 14 : 18;
  const right = width - x;
  let y = compact ? 14 : 18;
  const gap = compact ? 8 : 12;
  const sectionGap = compact ? 9 : 12;
  const hitboxes = [];
  const addHit = (kind, box, value) => hitboxes.push({ kind, value, ...box });
  const full = (height) => {
    const box = { x, y, w: right - x, h: height };
    y += height + sectionGap;
    return box;
  };

  const previewColumn = Math.min(compact ? 185 : 230, Math.max(compact ? 150 : 180, width * 0.34));
  const ratioColumnX = x + previewColumn + gap;
  const ratioColumnW = right - ratioColumnX;
  const topH = compact ? 200 : 208;
  const top = full(topH);
  const summary = { x, y: top.y, w: previewColumn, h: 64 };
  const preview = { x, y: top.y + (compact ? 74 : 78), w: previewColumn, h: compact ? 112 : 118 };
  const ratioTitle = { x: ratioColumnX, y: top.y + (compact ? 50 : 55), w: ratioColumnW, h: 20 };
  const ratioGrid = [];
  const cols = width < 560 ? 4 : 5;
  const btnGap = compact ? 5 : 6;
  const btnW = (ratioColumnW - btnGap * (cols - 1)) / cols;
  const btnH = compact ? 32 : 34;
  RATIO_LABELS.forEach((label, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const box = { x: ratioColumnX + col * (btnW + btnGap), y: top.y + (compact ? 78 : 84) + row * (btnH + 7), w: btnW, h: btnH };
    ratioGrid.push({ label, ...box });
    addHit("ratio", box, label);
  });

  const max = full(compact ? 76 : 80);
  const maxButtons = [];
  const lockW = compact ? 42 : 48;
  const maxPadX = compact ? 12 : 16;
  const maxPadTop = compact ? 31 : 33;
  const maxButtonH = compact ? 30 : 32;
  const maxInnerW = max.w - maxPadX * 2;
  const maxBtnW = Math.max(44, (maxInnerW - lockW - gap - btnGap * (MAX_SIDES.length - 1)) / MAX_SIDES.length);
  MAX_SIDES.forEach((value, index) => {
    const box = { x: max.x + maxPadX + index * (maxBtnW + btnGap), y: max.y + maxPadTop, w: maxBtnW, h: maxButtonH };
    maxButtons.push({ value, ...box });
    addHit("maxSide", box, value);
  });
  const lock = { x: max.x + max.w - maxPadX - lockW, y: max.y + maxPadTop, w: lockW, h: maxButtonH };
  addHit("lock", lock, null);

  const rowH = compact ? 74 : 78;
  const leftW = Math.round((right - x - gap) * (compact ? 0.64 : 0.66));
  const custom = { x, y, w: leftW, h: rowH };
  const scale = { x: x + leftW + gap, y, w: right - (x + leftW + gap), h: rowH };
  y += rowH + sectionGap;
  const innerPad = compact ? 12 : 16;
  const wField = { x: custom.x + innerPad, y: custom.y + 34, w: (custom.w - innerPad * 2 - 34) / 2, h: compact ? 32 : 34 };
  const hField = { x: wField.x + wField.w + 8, y: custom.y + 34, w: (custom.w - innerPad * 2 - 34) / 2, h: compact ? 32 : 34 };
  const swap = { x: custom.x + custom.w - innerPad - 26, y: custom.y + 34, w: 26, h: compact ? 32 : 34 };
  addHit("width", wField, null);
  addHit("height", hField, null);
  addHit("swap", swap, null);
  const scaleOne = { x: scale.x + innerPad, y: scale.y + 34, w: (scale.w - innerPad * 2 - 6) / 2, h: compact ? 32 : 34 };
  const scaleTwo = { x: scaleOne.x + scaleOne.w + 6, y: scale.y + 34, w: (scale.w - innerPad * 2 - 6) / 2, h: compact ? 32 : 34 };
  addHit("scale", scaleOne, "x1");
  addHit("scale", scaleTwo, "x2");

  const latent = { x, y, w: leftW, h: rowH };
  const batch = { x: x + leftW + gap, y, w: right - (x + leftW + gap), h: rowH };
  y += rowH + sectionGap;
  const latentButton = { x: latent.x + innerPad, y: latent.y + 34, w: latent.w - innerPad * 2, h: compact ? 32 : 34 };
  addHit("latent", latentButton, null);
  const stepW = compact ? 34 : 42;
  const minus = { x: batch.x + innerPad, y: batch.y + 34, w: stepW, h: compact ? 32 : 34 };
  const value = { x: minus.x + stepW + 6, y: batch.y + 34, w: Math.max(34, batch.w - innerPad * 2 - stepW * 2 - 12), h: compact ? 32 : 34 };
  const plus = { x: batch.x + batch.w - innerPad - stepW, y: batch.y + 34, w: stepW, h: compact ? 32 : 34 };
  addHit("batch", minus, -1);
  addHit("batch", plus, 1);

  const appearanceOpen = node.properties?.kooResolutionNextAppearanceOpen !== false;
  const swatchSize = compact ? 17 : 20;
  const swatchGap = compact ? 8 : 10;
  const appearancePad = compact ? 12 : 14;
  const appearanceLabelW = compact ? 54 : 64;
  const swatchAreaW = Math.max(160, right - x - appearancePad * 2 - appearanceLabelW);
  const swatchCols = Math.min(SWATCHES.length, Math.max(4, Math.floor((swatchAreaW + swatchGap) / (swatchSize + swatchGap))));
  const swatchRows = Math.ceil(SWATCHES.length / swatchCols);
  const swatchXRel = appearancePad + appearanceLabelW;
  const swatchRightRel = swatchXRel + (swatchCols - 1) * (swatchSize + swatchGap) + swatchSize;
  const actionW = (compact ? 48 : 56) + 12 + (compact ? 76 : 88);
  const actionsInline = swatchRightRel + 12 + actionW <= right - x - appearancePad;
  const actionYRel = actionsInline ? 75 : 76 + swatchRows * (swatchSize + 8) - 1;
  const appearanceHeight = appearanceOpen ? actionYRel + 18 + appearancePad : 44;
  const appearance = full(appearanceHeight);
  const collapse = { x: appearance.x + appearance.w - 38, y: appearance.y + 10, w: 28, h: 28 };
  addHit("appearanceToggle", collapse, null);
  const themeButtons = [];
  let contrastToggle = null;
  const swatches = [];
  let customAccent = null;
  let resetAccent = null;
  if (appearanceOpen) {
    const themeY = appearance.y + 42;
    const themeX = appearance.x + appearancePad + appearanceLabelW;
    const themeButtonGap = 6;
    const contrastW = compact ? 84 : 96;
    const themeRowW = appearance.w - appearancePad * 2 - appearanceLabelW;
    const themeButtonW = Math.min(64, (themeRowW - contrastW - 12 - themeButtonGap * 2) / 3);
    THEMES.forEach((name, index) => {
      const box = { x: themeX + index * (themeButtonW + themeButtonGap), y: themeY, w: themeButtonW, h: 28 };
      themeButtons.push({ name, ...box });
      addHit("theme", box, name);
    });
    contrastToggle = { x: themeX + 3 * (themeButtonW + themeButtonGap) + 6, y: themeY, w: contrastW, h: 28 };
    addHit("contrast", contrastToggle, null);
    const swatchX = appearance.x + appearancePad + appearanceLabelW;
    const swatchY = appearance.y + 76;
    SWATCHES.forEach((color, index) => {
      const col = index % swatchCols;
      const row = Math.floor(index / swatchCols);
      const box = { x: swatchX + col * (swatchSize + swatchGap), y: swatchY + row * (swatchSize + 8), w: swatchSize, h: swatchSize };
      swatches.push({ color, ...box });
      addHit("accent", box, color);
    });
    const actionY = appearance.y + actionYRel;
    const actionX = actionsInline ? swatchX + (swatchCols - 1) * (swatchSize + swatchGap) + swatchSize + 12 : swatchX;
    customAccent = { x: actionX, y: actionY, w: compact ? 48 : 56, h: 18 };
    resetAccent = { x: customAccent.x + customAccent.w + 12, y: actionY, w: compact ? 76 : 88, h: 18 };
    addHit("customAccent", customAccent, null);
    addHit("resetAccent", resetAccent, null);
  }

  const footer = { x, y: y - 4, w: right - x, h: 18 };
  const desiredHeight = Math.max(540, footer.y + footer.h + 14);
  return {
    width,
    desiredHeight,
    hitboxes,
    top,
    summary,
    preview,
    ratioTitle,
    ratioGrid,
    max,
    maxButtons,
    lock,
    custom,
    wField,
    hField,
    swap,
    scale,
    scaleOne,
    scaleTwo,
    latent,
    latentButton,
    batch,
    minus,
    value,
    plus,
    appearance,
    collapse,
    themeButtons,
    contrastToggle,
    swatches,
    customAccent,
    resetAccent,
    compact,
    footer,
  };
}

function drawRatioIcon(ctx, box, label, color) {
  const icon = { x: box.x + 12, y: box.y + box.h / 2 - 7, w: 16, h: 14 };
  let rw = 14;
  let rh = 14;
  if (RATIO_DEFAULTS[label]) {
    const [w, h] = RATIO_DEFAULTS[label];
    if (w >= h) {
      rw = 16;
      rh = Math.max(5, 16 * (h / w));
    } else {
      rh = 16;
      rw = Math.max(5, 16 * (w / h));
    }
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundedRect(ctx, icon.x + (16 - rw) / 2, icon.y + (16 - rh) / 2, rw, rh, 2);
  if (label === "Custom") {
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.stroke();
  }
}

function drawPreview(ctx, box, state, dims, tokens, accent) {
  drawRound(ctx, box, tokens.surface, tokens.border, 1, 7);
  ctx.save();
  ctx.beginPath();
  roundedRect(ctx, box.x, box.y, box.w, box.h, 7);
  ctx.clip();
  ctx.strokeStyle = hexToRgba(accent, 0.08);
  ctx.lineWidth = 1;
  for (let gx = box.x; gx < box.x + box.w; gx += 18) {
    ctx.beginPath();
    ctx.moveTo(gx, box.y);
    ctx.lineTo(gx, box.y + box.h);
    ctx.stroke();
  }
  for (let gy = box.y; gy < box.y + box.h; gy += 18) {
    ctx.beginPath();
    ctx.moveTo(box.x, gy);
    ctx.lineTo(box.x + box.w, gy);
    ctx.stroke();
  }
  const pad = 18;
  const availW = box.w - pad * 2;
  const availH = box.h - pad * 2;
  const ratio = dims.width / dims.height;
  let rectW = availW;
  let rectH = rectW / ratio;
  if (rectH > availH) {
    rectH = availH;
    rectW = rectH * ratio;
  }
  const rx = box.x + (box.w - rectW) / 2;
  const ry = box.y + (box.h - rectH) / 2;
  drawRound(ctx, { x: rx, y: ry, w: rectW, h: rectH }, hexToRgba(accent, 0.12), accent, 3, 2);
  drawText(ctx, state.ratio, box.x + box.w / 2, box.y + box.h / 2, 18, accent, "800", "center");
  ctx.restore();
}

function drawLockIcon(ctx, box, locked, color) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const bodyW = 18;
  const bodyH = 13;
  const bodyX = cx - bodyW / 2;
  const bodyY = cy - bodyH / 2 + 4;

  ctx.strokeStyle = color;
  ctx.fillStyle = hexToRgba(color, locked ? 0.18 : 0.08);
  ctx.lineWidth = 2;
  roundedRect(ctx, bodyX, bodyY, bodyW, bodyH, 3);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  if (locked) {
    ctx.moveTo(cx - 6, bodyY);
    ctx.lineTo(cx - 6, bodyY - 6);
    ctx.quadraticCurveTo(cx - 6, bodyY - 14, cx, bodyY - 14);
    ctx.quadraticCurveTo(cx + 6, bodyY - 14, cx + 6, bodyY - 6);
    ctx.lineTo(cx + 6, bodyY);
  } else {
    ctx.moveTo(cx - 6, bodyY);
    ctx.lineTo(cx - 6, bodyY - 6);
    ctx.quadraticCurveTo(cx - 6, bodyY - 14, cx, bodyY - 14);
    ctx.quadraticCurveTo(cx + 7, bodyY - 14, cx + 8, bodyY - 7);
    ctx.lineTo(cx + 12, bodyY - 7);
  }
  ctx.stroke();
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

function drawUI(node, ctx) {
  ensureProperties(node);
  const state = getState(node);
  const dims = finalDimensions(state);
  const accent = node.properties.kooResolutionNextAccent;
  const palette = getAccentPalette(node);
  const tokens = THEME_TOKENS[node.properties.kooResolutionNextTheme] || THEME_TOKENS.Dark;
  const layout = makeLayout(node);
  node._kooResolutionNextHitboxes = layout.hitboxes;

  if (!node.size || Math.abs(node.size[1] - layout.desiredHeight) > 2) {
    node.size = [layout.width, layout.desiredHeight];
  }

  drawRound(ctx, { x: 8, y: 8, w: layout.width - 16, h: layout.desiredHeight - 16 }, tokens.background, tokens.borderStrong, 1.5, 12);

  const mp = ((dims.width * dims.height) / 1000000).toFixed(2);
  drawText(ctx, `${dims.width} x ${dims.height}`, layout.summary.x, layout.summary.y + 26, layout.compact ? 27 : 31, tokens.text, "900");
  drawText(ctx, `${state.ratio}  -  ${mp} MP  -  Batch ${state.batch}`, layout.summary.x, layout.summary.y + 56, layout.compact ? 13 : 15, tokens.textMuted, "550");
  drawPreview(ctx, layout.preview, state, dims, tokens, accent);

  drawText(ctx, "ASPECT RATIO", layout.ratioTitle.x, layout.ratioTitle.y + 10, 13, tokens.textMuted, "800");
  for (const button of layout.ratioGrid) {
    const active = state.ratio === button.label;
    const activeText = activeForeground(palette, tokens.text);
    drawRound(ctx, button, active ? activeFill(palette, 0.2) : tokens.surface, active ? palette.accentBorder : tokens.border, active ? 2 : 1, 6);
    drawRatioIcon(ctx, button, button.label, active ? activeText : tokens.textSecondary);
    const labelX = button.x + (layout.compact ? 29 : 36);
    const labelSize = layout.compact ? 12 : 13;
    drawText(ctx, ellipsize(ctx, button.label, button.w - (layout.compact ? 32 : 39)), labelX, button.y + button.h / 2 + 1, labelSize, active ? activeText : tokens.textSecondary, active ? "850" : "650");
  }

  drawRound(ctx, layout.max, tokens.surface, tokens.border, 1, 7);
  drawText(ctx, "MAX SIDE", layout.max.x + 14, layout.max.y + 18, 13, tokens.textMuted, "800");
  drawText(ctx, state.locked ? "locked longest side" : "choose longest side value", layout.max.x + 90, layout.max.y + 18, 12, tokens.textMuted, "550");
  for (const button of layout.maxButtons) {
    const active = Number(state.maxSide) === button.value;
    drawRound(ctx, button, active ? activeFill(palette, 0.18) : tokens.surfaceRaised, active ? palette.accentBorder : tokens.border, active ? 2 : 1, 5);
    drawText(ctx, String(button.value), button.x + button.w / 2, button.y + button.h / 2 + 1, layout.compact ? 12 : 14, active ? activeForeground(palette, tokens.text) : tokens.textSecondary, active ? "850" : "650", "center");
  }
  drawRound(ctx, layout.lock, state.locked ? activeFill(palette, 0.2) : tokens.surfaceRaised, state.locked ? palette.accentBorder : tokens.border, state.locked ? 2 : 1, 5);
  drawLockIcon(ctx, layout.lock, state.locked, state.locked ? activeForeground(palette, accent) : tokens.textSecondary);

  drawRound(ctx, layout.custom, tokens.surface, tokens.border, 1, 7);
  drawText(ctx, "CUSTOM SIZE", layout.custom.x + 14, layout.custom.y + 18, 13, tokens.textMuted, "800");
  drawRound(ctx, layout.wField, tokens.background, tokens.border, 1, 5);
  drawRound(ctx, layout.hField, tokens.background, tokens.border, 1, 5);
  drawText(ctx, "W", layout.wField.x + 16, layout.wField.y + layout.wField.h / 2, 13, tokens.textSecondary, "800");
  drawText(ctx, String(dims.baseWidth), layout.wField.x + 50, layout.wField.y + layout.wField.h / 2 + 1, 15, tokens.text, "700");
  drawText(ctx, "H", layout.hField.x + 16, layout.hField.y + layout.hField.h / 2, 13, tokens.textSecondary, "800");
  drawText(ctx, String(dims.baseHeight), layout.hField.x + 50, layout.hField.y + layout.hField.h / 2 + 1, 15, tokens.text, "700");
  drawRound(ctx, layout.swap, tokens.surfaceRaised, tokens.border, 1, 5);
  drawText(ctx, "<>", layout.swap.x + layout.swap.w / 2, layout.swap.y + layout.swap.h / 2, 14, tokens.textSecondary, "800", "center");

  drawRound(ctx, layout.scale, tokens.surface, tokens.border, 1, 7);
  drawText(ctx, "SCALE", layout.scale.x + 14, layout.scale.y + 18, 13, tokens.textMuted, "800");
  for (const option of [{ box: layout.scaleOne, value: "x1" }, { box: layout.scaleTwo, value: "x2" }]) {
    const active = state.scale === option.value;
    drawRound(ctx, option.box, active ? activeFill(palette, 0.2) : tokens.surfaceRaised, active ? palette.accentBorder : tokens.border, active ? 2 : 1, 5);
    drawText(ctx, option.value.replace("x", "x "), option.box.x + option.box.w / 2, option.box.y + option.box.h / 2 + 1, 15, active ? activeForeground(palette, tokens.text) : tokens.textSecondary, "800", "center");
  }

  drawRound(ctx, layout.latent, tokens.surface, tokens.border, 1, 7);
  drawText(ctx, "LATENT MODE", layout.latent.x + 14, layout.latent.y + 18, 13, tokens.textMuted, "800");
  drawRound(ctx, layout.latentButton, tokens.background, tokens.border, 1, 5);
  drawText(ctx, ellipsize(ctx, state.latentMode, layout.latentButton.w - 40), layout.latentButton.x + layout.latentButton.w / 2, layout.latentButton.y + layout.latentButton.h / 2 + 1, 14, tokens.text, "700", "center");
  drawText(ctx, "v", layout.latentButton.x + layout.latentButton.w - 20, layout.latentButton.y + layout.latentButton.h / 2, 14, palette.accentSolid, "900", "center");

  drawRound(ctx, layout.batch, tokens.surface, tokens.border, 1, 7);
  drawText(ctx, "BATCH", layout.batch.x + 14, layout.batch.y + 18, 13, tokens.textMuted, "800");
  drawRound(ctx, layout.minus, tokens.surfaceRaised, tokens.border, 1, 5);
  drawRound(ctx, layout.value, palette.contrastMode ? palette.accentSolid : tokens.background, palette.contrastMode ? palette.accentBorder : tokens.border, 1, 5);
  drawRound(ctx, layout.plus, tokens.surfaceRaised, tokens.border, 1, 5);
  drawText(ctx, "-", layout.minus.x + layout.minus.w / 2, layout.minus.y + layout.minus.h / 2, 18, tokens.textSecondary, "800", "center");
  drawText(ctx, String(state.batch), layout.value.x + layout.value.w / 2, layout.value.y + layout.value.h / 2 + 1, 15, palette.contrastMode ? palette.accentForeground : palette.accentSolid, "900", "center");
  drawText(ctx, "+", layout.plus.x + layout.plus.w / 2, layout.plus.y + layout.plus.h / 2, 18, tokens.textSecondary, "800", "center");

  drawRound(ctx, layout.appearance, tokens.surface, tokens.border, 1, 7);
  drawPaletteIcon(ctx, layout.appearance.x + 14, layout.appearance.y + 13, accent, tokens);
  drawText(ctx, "APPEARANCE", layout.appearance.x + 42, layout.appearance.y + 22, 13, tokens.textMuted, "850");
  drawText(ctx, node.properties.kooResolutionNextAppearanceOpen ? "^" : "v", layout.collapse.x + layout.collapse.w / 2, layout.collapse.y + layout.collapse.h / 2, 15, tokens.textSecondary, "900", "center");
  if (node.properties.kooResolutionNextAppearanceOpen !== false) {
    drawText(ctx, "THEME", layout.appearance.x + (layout.compact ? 12 : 14), layout.appearance.y + 56, 12, tokens.textMuted, "850");
    for (const button of layout.themeButtons) {
      const active = node.properties.kooResolutionNextTheme === button.name;
      drawRound(ctx, button, active ? activeFill(palette, 0.16) : tokens.surfaceRaised, active ? palette.accentBorder : tokens.border, active ? 2 : 1, 5);
      drawText(ctx, button.name, button.x + button.w / 2, button.y + button.h / 2 + 1, layout.compact ? 12 : 13, active ? activeForeground(palette, tokens.text) : tokens.textSecondary, active ? "850" : "650", "center");
    }
    const contrastActive = Boolean(node.properties.kooContrastMode);
    drawRound(ctx, layout.contrastToggle, contrastActive ? activeFill(palette, 0.18) : tokens.surfaceRaised, contrastActive ? palette.accentBorder : tokens.border, contrastActive ? 2 : 1, 5);
    const knobSize = layout.compact ? 10 : 11;
    const knobX = layout.contrastToggle.x + layout.contrastToggle.w - 16;
    const knobY = layout.contrastToggle.y + layout.contrastToggle.h / 2;
    drawText(ctx, "Contrast", layout.contrastToggle.x + 8, layout.contrastToggle.y + layout.contrastToggle.h / 2 + 1, layout.compact ? 10 : 11, contrastActive ? activeForeground(palette, tokens.text) : tokens.textSecondary, "750");
    ctx.beginPath();
    ctx.arc(knobX, knobY, knobSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = contrastActive ? activeForeground(palette, tokens.text) : tokens.textMuted;
    ctx.fill();
    drawText(ctx, "ACCENT", layout.appearance.x + (layout.compact ? 12 : 14), layout.appearance.y + 85, 12, tokens.textMuted, "850");
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
  drawText(ctx, state.locked ? "Locked max side ensures consistent scaling across all aspect ratios." : "Unlocked ratios use clean default base mappings.", layout.footer.x + 2, layout.footer.y + 8, 12, tokens.textMuted, "500");
}

function handleClick(node, pos) {
  const hitboxes = node._kooResolutionNextHitboxes || makeLayout(node).hitboxes;
  const hit = hitboxes.find((box) => pos[0] >= box.x && pos[0] <= box.x + box.w && pos[1] >= box.y && pos[1] <= box.y + box.h);
  if (!hit) {
    return false;
  }
  const state = getState(node);
  switch (hit.kind) {
    case "ratio":
      applyRatio(node, hit.value);
      break;
    case "maxSide":
      applyMaxSide(node, hit.value);
      break;
    case "lock":
      toggleLock(node);
      break;
    case "width":
      manualSize(node, "width");
      break;
    case "height":
      manualSize(node, "height");
      break;
    case "swap":
      setWidget(node, "base_width", clampDimension(state.baseHeight));
      setWidget(node, "base_height", clampDimension(state.baseWidth));
      setWidget(node, "ratio", "Custom");
      setWidget(node, "max_side_lock", false);
      break;
    case "scale":
      setWidget(node, "scale", hit.value);
      break;
    case "latent": {
      const index = LATENT_MODES.indexOf(state.latentMode);
      setWidget(node, "latent_mode", LATENT_MODES[(index + 1) % LATENT_MODES.length]);
      break;
    }
    case "batch":
      setWidget(node, "batch_size", Math.max(1, Math.min(4096, state.batch + hit.value)));
      break;
    case "appearanceToggle":
      node.properties.kooResolutionNextAppearanceOpen = node.properties.kooResolutionNextAppearanceOpen === false;
      break;
    case "theme":
      node.properties.kooResolutionNextTheme = hit.value;
      break;
    case "contrast":
      node.properties.kooContrastMode = !node.properties.kooContrastMode;
      node._kooResolutionNextAccentPalette = null;
      break;
    case "accent":
      node.properties.kooResolutionNextAccent = hit.value;
      node._kooResolutionNextAccentPalette = null;
      break;
    case "customAccent": {
      const answer = prompt("Accent hex color", node.properties.kooResolutionNextAccent || DEFAULT_ACCENT);
      const color = normalizeHex(answer);
      if (color) {
        node.properties.kooResolutionNextAccent = color;
        node._kooResolutionNextAccentPalette = null;
      }
      break;
    }
    case "resetAccent":
      node.properties.kooResolutionNextAccent = DEFAULT_ACCENT;
      node._kooResolutionNextAccentPalette = null;
      break;
    default:
      return false;
  }
  node.setDirtyCanvas(true, true);
  return true;
}

app.registerExtension({
  name: "KoO.ResolutionNext",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) {
      return;
    }

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      ensureProperties(this);
      detachNativeWidgets(this);
      this.size = this.size || [620, 570];
      this.resizable = true;
      this.serialize_widgets = true;
      return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const result = onConfigure?.apply(this, arguments);
      ensureProperties(this);
      detachNativeWidgets(this, info?.widgets_values);
      return result;
    };

    const serialize = nodeType.prototype.serialize;
    nodeType.prototype.serialize = function () {
      const data = serialize?.apply(this, arguments) || {};
      data.widgets_values = BACKEND_WIDGET_NAMES.map((name) => widget(this, name)?.value);
      data.properties = { ...(data.properties || {}), ...(this.properties || {}) };
      return data;
    };

    nodeType.prototype.onDrawForeground = function (ctx) {
      detachNativeWidgets(this);
      drawUI(this, ctx);
    };

    const onMouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (event, pos, canvas) {
      if (handleClick(this, pos)) {
        return true;
      }
      return onMouseDown?.apply(this, arguments);
    };

    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      const result = onResize?.apply(this, arguments);
      this.setDirtyCanvas(true, true);
      return result;
    };
  },
});
