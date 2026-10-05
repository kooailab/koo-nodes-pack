import { app } from "../../../scripts/app.js";

const SHOULD_REGISTER_KOO_FINISHER = !globalThis.__KOO_FINISHER_EXTENSION_REGISTERED__;
if (SHOULD_REGISTER_KOO_FINISHER) {
  globalThis.__KOO_FINISHER_EXTENSION_REGISTERED__ = true;
  console.log("[KOO FINISHER] Frontend loaded from: koo-nodes/web/koo_finisher.js");
} else {
  console.log("[KOO FINISHER] Integrated frontend skipped because another KoO Finisher frontend is active.");
}

const NODE_NAME = "KoOFinisher";
const ACCENT = "#FF4FA3";
const FONT = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
const MIN_WIDTH = 760;
const MIN_HEIGHT = 1132;
const DEFAULT_SIZE = [780, 1132];
const SIDE_PAD = 18;
const TOKENS = {
  background: "#15161A",
  surface: "#22242A",
  surfaceRaised: "#2D3037",
  surfaceHover: "#383B44",
  surfacePressed: "#1D1F25",
  text: "#FFFFFF",
  textSecondary: "#CED1D8",
  textMuted: "#8D929C",
  border: "#444852",
  borderStrong: "#5A5F6B",
};

const CONTROLS = [
  { name: "exposure", label: "Exposure", min: -5, max: 5, sliderMin: -2, sliderMax: 2, step: 0.05, digits: 2, section: "LIGHT" },
  { name: "contrast", label: "Contrast", min: -100, max: 100, step: 1, section: "LIGHT" },
  { name: "highlights", label: "Highlights", min: -100, max: 100, step: 1, section: "LIGHT" },
  { name: "midtones", label: "Midtones", section: "LIGHT", min: -100, max: 100, step: 1, digits: 0 },
  { name: "shadows", label: "Shadows", min: -100, max: 100, step: 1, section: "LIGHT" },
  { name: "whites", label: "Whites", section: "LIGHT", min: -100, max: 100, step: 1, digits: 0 },
  { name: "blacks", label: "Blacks", section: "LIGHT", min: -100, max: 100, step: 1, digits: 0 },
  { name: "temperature", label: "Temperature", min: -100, max: 100, step: 1, section: "COLOR" },
  { name: "tint", label: "Tint", min: -100, max: 100, step: 1, section: "COLOR" },
  { name: "vibrance", label: "Vibrance", min: -100, max: 100, step: 1, section: "COLOR" },
  { name: "saturation", label: "Saturation", min: -100, max: 100, step: 1, section: "COLOR" },
  { name: "clarity", label: "Clarity", min: -100, max: 100, step: 1, section: "DETAIL" },
  { name: "sharpen", label: "Sharpen", min: 0, max: 100, step: 1, section: "DETAIL" },
  { name: "softLens", label: "Soft Lens", min: 0, max: 100, step: 1, section: "DETAIL" },
  { name: "vignette", label: "Vignette", min: 0, max: 100, step: 1, section: "EFFECTS" },
  { name: "chromaticAberration", label: "Chromatic Aberration", min: 0, max: 100, step: 1, section: "EFFECTS" },
  { name: "grain", label: "Grain", min: 0, max: 100, step: 1, section: "EFFECTS" },
];

const CONTROL_BY_NAME = Object.fromEntries(CONTROLS.map((control) => [control.name, control]));

function defaultState() {
  const state = {
    compare: false,
    divider: 0.5,
    autoSave: false,
    cacheId: "",
    sourceWidth: 0,
    sourceHeight: 0,
    lut: "",
    lutStrength: 100,
    bypass: false,
    outputFolder: "",
    filenamePrefix: "KoO_Finisher",
    format: "PNG",
    quality: 95,
  };
  for (const control of CONTROLS) state[control.name] = 0;
  return state;
}

function getState(node) {
  node._kooFinisherState ||= defaultState();
  return node._kooFinisherState;
}

function restoreState(node, saved) {
  const previous = getState(node);
  const restored = { ...defaultState(), ...(saved || {}) };
  // Older serialized views removed cacheId. Retain it for this live instance.
  if (!restored.cacheId && previous.cacheId) {
    restored.cacheId = previous.cacheId;
    restored.sourceWidth = previous.sourceWidth;
    restored.sourceHeight = previous.sourceHeight;
  }
  if (previous.cacheId !== restored.cacheId) releasePreviews(node);
  restored.divider = Math.max(0, Math.min(1, Number(restored.divider) || 0));
  node._kooFinisherState = restored;
  syncExecutionSettings(node);
}

function activeOutputFolder(node) {
  const state = getState(node);
  return state.outputFolder || node._kooFinisherDefaultOutputFolder || "ComfyUI/output";
}

function previewSettings(state) {
  return {
    lut: state.lut,
    lut_strength: state.lutStrength,
    exposure: state.exposure,
    contrast: state.contrast,
    highlights: state.highlights,
    shadows: state.shadows,
    midtones: state.midtones,
    whites: state.whites,
    blacks: state.blacks,
    temperature: state.temperature,
    tint: state.tint,
    vibrance: state.vibrance,
    saturation: state.saturation,
    clarity: state.clarity,
    sharpen: state.sharpen,
    soft_lens: state.softLens,
    chromatic_aberration: state.chromaticAberration,
    vignette: state.vignette,
    grain: state.grain,
    bypass: state.bypass,
  };
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
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawText(ctx, text, x, y, size, color, weight = "500", align = "left") {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(String(text ?? ""), x, y);
}

function ellipsize(ctx, value, maxWidth, size = 12) {
  // Measure with the rendered text size, rather than the preceding label's font.
  ctx.font = `650 ${size}px ${FONT}`;
  let text = String(value ?? "");
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 3 && ctx.measureText(`${text.slice(0, -1)}...`).width > maxWidth) text = text.slice(0, -1);
  return `${text}...`;
}

function hitKey(item) {
  return item ? `${item.kind}:${item.name || ""}` : "";
}

function addHit(hitboxes, kind, box, name = null) {
  hitboxes.push({ kind, name, ...box, key: `${kind}:${name || ""}` });
}

// Canvas layout uses flowing rows and proportional grid columns in graph units.
// Browser zoom/DPI transforms the entire grid together; no DOM offsets are used.
function layout(node) {
  const width = Math.max(MIN_WIDTH, Number(node.size?.[0] || DEFAULT_SIZE[0]));
  const height = Math.max(MIN_HEIGHT, Number(node.size?.[1] || DEFAULT_SIZE[1]));
  const x = SIDE_PAD, right = width - x, gap = 12;
  const hitboxes = [], sections = [], rows = [];
  const rowHeight = 24;
  const sectionHeight = (name) => 38 + CONTROLS.filter(c => c.section === name).length * rowHeight;
  const upperHeight = Math.max(sectionHeight("LIGHT"), sectionHeight("COLOR"));
  const lowerHeight = Math.max(sectionHeight("DETAIL"), sectionHeight("EFFECTS"));
  const exportHeight = 236;
  const preview = { x, y: 58, w: right - x, h: height - (58 + 16 + 142 + 16 + upperHeight + gap + lowerHeight + 14 + 40 + 8 + exportHeight + 18) };
  const compare = { x: right - 166, y: 20, w: 166, h: 24 };
  addHit(hitboxes, "button", compare, "compare");
  if (getState(node).compare) addHit(hitboxes, "wipe", preview, "divider");
  const lutBox = { x, y: preview.y + preview.h + 16, w: right - x, h: 142 };
  const setFolder = { x: x + 12, y: lutBox.y + 40, w: 112, h: 26 };
  const refresh = { x: setFolder.x + setFolder.w + 8, y: setFolder.y, w: 88, h: 26 };
  const lutButton = { x: x + 12, y: lutBox.y + 92, w: Math.min(360, lutBox.w * 0.51), h: 28 };
  const lutStrengthValue = { x: right - 58, y: lutButton.y - 22, w: 46, h: 22 };
  const lutTrack = { x: lutButton.x + lutButton.w + 28, y: lutButton.y + 9, w: lutStrengthValue.x - lutButton.x - lutButton.w - 36, h: 10 };
  addHit(hitboxes, "button", setFolder, "lutSetFolder");
  addHit(hitboxes, "button", refresh, "refresh");
  addHit(hitboxes, "button", lutButton, "lut");
  addHit(hitboxes, "slider", { x: lutTrack.x - 8, y: lutTrack.y - 8, w: lutTrack.w + 16, h: 28 }, "lutStrength");
  addHit(hitboxes, "value", lutStrengthValue, "lutStrength");
  const colW = (right - x - gap) / 2;
  let gridY = lutBox.y + lutBox.h + 16;
  for (const names of [["LIGHT", "COLOR"], ["DETAIL", "EFFECTS"]]) {
    const gridHeight = Math.max(...names.map(sectionHeight));
    names.forEach((name, column) => {
      const box = { name, x: x + column * (colW + gap), y: gridY, w: colW, h: sectionHeight(name) };
      sections.push(box);
      CONTROLS.filter(c => c.section === name).forEach((control, i) => {
        const rowY = box.y + 28 + i * rowHeight;
        const valueBox = { x: box.x + box.w - 58, y: rowY, w: 46, h: 22 };
        const labelWidth = name === "EFFECTS" ? 164 : 112;
        const track = { x: box.x + labelWidth, y: rowY + 9, w: valueBox.x - box.x - labelWidth - 16, h: 6 };
        rows.push({ control, x: box.x + 12, y: rowY, w: box.w - 24, h: 22, track, valueBox });
        addHit(hitboxes, "slider", { x: track.x - 8, y: rowY, w: track.w + 16, h: 22 }, control.name);
        addHit(hitboxes, "value", valueBox, control.name);
      });
    });
    gridY += gridHeight + gap;
  }
  const presetBox = { x, y: gridY - gap + 14, w: right - x, h: 40 };
  const presetMore = { x:right - 52, y:presetBox.y + 7, w:40, h:26 };
  const presetSave = { x:presetMore.x - 76, y:presetMore.y, w:68, h:26 };
  const presetSelect = { x:x + 88, y:presetMore.y, w:presetSave.x - x - 100, h:26 };
  for (const [name,box] of Object.entries({presetSelect,presetSave,presetMore})) addHit(hitboxes,"button",box,name);
  const exportBox = { x, y: presetBox.y + presetBox.h + 8, w: right - x, h: exportHeight };
  const innerW = exportBox.w - 24;
  const outputPath = { x: x + 12, y: exportBox.y + 43, w: innerW, h: 22 };
  const outputSet = { x: x + 12, y: outputPath.y + outputPath.h + 12, w: 100, h: 26 };
  const outputOpen = { x: outputSet.x + outputSet.w + gap, y: outputSet.y, w: 102, h: 26 };
  const autoSave = { x: outputOpen.x + outputOpen.w + gap, y: outputSet.y, w: 152, h: 26 };
  const prefix = { x: x + 12, y: outputSet.y + outputSet.h + 31, w: innerW * 0.42, h: 28 };
  const format = { x: prefix.x + prefix.w + gap, y: prefix.y, w: 100, h: 28 };
  const qualityValue = { x: right - 58, y: format.y - 22, w: 46, h: 22 };
  const quality = { x: format.x + format.w + 24, y: format.y + 10, w: right - 12 - (format.x + format.w + 24), h: 8 };
  const reset = { x: x + 12, y: exportBox.y + exportBox.h - 38, w: 86, h: 26 };
  const bypass = { x: reset.x + reset.w + 8, y: reset.y, w: 92, h: 26 };
  const save = { x: right - 138, y: reset.y, w: 126, h: 26 };
  for (const [name, box] of Object.entries({ outputSet, outputOpen, autoSave, format, reset, bypass, save })) addHit(hitboxes, "button", box, name);
  addHit(hitboxes, "field", prefix, "prefix");
  addHit(hitboxes, "slider", { x: quality.x - 8, y: quality.y - 10, w: quality.w + 16, h: 28 }, "quality");
  addHit(hitboxes, "value", qualityValue, "quality");
  return { width, height, hitboxes, preview, compare, autoSave, presetBox, presetSelect, presetSave, presetMore, lutBox, setFolder, refresh, lutButton, lutTrack, lutStrengthValue, sections, rows, exportBox, outputPath, outputSet, outputOpen, prefix, format, quality, qualityValue, reset, bypass, save };
}

function buttonState(node, name) {
  const key = `button:${name}`;
  return {
    hover: node._kooFinisherHoverKey === key,
    pressed: node._kooFinisherPressedKey === key,
  };
}

function drawButton(ctx, node, box, label, name, active = false, primary = false) {
  const state = buttonState(node, name);
  const y = box.y + (state.pressed ? 1 : 0);
  const fill = active
    ? state.pressed
      ? "rgba(255,79,163,0.28)"
      : "rgba(255,79,163,0.2)"
    : state.pressed
      ? TOKENS.surfacePressed
      : state.hover
        ? TOKENS.surfaceHover
        : TOKENS.surfaceRaised;
  const stroke = active || state.hover || primary ? ACCENT : TOKENS.border;
  const lineWidth = active || primary ? 1.5 : 1;
  ctx.save();
  if ((state.hover || active || primary) && !state.pressed) {
    ctx.shadowColor = "rgba(255,79,163,0.22)";
    ctx.shadowBlur = 8;
  }
  drawRound(ctx, { ...box, y }, fill, stroke, lineWidth, 5);
  ctx.restore();
  drawText(ctx, label, box.x + box.w / 2, y + box.h / 2 + 1, 12, active || primary ? TOKENS.text : TOKENS.textSecondary, "750", "center");
}

function drawPreview(ctx, box, image) {
  drawRound(ctx, box, "#111216", TOKENS.border, 1, 7);
  if (!image) return;
  const inner = { x: box.x + 8, y: box.y + 8, w: box.w - 16, h: box.h - 16 };
  const scale = Math.min(inner.w / image.width, inner.h / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  const x = inner.x + (inner.w - w) / 2;
  const y = inner.y + (inner.h - h) / 2;
  ctx.save();
  roundedRect(ctx, box.x, box.y, box.w, box.h, 7);
  ctx.clip();
  ctx.drawImage(image, x, y, w, h);
  ctx.restore();
}

function numericConfig(name) {
  if (name === "lutStrength") return { name, label: "Strength", min: 0, max: 100, step: 1, digits: 0, suffix: "%" };
  if (name === "quality") return { name, label: "Quality", min: 1, max: 100, step: 1, digits: 0, suffix: "" };
  return { ...CONTROL_BY_NAME[name], suffix: "" };
}

function formatValue(control, value) {
  const text = control.digits ? Number(value).toFixed(control.digits) : String(Math.round(Number(value)));
  return `${text}${control.suffix || ""}`;
}

function drawValue(ctx, node, box, name, value, active) {
  const config = numericConfig(name);
  const isHover = node._kooFinisherHoverKey === `value:${name}`;
  if (isHover || node._kooFinisherEditingName === name) {
    drawRound(ctx, box, isHover ? "rgba(255,79,163,0.08)" : TOKENS.background, isHover ? ACCENT : TOKENS.border, 1, 4);
  }
  drawText(ctx, formatValue(config, value), box.x + box.w - 5, box.y + box.h / 2 + 1, 12, active ? TOKENS.text : TOKENS.textMuted, active ? "800" : "600", "right");
}

function drawSlider(ctx, node, row, value) {
  const control = row.control;
  const min = control.sliderMin ?? control.min;
  const max = control.sliderMax ?? control.max;
  const zeroPos = (0 - min) / (max - min);
  const valuePos = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const active = Math.abs(value) > 0.0001;
  drawText(ctx, control.label, row.x, row.y + row.h / 2, 12, TOKENS.textSecondary, "650");
  drawValue(ctx, node, row.valueBox, control.name, value, active);
  drawRound(ctx, row.track, TOKENS.background, TOKENS.border, 1, 3);
  const zx = row.track.x + row.track.w * zeroPos;
  const vx = row.track.x + row.track.w * valuePos;
  const fill = { x: Math.min(zx, vx), y: row.track.y, w: Math.abs(vx - zx), h: row.track.h };
  if (fill.w > 0.5) drawRound(ctx, fill, ACCENT, null, 0, 3);
  ctx.beginPath();
  ctx.arc(vx, row.track.y + row.track.h / 2, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = active ? TOKENS.text : TOKENS.textMuted;
  ctx.fill();
  ctx.strokeStyle = active ? ACCENT : TOKENS.borderStrong;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawUI(node, ctx) {
  const state = getState(node);
  const data = node._kooFinisherLuts || { lut_folder: "", luts: [], status: "Loading LUTs..." };
  const l = layout(node);
  if (!node.size || node.size[0] < MIN_WIDTH || node.size[1] < MIN_HEIGHT) node.size = [l.width, l.height];

  drawRound(ctx, { x: 8, y: 8, w: l.width - 16, h: l.height - 16 }, TOKENS.background, TOKENS.borderStrong, 1.5, 12);
  drawText(ctx, "KoO Finisher", 20, 31, 22, TOKENS.text, "900");
  drawButton(ctx, node, l.compare, `Compare A/B: ${state.compare ? "ON" : "OFF"}`, "compare", state.compare);
  drawText(ctx, "PREVIEW", l.preview.x + 12, l.preview.y - 10, 12, TOKENS.textMuted, "850");
  drawPreview(ctx, l.preview, node._kooFinisherPreviewImage);
  if (state.compare && node._kooFinisherOriginalImage && node._kooFinisherPreviewImage) {
    const dividerX = l.preview.x + l.preview.w * state.divider;
    ctx.save();
    ctx.beginPath(); ctx.rect(l.preview.x, l.preview.y, l.preview.w * state.divider, l.preview.h); ctx.clip();
    drawPreview(ctx, l.preview, node._kooFinisherOriginalImage);
    ctx.restore();
    ctx.beginPath(); ctx.moveTo(dividerX, l.preview.y); ctx.lineTo(dividerX, l.preview.y + l.preview.h);
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 2; ctx.stroke();
    drawRound(ctx, { x: dividerX - 7, y: l.preview.y + l.preview.h / 2 - 16, w: 14, h: 32 }, TOKENS.text, ACCENT, 1, 4);
    drawText(ctx, "A · Original", l.preview.x + 14, l.preview.y + 20, 12, TOKENS.text, "750");
    drawText(ctx, "B · Finished", l.preview.x + l.preview.w - 14, l.preview.y + 20, 12, TOKENS.text, "750", "right");
  }
  if (!node._kooFinisherPreviewImage) {
    drawText(ctx, state.cacheId ? "Rendering preview..." : "Run workflow to load source image", l.preview.x + l.preview.w / 2, l.preview.y + l.preview.h / 2, 13, TOKENS.textMuted, "650", "center");
  }

  drawRound(ctx, l.lutBox, TOKENS.surface, TOKENS.border, 1, 7);
  drawText(ctx, "LUT", l.lutBox.x + 12, l.lutBox.y + 15, 12, TOKENS.textMuted, "850");
  drawText(ctx, ellipsize(ctx, `Folder: ${data.lut_folder || "not set"}`, l.lutBox.w - 250), l.lutBox.x + 12, l.lutBox.y + 30, 12, data.lut_folder ? TOKENS.textSecondary : TOKENS.textMuted, "550");
  drawButton(ctx, node, l.setFolder, "Set Folder", "lutSetFolder");
  drawButton(ctx, node, l.refresh, "Refresh", "refresh");
  drawText(ctx, ellipsize(ctx, data.status || "", l.lutBox.w - 250), l.refresh.x + l.refresh.w + 10, l.refresh.y + 13, 11, TOKENS.textMuted, "550");
  drawText(ctx, "LUT", l.lutButton.x, l.lutButton.y - 11, 11, TOKENS.textMuted, "750");
  drawButton(ctx, node, l.lutButton, "", "lut");
  drawText(ctx, ellipsize(ctx, state.lut || "None", l.lutButton.w - 34, 13), l.lutButton.x + 10, l.lutButton.y + l.lutButton.h / 2 + 1, 13, state.lut ? TOKENS.text : TOKENS.textMuted, "650");
  drawText(ctx, "v", l.lutButton.x + l.lutButton.w - 16, l.lutButton.y + l.lutButton.h / 2, 13, ACCENT, "900", "center");
  drawText(ctx, "Strength", l.lutTrack.x, l.lutTrack.y - 15, 12, TOKENS.textSecondary, "650");
  drawValue(ctx, node, l.lutStrengthValue, "lutStrength", state.lutStrength, true);
  drawRound(ctx, l.lutTrack, TOKENS.background, TOKENS.border, 1, 4);
  drawRound(ctx, { x: l.lutTrack.x, y: l.lutTrack.y, w: l.lutTrack.w * state.lutStrength / 100, h: l.lutTrack.h }, ACCENT, null, 0, 4);

  for (const section of l.sections) {
    drawRound(ctx, section, TOKENS.surface, TOKENS.border, 1, 7);
    drawText(ctx, section.name, section.x + 12, section.y + 15, 12, TOKENS.textMuted, "850");
  }
  for (const row of l.rows) drawSlider(ctx, node, row, Number(state[row.control.name]));

  drawRound(ctx,l.presetBox,TOKENS.surface,TOKENS.border,1,7);
  drawText(ctx,"PRESET",l.presetBox.x+12,l.presetBox.y+20,12,TOKENS.textMuted,"850");
  drawButton(ctx,node,l.presetSelect,"","presetSelect");
  const presetName = node._kooFinisherPresetId ? `${node._kooFinisherPresetName}${node._kooFinisherPresetModified ? " *" : ""}` : "No Preset";
  const presetLabel = node._kooFinisherPresetStatus?.includes("LUT not found") ? `LUT not found · ${presetName}` : presetName;
  drawText(ctx,ellipsize(ctx,presetLabel,l.presetSelect.w-32),l.presetSelect.x+10,l.presetSelect.y+14,12,node._kooFinisherPresetId ? TOKENS.textSecondary : TOKENS.textMuted,"650");
  drawText(ctx,"v",l.presetSelect.x+l.presetSelect.w-14,l.presetSelect.y+14,12,ACCENT,"900","center");
  drawButton(ctx,node,l.presetSave,node._kooFinisherPresetBusy ? "..." : "Save","presetSave");
  drawButton(ctx,node,l.presetMore,"...","presetMore");
  drawRound(ctx, l.exportBox, TOKENS.surface, TOKENS.border, 1, 7);
  drawText(ctx, "EXPORT", l.exportBox.x + 12, l.exportBox.y + 15, 12, TOKENS.textMuted, "850");
  drawText(ctx, "Output Folder", l.exportBox.x + 12, l.exportBox.y + 32, 11, TOKENS.textMuted, "750");
  drawRound(ctx, l.outputPath, TOKENS.background, TOKENS.border, 1, 5);
  drawText(ctx, ellipsize(ctx, activeOutputFolder(node), l.outputPath.w - 18), l.outputPath.x + 9, l.outputPath.y + l.outputPath.h / 2 + 1, 12, TOKENS.textSecondary, "600");
  drawButton(ctx, node, l.outputSet, "Set Folder", "outputSet");
  drawButton(ctx, node, l.outputOpen, "Open Folder", "outputOpen");
  drawButton(ctx, node, l.autoSave, `Auto Save: ${state.autoSave ? "ON" : "OFF"}`, "autoSave", state.autoSave);
  drawText(ctx, "Filename Prefix", l.prefix.x, l.prefix.y - 10, 11, TOKENS.textMuted, "750");
  drawRound(ctx, l.prefix, TOKENS.background, TOKENS.border, 1, 5);
  drawText(ctx, ellipsize(ctx, state.filenamePrefix, l.prefix.w - 18), l.prefix.x + 9, l.prefix.y + l.prefix.h / 2 + 1, 12, TOKENS.textSecondary, "650");
  drawText(ctx, "Format", l.format.x, l.format.y - 10, 11, TOKENS.textMuted, "750");
  drawButton(ctx, node, l.format, `${state.format} ▼`, "format");
  drawText(ctx, "Quality", l.quality.x, l.quality.y - 15, 11, state.format === "PNG" ? TOKENS.textMuted : TOKENS.textSecondary, "750");
  drawValue(ctx, node, l.qualityValue, "quality", state.quality, state.format !== "PNG");
  drawRound(ctx, l.quality, TOKENS.background, TOKENS.border, 1, 3);
  if (state.format !== "PNG") drawRound(ctx, { x: l.quality.x, y: l.quality.y, w: l.quality.w * (state.quality - 1) / 99, h: l.quality.h }, ACCENT, null, 0, 3);
  drawButton(ctx, node, l.reset, "Reset", "reset");
  drawButton(ctx, node, l.bypass, "Bypass", "bypass", state.bypass);
  drawButton(ctx, node, l.save, node._kooFinisherSaving ? "Saving..." : "SAVE IMAGE", "save", false, true);
  drawText(ctx, ellipsize(ctx, node._kooFinisherStatus || "Ready", l.exportBox.w - 24), l.exportBox.x + 12, l.reset.y - 14, 12, TOKENS.textMuted, "650");
  positionNumericEditor(node);
}

async function loadLuts(node, route = "/koo/finisher/luts") {
  node._kooFinisherLuts = node._kooFinisherLuts || { lut_folder: "", exists: false, luts: [], status: "Loading LUTs..." };
  node._kooFinisherLutsAbort?.abort();
  const controller = new AbortController();
  node._kooFinisherLutsAbort = controller;
  try {
    const response = await fetch(route, { cache: "no-store", signal: controller.signal });
    const data = await response.json();
    if (controller.signal.aborted) return;
    if (!data.ok) throw new Error(data.error || "Could not load LUTs");
    node._kooFinisherLuts = data;
    node._kooFinisherDefaultOutputFolder = data.default_output_folder || node._kooFinisherDefaultOutputFolder;
  } catch (error) {
    if (controller.signal.aborted) return;
    node._kooFinisherLuts = { lut_folder: "", exists: false, luts: [], status: error.message || "Could not load LUTs" };
  }
  node.setDirtyCanvas(true, true);
}

async function saveFolder(node) {
  const current = node._kooFinisherLuts?.lut_folder || "";
  const answer = prompt("LUT folder", current);
  if (answer === null) return;
  node._kooFinisherLuts = { ...(node._kooFinisherLuts || {}), status: "Saving LUT folder..." };
  node.setDirtyCanvas(true, true);
  try {
    const response = await fetch("/koo/finisher/lut_config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lut_folder: answer }),
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "Could not save LUT folder");
    node._kooFinisherLuts = data;
  } catch (error) {
    node._kooFinisherLuts = { ...(node._kooFinisherLuts || {}), status: error.message || "Could not save LUT folder" };
  }
  node.setDirtyCanvas(true, true);
}

function schedulePreview(node, delay = 100) {
  clearTimeout(node._kooFinisherPreviewTimer);
  if (!getState(node).cacheId) return;
  node._kooFinisherStatus = "Previewing...";
  node._kooFinisherPreviewTimer = setTimeout(() => requestPreview(node), delay);
  node.setDirtyCanvas(true, true);
}

function releasePreviews(node) {
  clearTimeout(node._kooFinisherPreviewTimer);
  for (const kind of ["Preview", "Original"]) {
    node[`_kooFinisher${kind}RequestId`] = (node[`_kooFinisher${kind}RequestId`] || 0) + 1;
    node[`_kooFinisher${kind}Abort`]?.abort();
    for (const suffix of ["Url", "PendingUrl"]) {
      const key = `_kooFinisher${kind}${suffix}`;
      if (node[key]) URL.revokeObjectURL(node[key]);
      node[key] = null;
    }
    node[`_kooFinisher${kind}Image`] = null;
  }
  node._kooFinisherOriginalCacheId = "";
}

async function requestPreview(node, original = false) {
  const state = getState(node);
  if (!state.cacheId) return;
  const kind = original ? "Original" : "Preview";
  const key = `_kooFinisher${kind}`;
  const cacheId = state.cacheId;
  const requestId = (node[`${key}RequestId`] || 0) + 1;
  node[`${key}RequestId`] = requestId;
  node[`${key}Abort`]?.abort();
  const controller = new AbortController();
  node[`${key}Abort`] = controller;
  if (node[`${key}PendingUrl`]) URL.revokeObjectURL(node[`${key}PendingUrl`]);
  node[`${key}PendingUrl`] = null;
  const current = () => requestId === node[`${key}RequestId`] && cacheId === getState(node).cacheId;
  try {
    const response = await fetch("/koo/finisher/preview", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({ cache_id: cacheId, settings: original ? {} : previewSettings(state), original, max_size: 1200 }),
    });
    if (!response.ok) {
      let error = "Preview failed";
      try { error = (await response.json()).error || error; } catch (_) {}
      throw new Error(error);
    }
    const blob = await response.blob();
    if (!current()) return;
    const url = URL.createObjectURL(blob);
    node[`${key}PendingUrl`] = url;
    const img = new Image();
    img.onload = () => {
      if (!current()) { URL.revokeObjectURL(url); return; }
      if (node[`${key}Url`]) URL.revokeObjectURL(node[`${key}Url`]);
      node[`${key}PendingUrl`] = null;
      node[`${key}Url`] = url;
      node[`${key}Image`] = img;
      if (original) node._kooFinisherOriginalCacheId = cacheId;
      else node._kooFinisherStatus = "Ready";
      node.setDirtyCanvas(true, true);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      if (!current()) return;
      node[`${key}PendingUrl`] = null;
      node._kooFinisherStatus = "Preview failed";
      node.setDirtyCanvas(true, true);
    };
    img.src = url;
  } catch (error) {
    if (error?.name === "AbortError" || !current()) return;
    node._kooFinisherStatus = "Preview failed";
    console.warn("[KOO FINISHER] Preview failed", error);
    node.setDirtyCanvas(true, true);
  }
}

function executionSettings(node) {
  const state = getState(node);
  return { auto_save: state.autoSave, settings: previewSettings(state), output_folder: state.outputFolder,
    filename_prefix: state.filenamePrefix, format: state.format, quality: state.quality };
}

function syncExecutionSettings(node) {
  const widget = node.widgets?.find(w => w.name === "finisher_settings");
  if (widget) widget.value = JSON.stringify(executionSettings(node));
}

function setState(node, name, value) {
  if (node._kooFinisherPresetId && getState(node)[name] !== value && (CONTROL_BY_NAME[name] || name === "lut" || name === "lutStrength")) node._kooFinisherPresetModified = true;
  getState(node)[name] = value;
  syncExecutionSettings(node);
  schedulePreview(node);
}

function setExportState(node, name, value) {
  getState(node)[name] = value;
  syncExecutionSettings(node);
  node.setDirtyCanvas(true, true);
}

async function presetRequest(node, payload = null, id = "") {
  node._kooFinisherPresetAbort?.abort();
  const controller = new AbortController(); node._kooFinisherPresetAbort = controller;
  const response = await fetch(`/koo/finisher/presets${id ? `?id=${encodeURIComponent(id)}` : ""}`, {
    method:payload ? "POST" : "GET", headers:payload ? {"Content-Type":"application/json"} : undefined,
    body:payload ? JSON.stringify(payload) : undefined, signal:controller.signal,
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || "Preset operation failed");
  if (controller.signal.aborted || node._kooFinisherPresetRemoved) throw new DOMException("Cancelled", "AbortError");
  return data;
}

async function loadPresets(node) {
  try {
    const data = await presetRequest(node); node._kooFinisherPresets = data.presets || [];
    if (node._kooFinisherPresetId && !node._kooFinisherPresets.some(item => item.id === node._kooFinisherPresetId)) customPreset(node);
  }
  catch (error) {if (error.name !== "AbortError") node._kooFinisherPresetStatus = error.message;}
  if (!node._kooFinisherPresetRemoved) node.setDirtyCanvas(true,true);
}

function customPreset(node) {
  node._kooFinisherPresetId = ""; node._kooFinisherPresetName = "";
  node._kooFinisherPresetModified = false; node._kooFinisherPresetStatus = "Unsaved";
  node.setDirtyCanvas(true,true);
}

function applyPreset(node, data) {
  const settings = data.preset.settings, state = getState(node);
  for (const control of CONTROLS) state[control.name] = settings[control.name === "softLens" ? "soft_lens" : control.name === "chromaticAberration" ? "chromatic_aberration" : control.name] ?? 0;
  state.lut = settings.lut || ""; state.lutStrength = settings.lut_strength ?? 100;
  node._kooFinisherPresetId = data.id; node._kooFinisherPresetName = data.preset.name;
  node._kooFinisherPresetModified = false;
  node._kooFinisherPresetStatus = data.missing_lut ? "LUT not found — select a replacement" : "Loaded";
  syncExecutionSettings(node); schedulePreview(node);
}

async function presetAction(node, action, argument = null) {
  if (node._kooFinisherPresetBusy || node._kooFinisherPresetRemoved) return;
  node._kooFinisherPresetBusy = true;
  try {
    const id = node._kooFinisherPresetId;
    let data;
    if (action === "load") {data = await presetRequest(node,null,argument); applyPreset(node,data);}
    else if (action === "save" || action === "save_as") {
      const name = action === "save" && id ? node._kooFinisherPresetName : prompt("Preset name",node._kooFinisherPresetName || "My Finish");
      if (name === null) return;
      const saveAction = action === "save" && id ? "save" : "save_as";
      data = await presetRequest(node,{action:saveAction, id:saveAction === "save" ? id : undefined, name, settings:previewSettings(getState(node))});
      // Saving a look must not cause another preview render.
      node._kooFinisherPresetId = data.id; node._kooFinisherPresetName = data.preset.name; node._kooFinisherPresetStatus = "Saved";
      node._kooFinisherPresetModified = false;
    } else if (action === "rename") {
      if (!id) throw new Error("Select a preset first");
      const name = prompt("Rename preset",node._kooFinisherPresetName); if (name === null) return;
      data = await presetRequest(node,{action,id,name}); node._kooFinisherPresetName = data.preset.name; node._kooFinisherPresetStatus = "Renamed";
    } else if (action === "delete") {
      if (!id) throw new Error("Select a preset first");
      if (!confirm(`Delete preset “${node._kooFinisherPresetName}”?`)) return;
      data = await presetRequest(node,{action,id}); customPreset(node); node._kooFinisherPresetStatus = "Deleted";
    } else if (action === "import") {
      data = await presetRequest(node,{action,json:argument}); applyPreset(node,data);
    } else if (action === "export") {
      if (!id) throw new Error("Save or select a preset first");
      data = await presetRequest(node,null,id);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data.preset,null,2)+"\n"],{type:"application/json;charset=utf-8"}));
      const anchor = document.createElement("a"); anchor.href = url;
      let name = data.preset.name.replace(/[\x00-\x1f<>:"/\\|?*]/g,"_").replace(/[. ]+$/g,"") || "Finisher";
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
      anchor.download = `${name}.json`; document.body.append(anchor); anchor.click(); anchor.remove();
      (node._kooFinisherPresetUrls ||= new Set()).add(url);
      const timer = setTimeout(() => {URL.revokeObjectURL(url); node._kooFinisherPresetUrls?.delete(url); node._kooFinisherPresetTimers?.delete(timer);},0);
      (node._kooFinisherPresetTimers ||= new Set()).add(timer); node._kooFinisherPresetStatus = "Exported";
    }
    if (data?.presets) node._kooFinisherPresets = data.presets;
  } catch (error) {if (error.name !== "AbortError") node._kooFinisherPresetStatus = error.message;}
  finally {
    node._kooFinisherPresetBusy = false;
    if (!node._kooFinisherPresetRemoved) {node._kooFinisherStatus = `Preset: ${node._kooFinisherPresetStatus || "Ready"}`; node.setDirtyCanvas(true,true);}
  }
}

function importPresetFile(node) {
  if (node._kooFinisherPresetInput) node._kooFinisherPresetInput.onchange = null;
  const input = document.createElement("input"); input.type = "file"; input.accept = ".json,application/json";
  node._kooFinisherPresetInput = input;
  input.onchange = async () => {
    const file = input.files?.[0]; if (!file) return;
    try {
      if (file.size > 65536) throw new Error("Preset JSON is too large");
      const text = await file.text();
      if (!node._kooFinisherPresetRemoved && node._kooFinisherPresetInput === input) await presetAction(node,"import",text);
    } catch (error) {if (!node._kooFinisherPresetRemoved) node._kooFinisherPresetStatus = error.message;}
    finally {input.onchange = null; input.remove(); if (node._kooFinisherPresetInput === input) node._kooFinisherPresetInput = null; if (!node._kooFinisherPresetRemoved) node.setDirtyCanvas(true,true);}
  };
  input.click();
}

function presetMenu(node, event, more = false) {
  const entries = more
    ? Object.entries({"Save As":"save_as",Rename:"rename",Delete:"delete",Import:"import",Export:"export"}).map(([content,value]) => ({content,value}))
    : [{content:"+ New Preset",value:"new_preset"}, null, ...(node._kooFinisherPresets || []).map(item => ({content:item.name,value:item.id}))];
  const choose = value => {
    const entry = typeof value === "object" ? value : entries.find(item => item && (item.value === value || item.content === value));
    if (!entry) return;
    if (more) {if (entry.value === "import") importPresetFile(node); else presetAction(node,entry.value);}
    else if (entry.value === "new_preset") presetAction(node,"save_as");
    else presetAction(node,"load",entry.value);
  };
  if (window.LiteGraph?.ContextMenu) new LiteGraph.ContextMenu(entries,{event,callback:choose});
  else {const answer = prompt(entries.map((item,i)=>item ? `${i}. ${item.content}` : "──────────────").join("\n"),"0"); if (answer !== null && entries[Number(answer)]) choose(entries[Number(answer)]);}
}


function showLutMenu(node, event) {
  const luts = node._kooFinisherLuts?.luts || [];
  if (!luts.length) return;
  const options = ["None", ...luts.map((item) => item.name)];
  const applyChoice = (choice) => setState(node, "lut", choice === "None" ? "" : choice);
  if (window.LiteGraph?.ContextMenu) {
    new LiteGraph.ContextMenu(options, { event, callback: applyChoice });
    return;
  }
  const answer = prompt(`Choose LUT:\n${options.map((name, i) => `${i}. ${name}`).join("\n")}`, "0");
  const index = Number(answer);
  if (Number.isInteger(index) && index >= 0 && index < options.length) applyChoice(options[index]);
}

function clampStep(value, control) {
  const clamped = Math.max(control.min, Math.min(control.max, value));
  const stepped = Math.round((clamped - control.min) / control.step) * control.step + control.min;
  return control.digits ? Number(stepped.toFixed(control.digits)) : Math.round(stepped);
}

function valueForName(node, name) {
  return Number(getState(node)[name]);
}

function applyNumericValue(node, name, rawValue) {
  const config = numericConfig(name);
  if (!config) return false;
  const normalized = String(rawValue ?? "").trim().replace("%", "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return false;
  const value = clampStep(parsed, config);
  if (name === "quality") {
    setExportState(node, "quality", value);
  } else if (name === "lutStrength") {
    setState(node, "lutStrength", value);
  } else {
    setState(node, name, value);
  }
  return true;
}

function localBoxToClientRect(node, box) {
  const canvas = app.canvas?.canvas || app.canvasEl || document.querySelector("canvas");
  const graphPosA = [node.pos[0] + box.x, node.pos[1] + box.y];
  const graphPosB = [node.pos[0] + box.x + box.w, node.pos[1] + box.y + box.h];
  if (app.canvasPosToClientPos) {
    const a = app.canvasPosToClientPos(graphPosA);
    const b = app.canvasPosToClientPos(graphPosB);
    return { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) };
  }
  const rect = canvas?.getBoundingClientRect?.() || { left: 0, top: 0 };
  const ds = app.canvas?.ds || { scale: 1, offset: [0, 0] };
  return {
    left: rect.left + (graphPosA[0] + ds.offset[0]) * ds.scale,
    top: rect.top + (graphPosA[1] + ds.offset[1]) * ds.scale,
    width: box.w * ds.scale,
    height: box.h * ds.scale,
  };
}

function positionNumericEditor(node) {
  const editor = node._kooFinisherNumericEditor;
  if (!editor?.input?.isConnected) return;
  const l = layout(node);
  const box = editor.name === "lutStrength"
    ? l.lutStrengthValue
    : editor.name === "quality"
      ? l.qualityValue
      : l.rows.find((row) => row.control.name === editor.name)?.valueBox;
  if (!box) return;
  editor.box = box;
  const rect = localBoxToClientRect(node, box);
  Object.assign(editor.input.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${Math.max(34, rect.width)}px`,
    height: `${Math.max(20, rect.height)}px`,
    fontSize: `${Math.max(11, Math.min(16, rect.height * 0.56))}px`,
  });
}

function closeNumericEditor(node, commit) {
  const editor = node._kooFinisherNumericEditor;
  if (!editor) return;
  node._kooFinisherNumericEditor = null;
  node._kooFinisherEditingName = "";
  if (editor.outsideHandler) document.removeEventListener("pointerdown", editor.outsideHandler, true);
  if (commit) {
    const ok = applyNumericValue(node, editor.name, editor.input.value);
    if (!ok) getState(node)[editor.name] = editor.previous;
  } else {
    getState(node)[editor.name] = editor.previous;
  }
  editor.input.remove();
  node.setDirtyCanvas(true, true);
}

function beginNumericEdit(node, name) {
  closeNumericEditor(node, true);
  const config = numericConfig(name);
  if (!config) return;
  const previous = valueForName(node, name);
  const input = document.createElement("input");
  input.type = "text";
  input.value = config.digits ? Number(previous).toFixed(config.digits) : String(Math.round(previous));
  input.autocomplete = "off";
  input.spellcheck = false;
  Object.assign(input.style, {
    position: "fixed",
    zIndex: 10000,
    boxSizing: "border-box",
    padding: "0 5px",
    margin: "0",
    borderRadius: "4px",
    border: `1px solid ${ACCENT}`,
    outline: "none",
    background: TOKENS.background,
    color: TOKENS.text,
    fontFamily: FONT,
    fontWeight: "800",
    textAlign: "right",
    boxShadow: "0 0 0 2px rgba(255,79,163,0.16)",
    pointerEvents: "auto",
  });
  input.addEventListener("pointerdown", (event) => event.stopPropagation());
  input.addEventListener("mousedown", (event) => event.stopPropagation());
  input.addEventListener("click", (event) => event.stopPropagation());
  const outsideHandler = (event) => {
    if (event.target !== input) closeNumericEditor(node, true);
  };
  node._kooFinisherNumericEditor = { input, name, previous, outsideHandler };
  node._kooFinisherEditingName = name;
  document.body.appendChild(input);
  positionNumericEditor(node);
  requestAnimationFrame(() => {
    if (node._kooFinisherNumericEditor?.input !== input || !input.isConnected) return;
    input.focus();
    input.select();
    setTimeout(() => {
      if (node._kooFinisherNumericEditor?.input === input && input.isConnected) document.addEventListener("pointerdown", outsideHandler, true);
    }, 0);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      closeNumericEditor(node, true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeNumericEditor(node, false);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const current = Number(String(input.value).replace(",", ".").replace("%", ""));
      const base = Number.isFinite(current) ? current : previous;
      const direction = event.key === "ArrowUp" ? 1 : -1;
      const next = clampStep(base + direction * config.step, config);
      input.value = config.digits ? next.toFixed(config.digits) : String(Math.round(next));
      input.select();
    }
  });
  input.addEventListener("blur", () => closeNumericEditor(node, true));
  node.setDirtyCanvas(true, true);
}

function updateSlider(node, name, pos) {
  const state = getState(node);
  const l = layout(node);
  if (name === "divider") {
    setExportState(node, "divider", Math.max(0, Math.min(1, (pos[0] - l.preview.x) / l.preview.w)));
    return;
  }
  if (name === "lutStrength") {
    setState(node, "lutStrength", Math.round(Math.max(0, Math.min(1, (pos[0] - l.lutTrack.x) / l.lutTrack.w)) * 100));
    return;
  }
  if (name === "quality") {
    setExportState(node, "quality", Math.round(1 + Math.max(0, Math.min(1, (pos[0] - l.quality.x) / l.quality.w)) * 99));
    return;
  }
  const control = CONTROLS.find((item) => item.name === name);
  const row = l.rows.find((item) => item.control.name === name);
  if (!control || !row) return;
  const pct = Math.max(0, Math.min(1, (pos[0] - row.track.x) / row.track.w));
  const min = control.sliderMin ?? control.min;
  const max = control.sliderMax ?? control.max;
  setState(node, name, clampStep(min + pct * (max - min), control));
}

function resetNode(node) {
  const state = getState(node);
  const retained = { cacheId: state.cacheId, sourceWidth: state.sourceWidth, sourceHeight: state.sourceHeight, outputFolder: state.outputFolder, filenamePrefix: state.filenamePrefix, format: state.format, quality: state.quality, autoSave: state.autoSave, compare: state.compare, divider: state.divider };
  node._kooFinisherState = { ...defaultState(), ...retained };
  syncExecutionSettings(node);
  node._kooFinisherStatus = "Reset";
  schedulePreview(node);
}

function editPrefix(node) {
  const state = getState(node);
  const answer = prompt("Filename Prefix", state.filenamePrefix);
  if (answer === null) return;
  setExportState(node, "filenamePrefix", answer.trim() || "KoO_Finisher");
}

function showFormatMenu(node, event) {
  const formats = ["PNG", "JPG", "WEBP"];
  const choose = (format) => { if (formats.includes(format)) setExportState(node, "format", format); };
  if (window.LiteGraph?.ContextMenu) {
    new LiteGraph.ContextMenu(formats, { event, callback: choose });
  } else {
    const select = document.createElement("select");
    node._kooFinisherFormatDialog?.close();
    for (const format of formats) select.add(new Option(format, format));
    select.value = getState(node).format;
    // Fallback uses a native dropdown inside a dialog with normal document flow.
    const dialog = document.createElement("dialog");
    node._kooFinisherFormatDialog = dialog;
    dialog.style.display = "grid"; dialog.style.gap = "8px";
    const close = document.createElement("button"); close.textContent = "Close";
    dialog.append(select, close); document.body.append(dialog);
    select.onchange = () => { choose(select.value); dialog.close(); };
    close.onclick = () => dialog.close();
    dialog.onclose = () => {
      dialog.remove();
      if (node._kooFinisherFormatDialog === dialog) node._kooFinisherFormatDialog = null;
    };
    dialog.showModal();
  }
}

async function setOutputFolder(node) {
  node._kooFinisherStatus = "Selecting folder...";
  node.setDirtyCanvas(true, true);
  try {
    const response = await fetch("/koo/finisher/select_folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ output_folder: activeOutputFolder(node) }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Could not select folder");
    if (data.cancelled) {
      node._kooFinisherStatus = "Ready";
      return;
    }
    setExportState(node, "outputFolder", data.output_folder || "");
    node._kooFinisherStatus = "Output folder updated";
  } catch (error) {
    console.warn("[KOO FINISHER] Native folder picker failed, falling back to prompt", error);
    const answer = prompt("Output Folder", activeOutputFolder(node));
    if (answer === null) {
      node._kooFinisherStatus = "Ready";
      node.setDirtyCanvas(true, true);
      return;
    }
    setExportState(node, "outputFolder", answer.trim());
    node._kooFinisherStatus = "Output folder updated";
  } finally {
    node.setDirtyCanvas(true, true);
  }
}

async function openOutputFolder(node) {
  node._kooFinisherStatus = "Opening folder...";
  node.setDirtyCanvas(true, true);
  try {
    const response = await fetch("/koo/finisher/open_folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ output_folder: getState(node).outputFolder }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Could not open folder");
    if (!getState(node).outputFolder) node._kooFinisherDefaultOutputFolder = data.output_folder || node._kooFinisherDefaultOutputFolder;
    node._kooFinisherStatus = "Folder opened";
  } catch (error) {
    node._kooFinisherStatus = "Open folder failed";
    console.warn("[KOO FINISHER] Open folder failed", error);
  } finally {
    node.setDirtyCanvas(true, true);
  }
}

async function saveImage(node) {
  const state = getState(node);
  if (!state.cacheId || node._kooFinisherSaving) {
    node._kooFinisherStatus = state.cacheId ? "Saving..." : "Run workflow to load source image";
    node.setDirtyCanvas(true, true);
    return;
  }
  node._kooFinisherSaving = true;
  node._kooFinisherStatus = "Saving...";
  node.setDirtyCanvas(true, true);
  try {
    const response = await fetch("/koo/finisher/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cache_id: state.cacheId,
        settings: previewSettings(state),
        output_folder: state.outputFolder,
        filename_prefix: state.filenamePrefix,
        format: state.format,
        quality: state.quality,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Save failed");
    node._kooFinisherStatus = data.files?.[0]?.filename ? `Saved: ${data.files[0].filename}` : "Saved";
  } catch (error) {
    node._kooFinisherStatus = "Save failed";
    console.warn("[KOO FINISHER] Save failed", error);
  } finally {
    node._kooFinisherSaving = false;
    node.setDirtyCanvas(true, true);
  }
}

function hit(node, pos) {
  const matches = layout(node).hitboxes.filter((box) => pos[0] >= box.x && pos[0] <= box.x + box.w && pos[1] >= box.y && pos[1] <= box.y + box.h);
  return matches.find((box) => box.kind === "value") || matches.find((box) => box.kind === "field") || matches.find((box) => box.kind === "button") || matches[0];
}

function applyExecutionPayload(node, message) {
  const data = message?.message || message;
  const payload = Array.isArray(data?.koo_finisher) ? data.koo_finisher[0] : data?.koo_finisher;
  if (!payload?.cache_id) return;
  const state = getState(node);
  if (state.cacheId === payload.cache_id && node._kooFinisherPreviewImage) return;
  releasePreviews(node);
  state.cacheId = payload.cache_id;
  state.sourceWidth = Number(payload.width || 0);
  state.sourceHeight = Number(payload.height || 0);
  node._kooFinisherPreviewImage = null;
  node._kooFinisherStatus = state.sourceWidth && state.sourceHeight ? `Source cached: ${state.sourceWidth} x ${state.sourceHeight}` : "Source cached";
  requestPreview(node, true);
  schedulePreview(node, 10);
}

if (SHOULD_REGISTER_KOO_FINISHER) app.registerExtension({
  name: "KoO.StandaloneFinisher",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      getState(this);
      this._kooFinisherPresetRemoved = false;
      loadPresets(this);
      const widget = this.widgets?.find(w => w.name === "finisher_settings");
      if (widget) {
        widget.type = "hidden";
        widget.draw = () => {};
        widget.computeSize = () => [0, -4];
        widget.serializeValue = () => JSON.stringify(executionSettings(this));
      }
      syncExecutionSettings(this);
      this.size = this.size || [...DEFAULT_SIZE];
      this.resizable = true;
      this.min_width = MIN_WIDTH;
      this.min_height = MIN_HEIGHT;
      this.min_size = [MIN_WIDTH, MIN_HEIGHT];
      loadLuts(this, "/koo/finisher/lut_config");
      return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const result = onConfigure?.apply(this, arguments);
      const previousPresetLook = JSON.stringify(previewSettings(getState(this)));
      restoreState(this, info?.properties?.koo_finisher_state);
      if (previousPresetLook !== JSON.stringify(previewSettings(getState(this)))) customPreset(this);
      loadPresets(this);
      if (getState(this).cacheId) {
        if (this._kooFinisherOriginalCacheId !== getState(this).cacheId) requestPreview(this, true);
        schedulePreview(this, 10);
      }
      loadLuts(this, "/koo/finisher/lut_config");
      return result;
    };

    const serialize = nodeType.prototype.serialize;
    nodeType.prototype.serialize = function () {
      const data = serialize?.apply(this, arguments) || {};
      data.properties ||= {};
      const state = { ...getState(this) }; // Small cache reference only; images/URLs remain private.
      data.properties.koo_finisher_state = state;
      return data;
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const result = onExecuted?.apply(this, arguments);
      applyExecutionPayload(this, message);
      return result;
    };

    nodeType.prototype.onDrawForeground = function (ctx) {
      drawUI(this, ctx);
    };

    const onMouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (event, pos) {
      const item = hit(this, pos);
      if (this._kooFinisherNumericEditor && item?.kind !== "value") closeNumericEditor(this, true);
      if (!item) return onMouseDown?.apply(this, arguments);
      event?.preventDefault?.();
      event?.stopPropagation?.();
      this._kooFinisherPressedKey = item.kind === "button" ? item.key : "";
      if (item.kind === "value") {
        this._kooFinisherPressedKey = "";
        this._kooFinisherDragging = null;
        beginNumericEdit(this, item.name);
        this.setDirtyCanvas(true, true);
        return true;
      }
      if (item.kind === "field" && item.name === "prefix") editPrefix(this);
      if (item.kind === "button" && item.name === "lutSetFolder") saveFolder(this);
      if (item.kind === "button" && item.name === "refresh") loadLuts(this);
      if (item.kind === "button" && item.name === "presetSelect") presetMenu(this,event);
      if (item.kind === "button" && item.name === "presetMore") presetMenu(this,event,true);
      if (item.kind === "button" && item.name === "presetSave") presetAction(this,"save");
      if (item.kind === "button" && item.name === "lut") showLutMenu(this, event);
      if (item.kind === "button" && item.name === "outputSet") setOutputFolder(this);
      if (item.kind === "button" && item.name === "outputOpen") openOutputFolder(this);
      if (item.kind === "button" && item.name === "format") showFormatMenu(this, event);
      if (item.kind === "button" && item.name === "reset") resetNode(this);
      if (item.kind === "button" && item.name === "bypass") setState(this, "bypass", !getState(this).bypass);
      if (item.kind === "button" && item.name === "save") saveImage(this);
      if (item.kind === "button" && item.name === "compare") setExportState(this, "compare", !getState(this).compare);
      if (item.kind === "button" && item.name === "autoSave") setExportState(this, "autoSave", !getState(this).autoSave);
      if (item.kind === "slider" || item.kind === "wipe") {
        this._kooFinisherDragging = item.name || item.kind;
        updateSlider(this, this._kooFinisherDragging, pos);
      }
      this.setDirtyCanvas(true, true);
      return true;
    };

    const onMouseMove = nodeType.prototype.onMouseMove;
    nodeType.prototype.onMouseMove = function (event, pos) {
      if (this._kooFinisherDragging) {
        updateSlider(this, this._kooFinisherDragging, pos);
        return true;
      }
      const item = hit(this, pos);
      const key = hitKey(item);
      if (this._kooFinisherHoverKey !== key) {
        this._kooFinisherHoverKey = key;
        this.setDirtyCanvas(true, true);
      }
      const canvas = app.canvas?.canvas || app.canvasEl;
      if (canvas) canvas.style.cursor = item ? (item.kind === "value" ? "text" : (item.kind === "slider" || item.kind === "wipe") ? "ew-resize" : "pointer") : "";
      return onMouseMove?.apply(this, arguments);
    };

    const onMouseUp = nodeType.prototype.onMouseUp;
    nodeType.prototype.onMouseUp = function () {
      this._kooFinisherDragging = null;
      this._kooFinisherPressedKey = "";
      this.setDirtyCanvas(true, true);
      return onMouseUp?.apply(this, arguments);
    };

    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (this.size) {
        this.size[0] = Math.max(MIN_WIDTH, this.size[0]);
        this.size[1] = Math.max(MIN_HEIGHT, this.size[1]);
      }
      positionNumericEditor(this);
      return onResize?.apply(this, arguments);
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this._kooFinisherPresetRemoved = true;
      this._kooFinisherPresetAbort?.abort();
      if (this._kooFinisherPresetInput) this._kooFinisherPresetInput.onchange = null;
      this._kooFinisherPresetInput?.remove(); this._kooFinisherPresetInput = null;
      for (const timer of this._kooFinisherPresetTimers || []) clearTimeout(timer);
      for (const url of this._kooFinisherPresetUrls || []) URL.revokeObjectURL(url);
      this._kooFinisherPresetTimers?.clear(); this._kooFinisherPresetUrls?.clear();
      closeNumericEditor(this, false);
      this._kooFinisherLutsAbort?.abort();
      this._kooFinisherFormatDialog?.close();
      this._kooFinisherFormatDialog?.remove();
      this._kooFinisherFormatDialog = null;
      releasePreviews(this);
      return onRemoved?.apply(this, arguments);
    };
  },
});
