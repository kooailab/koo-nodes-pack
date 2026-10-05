import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";

const NODE_NAME = "KoO_LoadImageCropNext";
const EXTENSION_NAME = "koo.loadImageCropNext.final";

const DEFAULT_ACCENT = "#FF4FA3";
const FONT_STACK = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
const TOKENS = {
  background: "#15161A",
  surface: "#22242A",
  surfaceRaised: "#2D3037",
  surfaceHover: "#373A43",
  text: "#FFFFFF",
  textSecondary: "#CED1D8",
  textMuted: "#8D929C",
  border: "#444852",
  borderStrong: "#5A5F6B",
};
const PALETTE = {
  accentSolid: DEFAULT_ACCENT,
  accentBorder: DEFAULT_ACCENT,
  accentTint: "rgba(255,79,163,0.20)",
  accentTintStrong: "rgba(255,79,163,0.28)",
};

const CROP_RATIOS = ["Free", "1:1", "4:5", "3:4", "2:3", "16:9", "9:16", "Custom"];
const BACKEND_WIDGET_NAMES = [
  "image",
  "crop_ratio",
  "ratio_width",
  "ratio_height",
  "crop_x",
  "crop_y",
  "crop_width",
  "crop_height",
  "crop_enabled",
  "crop_confirmed",
];

const DEFAULT_WIDTH = 660;
const DEFAULT_HEIGHT = 705;
const MIN_WIDTH = 540;
const MIN_PREVIEW_HEIGHT = 320;
const HANDLE_SIZE = 10;
const EDGE_HIT = 9;

function markDirty(node) {
  node.setDirtyCanvas?.(true, true);
  app.graph?.setDirtyCanvas?.(true, true);
  app.graph?.change?.();
}

function backendWidgets(node) {
  return node._kooLoadImageCropNextWidgets || node.widgets || [];
}

function findWidget(node, name) {
  return backendWidgets(node).find((widget) => widget?.name === name) || null;
}

function widgetValue(node, name, fallback = 0) {
  const widget = findWidget(node, name);
  return widget ? widget.value : fallback;
}

function setWidgetValue(node, name, value) {
  const widget = findWidget(node, name);
  if (!widget || widget.value === value) return;
  widget.value = value;
  widget.callback?.call(widget, value, app.canvas, node, app.canvas?.graph_mouse);
  markDirty(node);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(Number(value) || 0, max));
}

function positiveInt(value, fallback = 0) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function positiveFloat(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function boolValue(node, name) {
  return Boolean(widgetValue(node, name, false));
}

function normalizeRatioValue(value) {
  return CROP_RATIOS.includes(value) ? value : "Free";
}

function ratioFromWidgets(node) {
  const ratio = normalizeRatioValue(widgetValue(node, "crop_ratio", "Free"));
  if (ratio === "Free") return null;
  if (ratio === "Custom") {
    const rw = positiveFloat(widgetValue(node, "ratio_width", 4), 4);
    const rh = positiveFloat(widgetValue(node, "ratio_height", 5), 5);
    return rw / rh;
  }
  const [rw, rh] = ratio.split(":").map(Number);
  return rw / rh;
}

function formatNumber(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/, "");
}

function suppressDefaultPreview(node) {
  node.imgs = [];
  node.imageIndex = null;
  node.overIndex = null;
}

function legacyValuesToCurrent(values) {
  const next = {
    image: values[0],
    crop_ratio: "Free",
    ratio_width: 4,
    ratio_height: 5,
    crop_x: 0,
    crop_y: 0,
    crop_width: 0,
    crop_height: 0,
    crop_enabled: false,
    crop_confirmed: false,
  };

  if (values.length === 13) {
    next.crop_ratio = normalizeRatioValue(values[1]);
    next.ratio_width = positiveFloat(values[2], 4);
    next.ratio_height = positiveFloat(values[3], 5);
    next.crop_x = values[7] ?? 0;
    next.crop_y = values[8] ?? 0;
    next.crop_width = values[9] ?? 0;
    next.crop_height = values[10] ?? 0;
    next.crop_enabled = Boolean(values[11]);
    next.crop_confirmed = Boolean(values[12]);
    return BACKEND_WIDGET_NAMES.map((name) => next[name]);
  }

  if (values.length === 11 || values.length === 8) {
    const legacyWidth = positiveFloat(values[2], 0);
    const legacyHeight = positiveFloat(values[3], 0);
    const legacyLocked = Boolean(values[4]);
    if (legacyLocked && legacyWidth > 0 && legacyHeight > 0) {
      next.crop_ratio = "Custom";
      next.ratio_width = legacyWidth;
      next.ratio_height = legacyHeight;
    }
    const offset = values.length === 11 ? 5 : 4;
    next.crop_x = values[offset] ?? 0;
    next.crop_y = values[offset + 1] ?? 0;
    next.crop_width = values[offset + 2] ?? 0;
    next.crop_height = values[offset + 3] ?? 0;
    next.crop_enabled = values.length === 11 ? Boolean(values[9]) : next.crop_width > 0 && next.crop_height > 0;
    next.crop_confirmed = values.length === 11 ? Boolean(values[10]) : next.crop_enabled;
  }
  return BACKEND_WIDGET_NAMES.map((name) => next[name]);
}

function detachNativeWidgets(node, values) {
  const current = [...(node._kooLoadImageCropNextWidgets || []), ...(node.widgets || [])];
  const byName = new Map();
  for (const item of current) {
    if (item?.name && BACKEND_WIDGET_NAMES.includes(item.name) && !byName.has(item.name)) {
      byName.set(item.name, item);
    }
  }

  node._kooLoadImageCropNextWidgets = BACKEND_WIDGET_NAMES.map((name) => byName.get(name)).filter(Boolean);

  if (Array.isArray(values)) {
    const mappedValues = values.length === BACKEND_WIDGET_NAMES.length ? values : legacyValuesToCurrent(values);
    BACKEND_WIDGET_NAMES.forEach((name, index) => {
      const widget = byName.get(name);
      if (widget && mappedValues[index] !== undefined) widget.value = mappedValues[index];
    });
  }

  for (const item of node._kooLoadImageCropNextWidgets) {
    item.hidden = true;
    item.type = "hidden";
    item.serialize = item.serialize === false ? true : item.serialize;
    item.draw = () => {};
    item.computeSize = () => [0, 0];
  }
  node.widgets = node._kooLoadImageCropNextWidgets;
}

function ensureProperties(node) {
  node.properties = node.properties || {};
  node.properties.kooLoadImageCropNext = node.properties.kooLoadImageCropNext || {};
  const props = node.properties.kooLoadImageCropNext;
  props.advancedOpen = Boolean(props.advancedOpen);
}

function ensureState(node) {
  if (!node.kooLoadImageCropNext) {
    node.kooLoadImageCropNext = {
      image: null,
      imageValue: undefined,
      imageReady: false,
      layout: null,
      hitboxes: [],
      drag: null,
      hoverPos: null,
    };
  }
  ensureProperties(node);
  return node.kooLoadImageCropNext;
}

function imageValueToViewUrl(value) {
  if (!value) return null;
  let type = "input";
  let path = String(value);
  const slashAnnotation = path.match(/^(.*)\/\[(input|output|temp)\]$/);
  const spaceAnnotation = path.match(/^(.*)\s+\[(input|output|temp)\]$/);
  if (slashAnnotation) {
    path = slashAnnotation[1];
    type = slashAnnotation[2];
  } else if (spaceAnnotation) {
    path = spaceAnnotation[1];
    type = spaceAnnotation[2];
  }
  path = path.replace(/\\/g, "/");
  const parts = path.split("/");
  const filename = parts.pop();
  const subfolder = parts.join("/");
  return api.apiURL(`/view?${new URLSearchParams({ filename, type, subfolder, rand: Math.random().toString() })}`);
}

function sourceSize(node) {
  const state = ensureState(node);
  if (!state.imageReady || !state.image) return null;
  return { width: state.image.naturalWidth, height: state.image.naturalHeight };
}

function fullCrop(node) {
  const size = sourceSize(node);
  return size ? { x: 0, y: 0, w: size.width, h: size.height } : { x: 0, y: 0, w: 0, h: 0 };
}

function cropIsActive(node) {
  return boolValue(node, "crop_enabled") && boolValue(node, "crop_confirmed");
}

function clampCrop(crop, imageWidth, imageHeight) {
  const width = Math.max(1, Math.min(Math.round(crop.w || 1), imageWidth));
  const height = Math.max(1, Math.min(Math.round(crop.h || 1), imageHeight));
  const x = Math.max(0, Math.min(Math.round(crop.x || 0), imageWidth - width));
  const y = Math.max(0, Math.min(Math.round(crop.y || 0), imageHeight - height));
  return { x, y, w: width, h: height };
}

function cropFromWidgets(node) {
  const size = sourceSize(node);
  if (!size) return { x: 0, y: 0, w: 0, h: 0 };
  if (!cropIsActive(node)) return fullCrop(node);
  const crop = {
    x: positiveInt(widgetValue(node, "crop_x", 0)),
    y: positiveInt(widgetValue(node, "crop_y", 0)),
    w: positiveInt(widgetValue(node, "crop_width", 0)),
    h: positiveInt(widgetValue(node, "crop_height", 0)),
  };
  if (crop.w <= 0 || crop.h <= 0) return fullCrop(node);
  return clampCrop(crop, size.width, size.height);
}

function setCropActive(node, active) {
  setWidgetValue(node, "crop_enabled", active);
  setWidgetValue(node, "crop_confirmed", active);
}

function persistCrop(node, crop, active = true) {
  const size = sourceSize(node);
  if (!size) return;
  const clean = clampCrop(crop, size.width, size.height);
  setWidgetValue(node, "crop_x", clean.x);
  setWidgetValue(node, "crop_y", clean.y);
  setWidgetValue(node, "crop_width", clean.w);
  setWidgetValue(node, "crop_height", clean.h);
  setCropActive(node, active);
  node.properties.kooLoadImageCropNext.crop = { ...clean };
  markDirty(node);
}

function clearCrop(node) {
  setWidgetValue(node, "crop_x", 0);
  setWidgetValue(node, "crop_y", 0);
  setWidgetValue(node, "crop_width", 0);
  setWidgetValue(node, "crop_height", 0);
  setCropActive(node, false);
  setWidgetValue(node, "crop_ratio", "Free");
  node.properties.kooLoadImageCropNext.crop = { x: 0, y: 0, w: 0, h: 0 };
  markDirty(node);
}

function fitRatioCrop(imageWidth, imageHeight, ratio) {
  let width = imageWidth;
  let height = Math.round(width / ratio);
  if (height > imageHeight) {
    height = imageHeight;
    width = Math.round(height * ratio);
  }
  width = Math.max(1, Math.min(imageWidth, width));
  height = Math.max(1, Math.min(imageHeight, height));
  return {
    x: Math.round((imageWidth - width) / 2),
    y: Math.round((imageHeight - height) / 2),
    w: width,
    h: height,
  };
}

function adaptCropToRatio(node, crop, ratio) {
  const size = sourceSize(node);
  if (!size || !ratio) return crop;
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  let width = crop.w;
  let height = Math.round(width / ratio);
  if (height > crop.h) {
    height = crop.h;
    width = Math.round(height * ratio);
  }
  width = Math.max(1, Math.min(size.width, width));
  height = Math.max(1, Math.min(size.height, height));
  return clampCrop({ x: cx - width / 2, y: cy - height / 2, w: width, h: height }, size.width, size.height);
}

function applySelectedRatio(node) {
  const size = sourceSize(node);
  const ratio = ratioFromWidgets(node);
  if (!size || !ratio) {
    markDirty(node);
    return;
  }
  const base = cropIsActive(node) ? cropFromWidgets(node) : fullCrop(node);
  persistCrop(node, adaptCropToRatio(node, base, ratio), true);
}

function loadPreviewImage(node) {
  const state = ensureState(node);
  suppressDefaultPreview(node);
  const value = widgetValue(node, "image", null);
  if (value === state.imageValue) return;
  state.imageValue = value;
  state.image = null;
  state.imageReady = false;
  state.drag = null;
  const url = imageValueToViewUrl(value);
  if (!url) {
    markDirty(node);
    return;
  }
  const image = new Image();
  image.onload = () => {
    state.image = image;
    state.imageReady = true;
    const size = sourceSize(node);
    if (size && cropIsActive(node)) persistCrop(node, cropFromWidgets(node), true);
    applySelectedRatio(node);
    markDirty(node);
  };
  image.onerror = () => {
    state.image = null;
    state.imageReady = false;
    markDirty(node);
  };
  image.src = url;
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
  let value = String(text ?? "");
  if (ctx.measureText(value).width <= maxWidth) return value;
  while (value.length > 3 && ctx.measureText(`${value.slice(0, -1)}...`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}...`;
}

function pointInRect(point, rect) {
  return Boolean(point && rect) && point[0] >= rect.x && point[0] <= rect.x + rect.w && point[1] >= rect.y && point[1] <= rect.y + rect.h;
}

function makeLayout(node) {
  ensureProperties(node);
  const width = Math.max(MIN_WIDTH, node.size?.[0] || DEFAULT_WIDTH);
  const x = width < 590 ? 14 : 18;
  const right = width - x - 48;
  const contentW = Math.max(420, right - x);
  const gap = width < 590 ? 8 : 10;
  const hitboxes = [];
  const advancedOpen = node.properties.kooLoadImageCropNext.advancedOpen;
  const customRatioOpen = normalizeRatioValue(widgetValue(node, "crop_ratio", "Free")) === "Custom";
  const previewBottomFixed =
    12 + 34 +
    10 + 34 +
    10 + 34 +
    (customRatioOpen ? 8 + 34 : 0) +
    10 + 24 +
    10 + (advancedOpen ? 86 : 38) +
    16;
  const desiredHeight = Math.max(DEFAULT_HEIGHT, 38 + MIN_PREVIEW_HEIGHT + previewBottomFixed);
  const height = Math.max(desiredHeight, node.size?.[1] || DEFAULT_HEIGHT);
  const previewH = Math.max(MIN_PREVIEW_HEIGHT, height - 38 - previewBottomFixed);
  let y = 38;
  const previewBox = { x, y, w: contentW, h: previewH };
  y += previewH + 12;

  let imageRect = { ...previewBox };
  const state = ensureState(node);
  if (state.imageReady && state.image?.naturalWidth && state.image?.naturalHeight) {
    const scale = Math.min(previewBox.w / state.image.naturalWidth, previewBox.h / state.image.naturalHeight);
    const drawnW = Math.max(1, state.image.naturalWidth * scale);
    const drawnH = Math.max(1, state.image.naturalHeight * scale);
    imageRect = {
      x: previewBox.x + (previewBox.w - drawnW) / 2,
      y: previewBox.y + (previewBox.h - drawnH) / 2,
      w: drawnW,
      h: drawnH,
    };
  }

  const selector = { x, y, w: contentW, h: 34 };
  const uploadW = 84;
  const fileField = { x, y, w: selector.w - uploadW - gap, h: 34 };
  const upload = { x: x + selector.w - uploadW, y, w: uploadW, h: 34 };
  hitboxes.push({ kind: "file", ...fileField }, { kind: "upload", ...upload });
  y += 44;

  const buttonW = (contentW - gap) / 2;
  const cropButton = { x, y, w: buttonW, h: 34 };
  const resetButton = { x: x + buttonW + gap, y, w: buttonW, h: 34 };
  hitboxes.push({ kind: "cropButton", ...cropButton }, { kind: "resetButton", ...resetButton });
  y += 44;

  const labelW = width < 590 ? 96 : 116;
  const rowField = { x: x + labelW, y, w: contentW - labelW, h: 34 };
  const ratioRow = { x, y, w: contentW, h: 34, field: rowField };
  hitboxes.push({ kind: "ratioMenu", ...rowField });
  y += 34;

  let customRatio = null;
  if (customRatioOpen) {
    y += 8;
    const fieldW = (contentW - labelW - gap) / 2;
    customRatio = {
      row: { x, y, w: contentW, h: 34 },
      ratioW: { x: x + labelW, y, w: fieldW, h: 34 },
      ratioH: { x: x + labelW + fieldW + gap, y, w: fieldW, h: 34 },
    };
    hitboxes.push({ kind: "ratioWidth", ...customRatio.ratioW }, { kind: "ratioHeight", ...customRatio.ratioH });
    y += 34;
  }
  y += 10;

  const status = { x, y, w: contentW, h: 24 };
  y += 34;

  const advanced = { x, y, w: contentW, h: advancedOpen ? 86 : 38 };
  hitboxes.push({ kind: "advancedToggle", x: advanced.x, y: advanced.y, w: advanced.w, h: 38 });
  const advancedFields = [];
  if (advancedOpen) {
    const fieldW = (advanced.w - 28 - gap * 3) / 4;
    const rowY = advanced.y + 44;
    [
      ["cropX", "X"],
      ["cropY", "Y"],
      ["cropW", "W"],
      ["cropH", "H"],
    ].forEach(([kind, label], index) => {
      const box = { kind, label, x: advanced.x + 14 + index * (fieldW + gap), y: rowY, w: fieldW, h: 30 };
      advancedFields.push(box);
      hitboxes.push(box);
    });
  }

  return {
    width,
    height,
    desiredHeight,
    previewBox,
    imageRect,
    fileField,
    upload,
    cropButton,
    resetButton,
    ratioRow,
    customRatio,
    status,
    advanced,
    advancedFields,
    hitboxes,
  };
}

function imageToPreview(node, crop) {
  const rect = ensureState(node).layout?.imageRect;
  const size = sourceSize(node);
  if (!rect || !size) return null;
  return {
    x: rect.x + crop.x * (rect.w / size.width),
    y: rect.y + crop.y * (rect.h / size.height),
    w: crop.w * (rect.w / size.width),
    h: crop.h * (rect.h / size.height),
  };
}

function previewToImage(node, point) {
  const rect = ensureState(node).layout?.imageRect;
  const size = sourceSize(node);
  if (!rect || !size) return null;
  return {
    x: Math.round(clamp(((point[0] - rect.x) / rect.w) * size.width, 0, size.width)),
    y: Math.round(clamp(((point[1] - rect.y) / rect.h) * size.height, 0, size.height)),
  };
}

function cropHandles(rect) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  return [
    { name: "nw", x: rect.x, y: rect.y },
    { name: "n", x: cx, y: rect.y },
    { name: "ne", x: right, y: rect.y },
    { name: "e", x: right, y: cy },
    { name: "se", x: right, y: bottom },
    { name: "s", x: cx, y: bottom },
    { name: "sw", x: rect.x, y: bottom },
    { name: "w", x: rect.x, y: cy },
  ];
}

function hitCrop(node, point) {
  const crop = cropFromWidgets(node);
  const rect = imageToPreview(node, crop);
  if (!rect || !cropIsActive(node)) return null;
  for (const handle of cropHandles(rect)) {
    if (Math.abs(point[0] - handle.x) <= EDGE_HIT && Math.abs(point[1] - handle.y) <= EDGE_HIT) {
      return { kind: "resize", handle: handle.name, crop };
    }
  }
  const nearLeft = Math.abs(point[0] - rect.x) <= EDGE_HIT;
  const nearRight = Math.abs(point[0] - (rect.x + rect.w)) <= EDGE_HIT;
  const nearTop = Math.abs(point[1] - rect.y) <= EDGE_HIT;
  const nearBottom = Math.abs(point[1] - (rect.y + rect.h)) <= EDGE_HIT;
  if (point[1] >= rect.y && point[1] <= rect.y + rect.h) {
    if (nearLeft) return { kind: "resize", handle: "w", crop };
    if (nearRight) return { kind: "resize", handle: "e", crop };
  }
  if (point[0] >= rect.x && point[0] <= rect.x + rect.w) {
    if (nearTop) return { kind: "resize", handle: "n", crop };
    if (nearBottom) return { kind: "resize", handle: "s", crop };
  }
  if (pointInRect(point, rect)) return { kind: "move", crop };
  return null;
}

function resizeFreeform(start, handle, point, imageWidth, imageHeight) {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle.includes("w")) left = clamp(point.x, 0, right - 1);
  if (handle.includes("e")) right = clamp(point.x, left + 1, imageWidth);
  if (handle.includes("n")) top = clamp(point.y, 0, bottom - 1);
  if (handle.includes("s")) bottom = clamp(point.y, top + 1, imageHeight);
  return clampCrop({ x: left, y: top, w: right - left, h: bottom - top }, imageWidth, imageHeight);
}

function resizeLocked(start, handle, point, imageWidth, imageHeight, ratio) {
  const left = start.x;
  const top = start.y;
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  const centerX = start.x + start.w / 2;
  const centerY = start.y + start.h / 2;

  const fromCenterWidth = (width) => {
    const w = Math.max(1, Math.min(imageWidth, Math.round(width)));
    const h = Math.max(1, Math.min(imageHeight, Math.round(w / ratio)));
    return clampCrop({ x: centerX - w / 2, y: centerY - h / 2, w, h }, imageWidth, imageHeight);
  };
  if (handle === "e") return clampCrop({ x: left, y: centerY - (point.x - left) / ratio / 2, w: point.x - left, h: (point.x - left) / ratio }, imageWidth, imageHeight);
  if (handle === "w") return clampCrop({ x: point.x, y: centerY - (right - point.x) / ratio / 2, w: right - point.x, h: (right - point.x) / ratio }, imageWidth, imageHeight);
  if (handle === "s") return fromCenterWidth((point.y - top) * ratio);
  if (handle === "n") return fromCenterWidth((bottom - point.y) * ratio);

  const anchor = {
    nw: { x: right, y: bottom, sx: -1, sy: -1 },
    ne: { x: left, y: bottom, sx: 1, sy: -1 },
    se: { x: left, y: top, sx: 1, sy: 1 },
    sw: { x: right, y: top, sx: -1, sy: 1 },
  }[handle];
  if (!anchor) return start;
  const desiredW = Math.max(1, Math.abs(point.x - anchor.x));
  const desiredHWidth = Math.max(1, Math.abs(point.y - anchor.y) * ratio);
  const width = Math.max(desiredW, desiredHWidth);
  const height = width / ratio;
  const x = anchor.sx < 0 ? anchor.x - width : anchor.x;
  const y = anchor.sy < 0 ? anchor.y - height : anchor.y;
  return clampCrop({ x, y, w: width, h: height }, imageWidth, imageHeight);
}

function cropFromPoints(a, b, imageWidth, imageHeight, ratio) {
  if (!ratio) {
    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    return clampCrop({ x: left, y: top, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }, imageWidth, imageHeight);
  }
  const sx = b.x >= a.x ? 1 : -1;
  const sy = b.y >= a.y ? 1 : -1;
  let width = Math.max(1, Math.abs(b.x - a.x));
  let height = Math.max(1, width / ratio);
  if (height > Math.abs(b.y - a.y)) {
    height = Math.max(1, Math.abs(b.y - a.y));
    width = height * ratio;
  }
  return clampCrop({ x: sx > 0 ? a.x : a.x - width, y: sy > 0 ? a.y : a.y - height, w: width, h: height }, imageWidth, imageHeight);
}

function updateDrag(node, pos) {
  const state = ensureState(node);
  const size = sourceSize(node);
  const drag = state.drag;
  if (!drag || !size) return false;
  const point = previewToImage(node, pos);
  if (!point) return true;
  if (drag.kind === "create") {
    persistCrop(node, cropFromPoints(drag.startPoint, point, size.width, size.height, ratioFromWidgets(node)));
    return true;
  }
  if (drag.kind === "move") {
    persistCrop(node, {
      x: drag.startCrop.x + point.x - drag.startPoint.x,
      y: drag.startCrop.y + point.y - drag.startPoint.y,
      w: drag.startCrop.w,
      h: drag.startCrop.h,
    });
    return true;
  }
  const ratio = ratioFromWidgets(node);
  persistCrop(node, ratio ? resizeLocked(drag.startCrop, drag.handle, point, size.width, size.height, ratio) : resizeFreeform(drag.startCrop, drag.handle, point, size.width, size.height));
  return true;
}

function drawButton(ctx, box, label, active = false, hover = false) {
  const fill = active ? PALETTE.accentTint : hover ? TOKENS.surfaceHover : TOKENS.surfaceRaised;
  const stroke = active || hover ? PALETTE.accentBorder : TOKENS.border;
  drawRound(ctx, box, fill, stroke, active ? 2 : 1, 5);
  drawText(ctx, label, box.x + box.w / 2, box.y + box.h / 2 + 1, 13, active ? TOKENS.text : TOKENS.textSecondary, active ? "850" : "650", "center");
}

function drawField(ctx, box, label, value, hover = false, active = false) {
  drawRound(ctx, box, active ? PALETTE.accentTint : hover ? TOKENS.surfaceHover : TOKENS.background, active ? PALETTE.accentBorder : TOKENS.border, active ? 2 : 1, 5);
  drawText(ctx, label, box.x + 12, box.y + box.h / 2 + 1, 12, active ? TOKENS.text : TOKENS.textMuted, "800");
  drawText(ctx, ellipsize(ctx, String(value), box.w - 80), box.x + box.w - 26, box.y + box.h / 2 + 1, 13, active ? TOKENS.text : TOKENS.textSecondary, active ? "800" : "650", "right");
  drawText(ctx, "v", box.x + box.w - 13, box.y + box.h / 2, 13, PALETTE.accentSolid, "900", "center");
}

function drawCropOverlay(ctx, imageRect, cropRect) {
  const right = cropRect.x + cropRect.w;
  const bottom = cropRect.y + cropRect.h;
  const imageRight = imageRect.x + imageRect.w;
  const imageBottom = imageRect.y + imageRect.h;
  ctx.fillStyle = "rgba(0,0,0,0.54)";
  ctx.fillRect(imageRect.x, imageRect.y, imageRect.w, Math.max(0, cropRect.y - imageRect.y));
  ctx.fillRect(imageRect.x, bottom, imageRect.w, Math.max(0, imageBottom - bottom));
  ctx.fillRect(imageRect.x, cropRect.y, Math.max(0, cropRect.x - imageRect.x), Math.max(0, cropRect.h));
  ctx.fillRect(right, cropRect.y, Math.max(0, imageRight - right), Math.max(0, cropRect.h));
}

function drawCropBox(ctx, imageRect, cropRect) {
  drawCropOverlay(ctx, imageRect, cropRect);
  ctx.save();
  ctx.strokeStyle = PALETTE.accentSolid;
  ctx.lineWidth = 2;
  ctx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
  for (const handle of cropHandles(cropRect)) {
    drawRound(ctx, { x: handle.x - HANDLE_SIZE / 2, y: handle.y - HANDLE_SIZE / 2, w: HANDLE_SIZE, h: HANDLE_SIZE }, TOKENS.background, PALETTE.accentSolid, 2, 3);
  }
  ctx.restore();
}

function statusText(node) {
  const size = sourceSize(node);
  if (!size) return "Select or upload an image";
  const crop = cropFromWidgets(node);
  return `Original ${size.width}x${size.height} -> Crop ${crop.w}x${crop.h}`;
}

function drawUI(node, ctx) {
  const state = ensureState(node);
  suppressDefaultPreview(node);
  loadPreviewImage(node);
  const layout = makeLayout(node);
  state.layout = layout;
  state.hitboxes = layout.hitboxes;

  if (!node.size || node.size[0] < MIN_WIDTH || node.size[1] < layout.desiredHeight) {
    node.size = [Math.max(MIN_WIDTH, node.size?.[0] || DEFAULT_WIDTH), Math.max(layout.desiredHeight, node.size?.[1] || DEFAULT_HEIGHT)];
  }

  const hover = state.hoverPos || [-1, -1];
  drawRound(ctx, { x: 8, y: 8, w: layout.width - 16, h: layout.height - 16 }, TOKENS.background, TOKENS.borderStrong, 1.5, 12);
  drawRound(ctx, layout.previewBox, TOKENS.surface, TOKENS.border, 1, 7);
  ctx.save();
  roundedRect(ctx, layout.previewBox.x, layout.previewBox.y, layout.previewBox.w, layout.previewBox.h, 7);
  ctx.clip();
  if (state.imageReady && state.image) {
    ctx.drawImage(state.image, layout.imageRect.x, layout.imageRect.y, layout.imageRect.w, layout.imageRect.h);
    const previewCrop = imageToPreview(node, cropFromWidgets(node));
    if (previewCrop) drawCropBox(ctx, layout.imageRect, previewCrop);
  } else {
    ctx.strokeStyle = "rgba(255,79,163,0.08)";
    ctx.lineWidth = 1;
    for (let gx = layout.previewBox.x; gx < layout.previewBox.x + layout.previewBox.w; gx += 18) {
      ctx.beginPath();
      ctx.moveTo(gx, layout.previewBox.y);
      ctx.lineTo(gx, layout.previewBox.y + layout.previewBox.h);
      ctx.stroke();
    }
    for (let gy = layout.previewBox.y; gy < layout.previewBox.y + layout.previewBox.h; gy += 18) {
      ctx.beginPath();
      ctx.moveTo(layout.previewBox.x, gy);
      ctx.lineTo(layout.previewBox.x + layout.previewBox.w, gy);
      ctx.stroke();
    }
    drawText(ctx, "Select or upload an image", layout.previewBox.x + layout.previewBox.w / 2, layout.previewBox.y + layout.previewBox.h / 2, 13, TOKENS.textMuted, "650", "center");
  }
  ctx.restore();

  drawRound(ctx, layout.fileField, TOKENS.surface, TOKENS.border, 1, 5);
  drawText(ctx, "Image", layout.fileField.x + 12, layout.fileField.y + layout.fileField.h / 2, 12, TOKENS.textMuted, "800");
  drawText(ctx, ellipsize(ctx, widgetValue(node, "image", "") || "Select image", layout.fileField.w - 100), layout.fileField.x + 72, layout.fileField.y + layout.fileField.h / 2 + 1, 13, TOKENS.text, "650");
  drawText(ctx, "v", layout.fileField.x + layout.fileField.w - 18, layout.fileField.y + layout.fileField.h / 2, 14, PALETTE.accentSolid, "900", "center");
  drawButton(ctx, layout.upload, "Upload", false, pointInRect(hover, layout.upload));

  drawButton(ctx, layout.cropButton, "Crop", cropIsActive(node), pointInRect(hover, layout.cropButton));
  drawButton(ctx, layout.resetButton, "Reset Crop", false, pointInRect(hover, layout.resetButton));

  drawText(ctx, "Crop Ratio", layout.ratioRow.x, layout.ratioRow.y + layout.ratioRow.h / 2 + 1, 13, TOKENS.textMuted, "800");
  drawField(ctx, layout.ratioRow.field, "", normalizeRatioValue(widgetValue(node, "crop_ratio", "Free")), pointInRect(hover, layout.ratioRow.field), normalizeRatioValue(widgetValue(node, "crop_ratio", "Free")) !== "Free");
  if (layout.customRatio) {
    drawText(ctx, "Custom", layout.customRatio.row.x, layout.customRatio.row.y + layout.customRatio.row.h / 2 + 1, 13, TOKENS.textMuted, "800");
    drawField(ctx, layout.customRatio.ratioW, "W", formatNumber(positiveFloat(widgetValue(node, "ratio_width", 4), 4)), pointInRect(hover, layout.customRatio.ratioW), true);
    drawField(ctx, layout.customRatio.ratioH, "H", formatNumber(positiveFloat(widgetValue(node, "ratio_height", 5), 5)), pointInRect(hover, layout.customRatio.ratioH), true);
  }

  drawRound(ctx, layout.status, TOKENS.surface, TOKENS.border, 1, 5);
  drawText(ctx, ellipsize(ctx, statusText(node), layout.status.w - 18), layout.status.x + 9, layout.status.y + layout.status.h / 2 + 1, 12, TOKENS.textSecondary, "550");

  drawRound(ctx, layout.advanced, TOKENS.surface, TOKENS.border, 1, 7);
  drawText(ctx, "ADVANCED", layout.advanced.x + 14, layout.advanced.y + 19, 12, TOKENS.textMuted, "850");
  drawText(ctx, node.properties.kooLoadImageCropNext.advancedOpen ? "^" : "v", layout.advanced.x + layout.advanced.w - 22, layout.advanced.y + 19, 15, TOKENS.textSecondary, "900", "center");
  for (const field of layout.advancedFields) {
    const values = {
      cropX: positiveInt(widgetValue(node, "crop_x", 0)),
      cropY: positiveInt(widgetValue(node, "crop_y", 0)),
      cropW: cropIsActive(node) ? positiveInt(widgetValue(node, "crop_width", 0)) : 0,
      cropH: cropIsActive(node) ? positiveInt(widgetValue(node, "crop_height", 0)) : 0,
    };
    drawRound(ctx, field, pointInRect(hover, field) ? TOKENS.surfaceHover : TOKENS.surfaceRaised, TOKENS.border, 1, 5);
    drawText(ctx, field.label, field.x + 10, field.y + field.h / 2, 11, TOKENS.textMuted, "800");
    drawText(ctx, String(values[field.kind]), field.x + field.w - 10, field.y + field.h / 2 + 1, 13, TOKENS.textSecondary, "750", "right");
  }
}

function imageChoices(node) {
  const image = findWidget(node, "image");
  const values = image?.options?.values || image?.options?.items || image?.values || [];
  return Array.isArray(values) ? values : [];
}

function openMenu(values, event, callback) {
  LiteGraph.closeAllContextMenus?.();
  new LiteGraph.ContextMenu(
    values.map((value) => ({ content: String(value), title: String(value), callback: () => callback(value) })),
    { event },
    window,
  );
}

function openImageMenu(node, event) {
  const choices = imageChoices(node);
  if (!choices.length) {
    alert("No input images found. Upload an image first.");
    return;
  }
  openMenu(choices, event, (choice) => {
    setWidgetValue(node, "image", choice);
    clearCrop(node);
  });
}

async function uploadImage(node) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append("image", file);
    body.append("type", "input");
    body.append("overwrite", "true");
    const response = await api.fetchApi("/upload/image", { method: "POST", body });
    if (!response.ok) {
      alert(`${response.status} - ${response.statusText}`);
      return;
    }
    let name = file.name;
    try {
      const data = await response.json();
      name = data?.name || data?.filename || name;
    } catch {
      // Older ComfyUI builds may return an empty body here.
    }
    await app.refreshComboInNodes?.call(app);
    setWidgetValue(node, "image", name);
    clearCrop(node);
  };
  input.click();
}

function promptNumber(node, widgetName, label, fallback = 1) {
  const current = widgetValue(node, widgetName, fallback);
  const answer = prompt(label, String(current));
  if (answer === null) return;
  const number = Math.max(0.001, Number(answer));
  if (!Number.isFinite(number)) return;
  setWidgetValue(node, widgetName, number);
  applySelectedRatio(node);
}

function promptCropField(node, widgetName, label) {
  const size = sourceSize(node);
  if (!size) return;
  const current = positiveInt(widgetValue(node, widgetName, 0));
  const answer = prompt(label, String(current));
  if (answer === null) return;
  const next = positiveInt(answer, current);
  const crop = cropFromWidgets(node);
  const map = { crop_x: "x", crop_y: "y", crop_width: "w", crop_height: "h" };
  crop[map[widgetName]] = next;
  const ratio = ratioFromWidgets(node);
  const clean = ratio && (widgetName === "crop_width" || widgetName === "crop_height") ? adaptCropToRatio(node, crop, ratio) : crop;
  persistCrop(node, clean, true);
}

function handleHitbox(node, hit, event) {
  switch (hit.kind) {
    case "file":
      openImageMenu(node, event);
      return true;
    case "upload":
      uploadImage(node);
      return true;
    case "cropButton": {
      const size = sourceSize(node);
      if (size) {
        const ratio = ratioFromWidgets(node);
        persistCrop(node, ratio ? fitRatioCrop(size.width, size.height, ratio) : fullCrop(node), true);
      }
      return true;
    }
    case "resetButton":
      clearCrop(node);
      return true;
    case "ratioMenu":
      openMenu(CROP_RATIOS, event, (value) => {
        setWidgetValue(node, "crop_ratio", value);
        if (value === "Free") {
          markDirty(node);
        } else {
          applySelectedRatio(node);
        }
      });
      return true;
    case "ratioWidth":
      promptNumber(node, "ratio_width", "Ratio W", 4);
      return true;
    case "ratioHeight":
      promptNumber(node, "ratio_height", "Ratio H", 5);
      return true;
    case "advancedToggle":
      node.properties.kooLoadImageCropNext.advancedOpen = !node.properties.kooLoadImageCropNext.advancedOpen;
      markDirty(node);
      return true;
    case "cropX":
      promptCropField(node, "crop_x", "Crop X");
      return true;
    case "cropY":
      promptCropField(node, "crop_y", "Crop Y");
      return true;
    case "cropW":
      promptCropField(node, "crop_width", "Crop width");
      return true;
    case "cropH":
      promptCropField(node, "crop_height", "Crop height");
      return true;
    default:
      return false;
  }
}

function handleMouseDown(node, event, pos) {
  const state = ensureState(node);
  const hit = state.hitboxes.find((box) => pointInRect(pos, box));
  if (hit && handleHitbox(node, hit, event)) return true;
  if (!state.layout || !sourceSize(node) || !pointInRect(pos, state.layout.imageRect)) return false;
  const cropHit = hitCrop(node, pos);
  const startPoint = previewToImage(node, pos);
  if (!startPoint) return true;
  state.drag = cropHit
    ? { kind: cropHit.kind, handle: cropHit.handle, startCrop: { ...cropHit.crop }, startPoint }
    : { kind: "create", startCrop: { x: startPoint.x, y: startPoint.y, w: 1, h: 1 }, startPoint };
  return true;
}

function cursorForHit(hit, node, pos) {
  if (hit?.kind === "move") return "move";
  if (hit?.kind === "resize") return `${hit.handle}-resize`;
  const state = ensureState(node);
  if (state.layout && pointInRect(pos, state.layout.imageRect) && sourceSize(node)) return "crosshair";
  return "";
}

function handleMouseMove(node, pos, canvas) {
  const state = ensureState(node);
  state.hoverPos = pos;
  if (state.drag) {
    const handled = updateDrag(node, pos);
    if (canvas?.canvas) canvas.canvas.style.cursor = state.drag.kind === "move" ? "move" : "crosshair";
    return handled;
  }
  const hit = hitCrop(node, pos);
  if (canvas?.canvas) canvas.canvas.style.cursor = cursorForHit(hit, node, pos);
  markDirty(node);
  return false;
}

function endDrag(node) {
  const state = ensureState(node);
  state.drag = null;
  if (app.canvas?.canvas) app.canvas.canvas.style.cursor = "";
  markDirty(node);
}

function wrapInputCallbacks(node) {
  for (const name of ["crop_ratio", "ratio_width", "ratio_height"]) {
    const item = findWidget(node, name);
    if (!item || item._kooLoadImageCropNextWrapped) continue;
    const original = item.callback;
    item.callback = function (value) {
      const result = original?.apply(this, arguments);
      if (name === "crop_ratio") this.value = normalizeRatioValue(value);
      if (name === "ratio_width" || name === "ratio_height") this.value = positiveFloat(value, name === "ratio_width" ? 4 : 5);
      applySelectedRatio(node);
      return result;
    };
    item._kooLoadImageCropNextWrapped = true;
  }
}

app.registerExtension({
  name: EXTENSION_NAME,
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;
    if (nodeType.prototype._kooLoadImageCropNextInstalled) return;
    nodeType.prototype._kooLoadImageCropNextInstalled = true;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      ensureState(this);
      detachNativeWidgets(this);
      wrapInputCallbacks(this);
      suppressDefaultPreview(this);
      this.color = "#2D3037";
      this.bgcolor = TOKENS.background;
      this.resizable = true;
      this.serialize_widgets = true;
      this.size = [Math.max(this.size?.[0] || DEFAULT_WIDTH, MIN_WIDTH), Math.max(this.size?.[1] || DEFAULT_HEIGHT, DEFAULT_HEIGHT)];
      markDirty(this);
      return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const result = onConfigure?.apply(this, arguments);
      ensureState(this);
      detachNativeWidgets(this, info?.widgets_values);
      wrapInputCallbacks(this);
      suppressDefaultPreview(this);
      this.serialize_widgets = true;
      return result;
    };

    const serialize = nodeType.prototype.serialize;
    nodeType.prototype.serialize = function () {
      const data = serialize?.apply(this, arguments) || {};
      data.widgets_values = BACKEND_WIDGET_NAMES.map((name) => findWidget(this, name)?.value);
      data.properties = { ...(data.properties || {}), ...(this.properties || {}) };
      return data;
    };

    const computeSize = nodeType.prototype.computeSize;
    nodeType.prototype.computeSize = function () {
      const base = computeSize?.apply(this, arguments) || [MIN_WIDTH, DEFAULT_HEIGHT];
      const layout = makeLayout(this);
      return [Math.max(base[0], MIN_WIDTH), Math.max(base[1], layout.desiredHeight)];
    };

    const onDrawBackground = nodeType.prototype.onDrawBackground;
    nodeType.prototype.onDrawBackground = function () {
      suppressDefaultPreview(this);
      const result = onDrawBackground?.apply(this, arguments);
      suppressDefaultPreview(this);
      return result;
    };

    nodeType.prototype.onDrawForeground = function (ctx) {
      drawUI(this, ctx);
    };

    const onMouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (event, pos) {
      if (handleMouseDown(this, event, pos)) return true;
      return onMouseDown?.apply(this, arguments);
    };

    const onMouseMove = nodeType.prototype.onMouseMove;
    nodeType.prototype.onMouseMove = function (event, pos, canvas) {
      if (handleMouseMove(this, pos, canvas)) return true;
      return onMouseMove?.apply(this, arguments);
    };

    const onMouseUp = nodeType.prototype.onMouseUp;
    nodeType.prototype.onMouseUp = function () {
      endDrag(this);
      return onMouseUp?.apply(this, arguments);
    };

    const onMouseLeave = nodeType.prototype.onMouseLeave;
    nodeType.prototype.onMouseLeave = function () {
      ensureState(this).hoverPos = null;
      endDrag(this);
      return onMouseLeave?.apply(this, arguments);
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      const state = ensureState(this);
      state.image = null;
      state.drag = null;
      state.hitboxes = [];
      if (app.canvas?.canvas) app.canvas.canvas.style.cursor = "";
      return onRemoved?.apply(this, arguments);
    };

    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      const result = onResize?.apply(this, arguments);
      markDirty(this);
      return result;
    };
  },
});
