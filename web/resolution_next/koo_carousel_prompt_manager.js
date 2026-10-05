import { app } from "../../../scripts/app.js";
import {
  DEFAULT_ACCENT,
  FONT_STACK,
  THEMES,
  SWATCHES,
  THEME_TOKENS,
  activeFill,
  activeForeground,
  buildAccentPalette,
  drawPaletteIcon,
  drawRound,
  drawText,
  ellipsize,
  hexToRgba,
  normalizeHex,
} from "./koo_ui_shared.js";

const NODE_NAME = "KoOCarouselPromptManager";
const UNLIMITED_NODE_NAME = "KoOCarouselUnlimited";
const PROMPT_COUNT = 6;
const SCENE_DELIMITER = "---SCENE---";
const MAX_SEED = 0xffffffffffffffffn;
const HEADER_OUTPUT_GUTTER = 120;
const SEED_MODES = ["Fixed", "Increment", "Random Per Prompt"];
const BACKEND_WIDGET_NAMES = [
  "active_prompts",
  "prompt_1",
  "prompt_2",
  "prompt_3",
  "prompt_4",
  "prompt_5",
  "prompt_6",
  "base_seed",
  "seed_mode",
  "filename_prefix",
];
const UNLIMITED_BACKEND_WIDGET_NAMES = [
  "scene_script",
  "base_seed",
  "seed_mode",
  "filename_prefix",
];

function clamp(value, low, high) {
  const number = Number(value);
  return Math.max(low, Math.min(high, Number.isFinite(number) ? Math.round(number) : low));
}

function safeSeed(value) {
  try {
    const integer = BigInt(String(value).trim() || "0");
    if (integer < 0n) return 0;
    if (integer > MAX_SEED) return Number(MAX_SEED);
    return Number(integer);
  } catch {
    return 0;
  }
}

function backendWidgets(node) {
  if (node.widgets?.length) return node.widgets;
  if (node._kooCarouselWidgets?.length) return node._kooCarouselWidgets;
  return [];
}

function widget(node, name) {
  return backendWidgets(node).find((item) => item?.name === name);
}

function getValue(node, name, fallback) {
  const item = widget(node, name);
  return item ? item.value : fallback;
}

function setValue(node, name, value) {
  const item = widget(node, name);
  if (!item) return;
  item.value = value;
  if (typeof item.callback === "function" && !node._kooCarouselSuppressCallbacks) {
    try {
      item.callback(value, app.canvas, node, app.canvas?.graph_mouse);
    } catch {
      node.properties = node.properties || {};
      node.properties.kooCarouselStatus = `Warning: ${name} callback failed`;
    }
  }
  updateStatus(node);
  node.setDirtyCanvas(true, true);
}

function detachNativeWidgets(node, values) {
  const current = node.widgets || [];
  const byName = new Map();
  for (const item of [...(node._kooCarouselWidgets || []), ...current]) {
    if (item?.name && BACKEND_WIDGET_NAMES.includes(item.name) && !byName.has(item.name)) {
      byName.set(item.name, item);
    }
  }
  node._kooCarouselWidgets = BACKEND_WIDGET_NAMES.map((name) => byName.get(name)).filter(Boolean);
  if (Array.isArray(values)) {
    BACKEND_WIDGET_NAMES.forEach((name, index) => {
      const item = widget(node, name);
      if (item && values[index] !== undefined) item.value = values[index];
    });
  }
  for (const item of node._kooCarouselWidgets) {
    item.hidden = true;
    item.type = "hidden";
    item.serialize = item.serialize === false ? true : item.serialize;
    item.draw = () => {};
    item.computeSize = () => [0, 0];
  }
  node.widgets = node._kooCarouselWidgets;
}

function ensureProperties(node) {
  node.properties = node.properties || {};
  const appearance = node.properties.kooCarouselAppearance || {};
  node.properties.kooCarouselAppearance = {
    schema_version: 1,
    theme: THEMES.includes(appearance.theme) ? appearance.theme : "Dark",
    accent: normalizeHex(appearance.accent) || DEFAULT_ACCENT,
    contrast: Boolean(appearance.contrast),
    open: appearance.open !== false,
  };
  node.properties.kooCarouselStatus = node.properties.kooCarouselStatus || "6 prompts active";
}

function palette(node) {
  ensureProperties(node);
  const appearance = node.properties.kooCarouselAppearance;
  const cache = node._kooCarouselPalette;
  if (!cache || cache.sourceAccent !== appearance.accent || cache.sourceContrast !== appearance.contrast) {
    node._kooCarouselPalette = {
      sourceAccent: appearance.accent,
      sourceContrast: appearance.contrast,
      ...buildAccentPalette(appearance.accent, appearance.contrast),
    };
  }
  return node._kooCarouselPalette;
}

function tokens(node) {
  ensureProperties(node);
  return THEME_TOKENS[node.properties.kooCarouselAppearance.theme] || THEME_TOKENS.Dark;
}

function activeCount(node) {
  return clamp(getValue(node, "active_prompts", PROMPT_COUNT), 1, PROMPT_COUNT);
}

function promptText(node, index) {
  return String(getValue(node, `prompt_${index}`, "") ?? "");
}

function updateStatus(node) {
  const count = activeCount(node);
  const empty = [];
  for (let index = 1; index <= count; index++) {
    if (promptText(node, index) === "") empty.push(index);
  }
  node.properties = node.properties || {};
  node.properties.kooCarouselStatus = empty.length
    ? `${count} prompts active - empty: ${empty.join(", ")}`
    : `${count} prompts active`;
}

function metrics(width) {
  const compact = width < 600;
  return {
    compact,
    pad: compact ? 12 : 16,
    gap: compact ? 8 : 10,
    sectionGap: compact ? 10 : 12,
    rowH: compact ? 30 : 32,
    buttonH: compact ? 28 : 30,
    slotH: compact ? 72 : 86,
  };
}

function addHit(hitboxes, kind, box, value) {
  hitboxes.push({ kind, value, ...box });
}

function makeLayout(node) {
  const minWidth = 520;
  const width = Math.max(minWidth, node.size?.[0] || 660);
  const m = metrics(width);
  const x = m.compact ? 14 : 18;
  const right = width - x;
  let y = m.compact ? 14 : 18;
  const hitboxes = [];
  const full = (height) => {
    const box = { x, y, w: right - x, h: height };
    y += height + m.sectionGap;
    return box;
  };

  const header = full(84);
  const headerContent = { x: header.x, y: header.y, w: Math.max(220, header.w - HEADER_OUTPUT_GUTTER), h: header.h };
  const badgeW = Math.min(128, Math.max(96, headerContent.w * 0.34));
  const badge = {
    x: headerContent.x + headerContent.w - badgeW,
    y: header.y + 20,
    w: badgeW,
    h: 36,
  };
  const setup = full(78);
  const countButtons = [];
  const countGap = 6;
  const countW = (setup.w - m.pad * 2 - countGap * (PROMPT_COUNT - 1)) / PROMPT_COUNT;
  for (let index = 1; index <= PROMPT_COUNT; index++) {
    const box = { x: setup.x + m.pad + (index - 1) * (countW + countGap), y: setup.y + 38, w: countW, h: m.buttonH };
    countButtons.push({ index, ...box });
    addHit(hitboxes, "activeCount", box, index);
  }

  const slots = full(46 + PROMPT_COUNT * (m.slotH + 8));
  const promptSlots = [];
  for (let index = 1; index <= PROMPT_COUNT; index++) {
    const box = { x: slots.x + m.pad, y: slots.y + 40 + (index - 1) * (m.slotH + 8), w: slots.w - m.pad * 2, h: m.slotH };
    promptSlots.push({ index, ...box });
    addHit(hitboxes, "prompt", box, index);
  }

  const seed = full(112);
  const seedModeButtons = [];
  const modeGap = 6;
  const modeY = seed.y + 70;
  const modeW = (seed.w - m.pad * 2 - modeGap * (SEED_MODES.length - 1)) / SEED_MODES.length;
  SEED_MODES.forEach((mode, index) => {
    const box = { x: seed.x + m.pad + index * (modeW + modeGap), y: modeY, w: modeW, h: m.buttonH };
    seedModeButtons.push({ mode, ...box });
    addHit(hitboxes, "seedMode", box, mode);
  });
  const seedEdit = { x: seed.x + m.pad, y: seed.y + 35, w: Math.min(230, seed.w - m.pad * 2), h: m.buttonH };
  addHit(hitboxes, "baseSeed", seedEdit, null);

  const naming = full(78);
  const prefixBox = { x: naming.x + m.pad, y: naming.y + 38, w: naming.w - m.pad * 2, h: m.buttonH };
  addHit(hitboxes, "prefix", prefixBox, null);

  const appearanceOpen = node.properties?.kooCarouselAppearance?.open !== false;
  const appearance = full(appearanceOpen ? 138 : 44);
  addHit(hitboxes, "appearanceToggle", { x: appearance.x + appearance.w - 38, y: appearance.y + 8, w: 28, h: 28 }, null);
  const themeButtons = [];
  const swatches = [];
  if (appearanceOpen) {
    const labelW = 62;
    const themeY = appearance.y + 42;
    const themeX = appearance.x + m.pad + labelW;
    const themeW = 64;
    THEMES.forEach((theme, index) => {
      const box = { x: themeX + index * (themeW + 6), y: themeY, w: themeW, h: 28 };
      themeButtons.push({ theme, ...box });
      addHit(hitboxes, "theme", box, theme);
    });
    const contrast = { x: themeX + THEMES.length * (themeW + 6) + 8, y: themeY, w: 92, h: 28 };
    addHit(hitboxes, "contrast", contrast, null);
    SWATCHES.forEach((color, index) => {
      const box = { x: themeX + index * 28, y: appearance.y + 91, w: 18, h: 18 };
      swatches.push({ color, ...box });
      addHit(hitboxes, "accent", box, color);
    });
    addHit(hitboxes, "customAccent", { x: themeX + SWATCHES.length * 28 + 8, y: appearance.y + 91, w: 42, h: 18 }, null);
    addHit(hitboxes, "resetAccent", { x: themeX + SWATCHES.length * 28 + 62, y: appearance.y + 91, w: 78, h: 18 }, null);
  }

  const desiredHeight = Math.max(820, y + 4);
  return {
    width,
    desiredHeight,
    hitboxes,
    header,
    headerContent,
    badge,
    setup,
    countButtons,
    slots,
    promptSlots,
    seed,
    seedEdit,
    seedModeButtons,
    naming,
    prefixBox,
    appearance,
    themeButtons,
    swatches,
    m,
  };
}

function drawSectionTitle(ctx, box, title, subtitle, t) {
  drawText(ctx, title.toUpperCase(), box.x + 14, box.y + 20, 12, t.textMuted, "850");
  if (subtitle) drawText(ctx, subtitle, box.x + box.w - 14, box.y + 20, 12, t.textMuted, "550", "right");
}

function promptPreview(ctx, text, width) {
  const value = text.trim();
  const fullText = value ? value.replace(/\s+/g, " ") : "Empty prompt";
  const ellipsis = "...";
  let visibleText = fullText;

  if (ctx.measureText(visibleText).width > width) {
    while (
      visibleText.length > 0 &&
      ctx.measureText(visibleText + ellipsis).width > width
    ) {
      visibleText = visibleText.slice(0, -1);
    }
    visibleText += ellipsis;
  }

  return visibleText;
}

function drawUI(node, ctx) {
  ensureProperties(node);
  updateStatus(node);
  const layout = makeLayout(node);
  const t = tokens(node);
  const p = palette(node);
  const appearance = node.properties.kooCarouselAppearance;
  const count = activeCount(node);
  const mode = getValue(node, "seed_mode", "Fixed");

  node._kooCarouselHitboxes = layout.hitboxes;
  if (!node.size || Math.abs(node.size[1] - layout.desiredHeight) > 2) {
    node.size = [layout.width, layout.desiredHeight];
  }

  drawRound(ctx, { x: 8, y: 8, w: layout.width - 16, h: layout.desiredHeight - 16 }, t.background, t.borderStrong, 1.5, 12);
  const headerPad = 2;
  const headerGap = 14;
  const headerTextW = Math.max(80, layout.badge.x - layout.headerContent.x - headerGap);
  drawText(ctx, ellipsize(ctx, "KoO Carousel", headerTextW), layout.headerContent.x + headerPad, layout.header.y + 25, layout.m.compact ? 26 : 31, t.text, "900");
  drawText(ctx, ellipsize(ctx, node.properties.kooCarouselStatus, headerTextW), layout.headerContent.x + headerPad, layout.header.y + 56, 14, t.textMuted, "600");
  drawRound(ctx, layout.badge, activeFill(p, 0.18), p.accentBorder, 1.5, 7);
  drawText(ctx, `${count} active`, layout.badge.x + layout.badge.w / 2, layout.badge.y + layout.badge.h / 2 + 1, 15, activeForeground(p, t.text), "850", "center");

  drawRound(ctx, layout.setup, t.surface, t.border, 1, 7);
  drawSectionTitle(ctx, layout.setup, "Carousel Setup", "Active Prompts", t);
  for (const button of layout.countButtons) {
    const active = count === button.index;
    drawRound(ctx, button, active ? activeFill(p, 0.2) : t.surfaceRaised, active ? p.accentBorder : t.border, active ? 2 : 1, 5);
    drawText(ctx, String(button.index), button.x + button.w / 2, button.y + button.h / 2 + 1, 14, active ? activeForeground(p, t.text) : t.textSecondary, "850", "center");
  }

  drawRound(ctx, layout.slots, t.surface, t.border, 1, 7);
  drawSectionTitle(ctx, layout.slots, "Prompt Slots", "click a slot to edit", t);
  for (const slot of layout.promptSlots) {
    const active = slot.index <= count;
    const empty = promptText(node, slot.index) === "";
    const fill = active ? (empty ? hexToRgba(appearance.accent, 0.08) : t.surfaceRaised) : t.background;
    const stroke = active ? (empty ? appearance.accent : t.borderStrong) : t.border;
    const slotPadX = 14;
    const slotPadTop = 12;
    const titleLineH = 18;
    const previewLineH = 20;
    const lineGap = 8;
    const titleY = slot.y + slotPadTop + titleLineH / 2;
    const previewY = titleY + titleLineH / 2 + lineGap + previewLineH / 2;
    const statusW = 72;
    const previewW = Math.max(40, slot.w - slotPadX * 2 - statusW - 10);
    const titleW = Math.max(40, slot.w - slotPadX * 2 - statusW - 10);
    const previewX = slot.x + slotPadX;
    const previewClipY = previewY - previewLineH / 2;
    drawRound(ctx, slot, fill, stroke, active ? 1.5 : 1, 7);
    drawText(ctx, ellipsize(ctx, `Prompt ${slot.index}`, titleW), slot.x + slotPadX, titleY, 13, active ? t.textSecondary : t.textMuted, "850");
    drawText(ctx, active ? "active" : "inactive", slot.x + slot.w - slotPadX, titleY, 12, active ? p.accentSolid : t.textMuted, "750", "right");
    ctx.save();
    ctx.font = `550 14px ${FONT_STACK}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.beginPath();
    ctx.rect(previewX, previewClipY, previewW, previewLineH);
    ctx.clip();
    ctx.fillStyle = active ? t.text : t.textMuted;
    ctx.fillText(promptPreview(ctx, promptText(node, slot.index), previewW), previewX, previewY);
    ctx.restore();
  }

  drawRound(ctx, layout.seed, t.surface, t.border, 1, 7);
  drawSectionTitle(ctx, layout.seed, "Seed Settings", "synchronized with prompt order", t);
  drawRound(ctx, layout.seedEdit, t.background, t.border, 1, 5);
  drawText(ctx, "Base Seed", layout.seedEdit.x + 12, layout.seedEdit.y + layout.seedEdit.h / 2 + 1, 12, t.textMuted, "800");
  drawText(ctx, ellipsize(ctx, String(getValue(node, "base_seed", 0)), layout.seedEdit.w - 94), layout.seedEdit.x + 92, layout.seedEdit.y + layout.seedEdit.h / 2 + 1, 13, t.text, "750");
  for (const button of layout.seedModeButtons) {
    const active = mode === button.mode;
    drawRound(ctx, button, active ? activeFill(p, 0.18) : t.surfaceRaised, active ? p.accentBorder : t.border, active ? 2 : 1, 5);
    drawText(ctx, ellipsize(ctx, button.mode, button.w - 16), button.x + button.w / 2, button.y + button.h / 2 + 1, 12, active ? activeForeground(p, t.text) : t.textSecondary, active ? "850" : "650", "center");
  }

  drawRound(ctx, layout.naming, t.surface, t.border, 1, 7);
  drawSectionTitle(ctx, layout.naming, "Output Naming", "prefix_01, prefix_02, ...", t);
  drawRound(ctx, layout.prefixBox, t.background, t.border, 1, 5);
  drawText(ctx, ellipsize(ctx, String(getValue(node, "filename_prefix", "KoO_Carousel")), layout.prefixBox.w - 26), layout.prefixBox.x + 13, layout.prefixBox.y + layout.prefixBox.h / 2 + 1, 14, t.text, "700");

  drawRound(ctx, layout.appearance, t.surface, t.border, 1, 7);
  drawPaletteIcon(ctx, layout.appearance.x + 14, layout.appearance.y + 13, appearance.accent, t);
  drawText(ctx, "APPEARANCE", layout.appearance.x + 42, layout.appearance.y + 22, 13, t.textMuted, "850");
  drawText(ctx, appearance.open !== false ? "^" : "v", layout.appearance.x + layout.appearance.w - 24, layout.appearance.y + 22, 15, t.textSecondary, "900", "center");
  if (appearance.open !== false) {
    drawText(ctx, "THEME", layout.appearance.x + 14, layout.appearance.y + 56, 12, t.textMuted, "850");
    for (const button of layout.themeButtons) {
      const active = appearance.theme === button.theme;
      drawRound(ctx, button, active ? activeFill(p, 0.16) : t.surfaceRaised, active ? p.accentBorder : t.border, active ? 2 : 1, 5);
      drawText(ctx, button.theme, button.x + button.w / 2, button.y + button.h / 2 + 1, 12, active ? activeForeground(p, t.text) : t.textSecondary, active ? "850" : "650", "center");
    }
    const contrast = layout.hitboxes.find((item) => item.kind === "contrast");
    drawRound(ctx, contrast, appearance.contrast ? activeFill(p, 0.18) : t.surfaceRaised, appearance.contrast ? p.accentBorder : t.border, appearance.contrast ? 2 : 1, 5);
    drawText(ctx, "Contrast", contrast.x + contrast.w / 2, contrast.y + contrast.h / 2 + 1, 11, appearance.contrast ? activeForeground(p, t.text) : t.textSecondary, "750", "center");
    drawText(ctx, "ACCENT", layout.appearance.x + 14, layout.appearance.y + 101, 12, t.textMuted, "850");
    for (const swatch of layout.swatches) {
      ctx.beginPath();
      ctx.arc(swatch.x + swatch.w / 2, swatch.y + swatch.h / 2, swatch.w / 2, 0, Math.PI * 2);
      ctx.fillStyle = swatch.color;
      ctx.fill();
      if (normalizeHex(swatch.color) === normalizeHex(appearance.accent)) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = appearance.contrast ? p.accentForeground : t.text;
        ctx.stroke();
      }
    }
    const custom = layout.hitboxes.find((item) => item.kind === "customAccent");
    const reset = layout.hitboxes.find((item) => item.kind === "resetAccent");
    drawText(ctx, "Hex", custom.x, custom.y + 9, 11, t.textMuted, "750");
    drawText(ctx, "Reset", reset.x, reset.y + 9, 11, t.textMuted, "750");
  }
}

function hit(node, pos) {
  const hitboxes = node._kooCarouselHitboxes || makeLayout(node).hitboxes;
  return hitboxes.find((box) => pos[0] >= box.x && pos[0] <= box.x + box.w && pos[1] >= box.y && pos[1] <= box.y + box.h);
}

function editPrompt(node, index) {
  const overlay = document.createElement("div");
  overlay.className = "koo-carousel-prompt-modal";
  overlay.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.54);display:flex;align-items:center;justify-content:center;";
  const panel = document.createElement("div");
  panel.style.cssText = "width:min(760px,calc(100vw - 42px));background:#15161A;border:1px solid #5A5F6B;border-radius:8px;padding:16px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#fff;box-shadow:0 18px 60px rgba(0,0,0,.38);";
  const title = document.createElement("div");
  title.textContent = `Prompt ${index}`;
  title.style.cssText = "font-size:14px;font-weight:850;color:#CED1D8;margin-bottom:10px;";
  const textarea = document.createElement("textarea");
  textarea.value = promptText(node, index);
  textarea.style.cssText = "box-sizing:border-box;width:100%;height:min(46vh,420px);resize:vertical;background:#22242A;color:#FFFFFF;border:1px solid #444852;border-radius:6px;padding:12px;font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;outline:none;";
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:12px;";
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  cancel.style.cssText = "background:#2D3037;color:#CED1D8;border:1px solid #444852;border-radius:6px;padding:8px 12px;font-weight:700;";
  const save = document.createElement("button");
  save.textContent = "Save";
  save.style.cssText = "background:#FF4FA3;color:#17191D;border:1px solid #FF4FA3;border-radius:6px;padding:8px 14px;font-weight:850;";
  actions.append(cancel, save);
  panel.append(title, textarea, actions);
  overlay.append(panel);
  document.body.append(overlay);
  textarea.focus();
  const close = () => overlay.remove();
  cancel.onclick = close;
  save.onclick = () => {
    setValue(node, `prompt_${index}`, textarea.value);
    close();
  };
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") save.click();
  });
}

function promptNumber(node, name, label) {
  const current = getValue(node, name, 0);
  const answer = prompt(label, String(current));
  if (answer === null) return;
  const number = name === "base_seed" ? safeSeed(answer) : Number(answer);
  if (!Number.isFinite(number)) return;
  setValue(node, name, number);
}

function promptTextValue(node, name, label) {
  const answer = prompt(label, String(getValue(node, name, "")));
  if (answer === null) return;
  setValue(node, name, answer);
}

function handleClick(node, pos) {
  const target = hit(node, pos);
  if (!target) return false;
  ensureProperties(node);
  switch (target.kind) {
    case "activeCount":
      setValue(node, "active_prompts", target.value);
      return true;
    case "prompt":
      editPrompt(node, target.value);
      return true;
    case "baseSeed":
      promptNumber(node, "base_seed", "Base Seed");
      return true;
    case "seedMode":
      setValue(node, "seed_mode", target.value);
      return true;
    case "prefix":
      promptTextValue(node, "filename_prefix", "Filename Prefix");
      return true;
    case "appearanceToggle":
      node.properties.kooCarouselAppearance.open = node.properties.kooCarouselAppearance.open === false;
      node.setDirtyCanvas(true, true);
      return true;
    case "theme":
      node.properties.kooCarouselAppearance.theme = target.value;
      node.setDirtyCanvas(true, true);
      return true;
    case "contrast":
      node.properties.kooCarouselAppearance.contrast = !node.properties.kooCarouselAppearance.contrast;
      node._kooCarouselPalette = null;
      node.setDirtyCanvas(true, true);
      return true;
    case "accent":
      node.properties.kooCarouselAppearance.accent = target.value;
      node._kooCarouselPalette = null;
      node.setDirtyCanvas(true, true);
      return true;
    case "customAccent": {
      const color = normalizeHex(prompt("Accent hex color", node.properties.kooCarouselAppearance.accent || DEFAULT_ACCENT));
      if (color) {
        node.properties.kooCarouselAppearance.accent = color;
        node._kooCarouselPalette = null;
        node.setDirtyCanvas(true, true);
      }
      return true;
    }
    case "resetAccent":
      node.properties.kooCarouselAppearance.accent = DEFAULT_ACCENT;
      node._kooCarouselPalette = null;
      node.setDirtyCanvas(true, true);
      return true;
    default:
      return false;
  }
}

function unlimitedWidgets(node) {
  if (node.widgets?.length) return node.widgets;
  if (node._kooCarouselUnlimitedWidgets?.length) return node._kooCarouselUnlimitedWidgets;
  return [];
}

function unlimitedWidget(node, name) {
  return unlimitedWidgets(node).find((item) => item?.name === name);
}

function getUnlimitedValue(node, name, fallback) {
  const item = unlimitedWidget(node, name);
  return item ? item.value : fallback;
}

function setUnlimitedValue(node, name, value) {
  const item = unlimitedWidget(node, name);
  if (!item) return;
  item.value = value;
  if (typeof item.callback === "function" && !node._kooCarouselSuppressCallbacks) {
    try {
      item.callback(value, app.canvas, node, app.canvas?.graph_mouse);
    } catch {
      node.properties = node.properties || {};
      node.properties.kooCarouselUnlimitedStatus = `Warning: ${name} callback failed`;
    }
  }
  updateUnlimitedStatus(node);
  node.setDirtyCanvas(true, true);
}

function detachUnlimitedNativeWidgets(node, values) {
  const current = node.widgets || [];
  const byName = new Map();
  for (const item of [...(node._kooCarouselUnlimitedWidgets || []), ...current]) {
    if (item?.name && UNLIMITED_BACKEND_WIDGET_NAMES.includes(item.name) && !byName.has(item.name)) {
      byName.set(item.name, item);
    }
  }
  node._kooCarouselUnlimitedWidgets = UNLIMITED_BACKEND_WIDGET_NAMES.map((name) => byName.get(name)).filter(Boolean);
  if (Array.isArray(values)) {
    UNLIMITED_BACKEND_WIDGET_NAMES.forEach((name, index) => {
      const item = unlimitedWidget(node, name);
      if (item && values[index] !== undefined) item.value = values[index];
    });
  }
  for (const item of node._kooCarouselUnlimitedWidgets) {
    item.hidden = true;
    item.type = "hidden";
    item.serialize = item.serialize === false ? true : item.serialize;
    item.draw = () => {};
    item.computeSize = () => [0, 0];
  }
  node.widgets = node._kooCarouselUnlimitedWidgets;
}

function ensureUnlimitedProperties(node) {
  node.properties = node.properties || {};
  const appearance = node.properties.kooCarouselAppearance || {};
  node.properties.kooCarouselAppearance = {
    schema_version: 1,
    theme: THEMES.includes(appearance.theme) ? appearance.theme : "Dark",
    accent: normalizeHex(appearance.accent) || DEFAULT_ACCENT,
    contrast: Boolean(appearance.contrast),
    open: appearance.open !== false,
  };
  node.properties.kooCarouselUnlimitedStatus = node.properties.kooCarouselUnlimitedStatus || "0 scenes detected";
}

function sceneScript(node) {
  return String(getUnlimitedValue(node, "scene_script", "") ?? "");
}

function parsedScenes(node) {
  const text = sceneScript(node);
  if (!text.includes(SCENE_DELIMITER)) return [];
  return text
    .split(SCENE_DELIMITER)
    .slice(1)
    .map((block) => block.trim())
    .filter(Boolean);
}

function updateUnlimitedStatus(node) {
  const scenes = parsedScenes(node);
  node.properties = node.properties || {};
  node.properties.kooCarouselUnlimitedStatus = `${scenes.length} scenes detected`;
}

function makeUnlimitedLayout(node) {
  const minWidth = 560;
  const width = Math.max(minWidth, node.size?.[0] || 700);
  const m = metrics(width);
  const x = m.compact ? 14 : 18;
  const right = width - x;
  let y = m.compact ? 14 : 18;
  const hitboxes = [];
  const full = (height) => {
    const box = { x, y, w: right - x, h: height };
    y += height + m.sectionGap;
    return box;
  };

  const header = full(84);
  const headerContent = { x: header.x, y: header.y, w: Math.max(240, header.w - HEADER_OUTPUT_GUTTER), h: header.h };
  const badgeW = Math.min(146, Math.max(112, headerContent.w * 0.36));
  const badge = {
    x: headerContent.x + headerContent.w - badgeW,
    y: header.y + 20,
    w: badgeW,
    h: 36,
  };

  const scriptH = Math.max(290, Math.min(560, (node.size?.[1] || 900) * 0.38));
  const script = full(scriptH);
  const scriptBox = { x: script.x + m.pad, y: script.y + 40, w: script.w - m.pad * 2, h: script.h - 58 };
  addHit(hitboxes, "sceneScript", scriptBox, null);

  const scenes = parsedScenes(node);
  const summaryRows = Math.min(6, scenes.length);
  const summary = full(scenes.length ? 52 + summaryRows * 26 : 56);

  const seed = full(112);
  const seedModeButtons = [];
  const modeGap = 6;
  const modeY = seed.y + 70;
  const modeW = (seed.w - m.pad * 2 - modeGap * (SEED_MODES.length - 1)) / SEED_MODES.length;
  SEED_MODES.forEach((mode, index) => {
    const box = { x: seed.x + m.pad + index * (modeW + modeGap), y: modeY, w: modeW, h: m.buttonH };
    seedModeButtons.push({ mode, ...box });
    addHit(hitboxes, "seedMode", box, mode);
  });
  const seedEdit = { x: seed.x + m.pad, y: seed.y + 35, w: Math.min(230, seed.w - m.pad * 2), h: m.buttonH };
  addHit(hitboxes, "baseSeed", seedEdit, null);

  const naming = full(78);
  const prefixBox = { x: naming.x + m.pad, y: naming.y + 38, w: naming.w - m.pad * 2, h: m.buttonH };
  addHit(hitboxes, "prefix", prefixBox, null);

  const appearanceOpen = node.properties?.kooCarouselAppearance?.open !== false;
  const appearance = full(appearanceOpen ? 138 : 44);
  addHit(hitboxes, "appearanceToggle", { x: appearance.x + appearance.w - 38, y: appearance.y + 8, w: 28, h: 28 }, null);
  const themeButtons = [];
  const swatches = [];
  if (appearanceOpen) {
    const labelW = 62;
    const themeY = appearance.y + 42;
    const themeX = appearance.x + m.pad + labelW;
    const themeW = 64;
    THEMES.forEach((theme, index) => {
      const box = { x: themeX + index * (themeW + 6), y: themeY, w: themeW, h: 28 };
      themeButtons.push({ theme, ...box });
      addHit(hitboxes, "theme", box, theme);
    });
    const contrast = { x: themeX + THEMES.length * (themeW + 6) + 8, y: themeY, w: 92, h: 28 };
    addHit(hitboxes, "contrast", contrast, null);
    SWATCHES.forEach((color, index) => {
      const box = { x: themeX + index * 28, y: appearance.y + 91, w: 18, h: 18 };
      swatches.push({ color, ...box });
      addHit(hitboxes, "accent", box, color);
    });
    addHit(hitboxes, "customAccent", { x: themeX + SWATCHES.length * 28 + 8, y: appearance.y + 91, w: 42, h: 18 }, null);
    addHit(hitboxes, "resetAccent", { x: themeX + SWATCHES.length * 28 + 62, y: appearance.y + 91, w: 78, h: 18 }, null);
  }

  const desiredHeight = Math.max(820, y + 4);
  return {
    width,
    desiredHeight,
    hitboxes,
    header,
    headerContent,
    badge,
    script,
    scriptBox,
    summary,
    summaryRows,
    seed,
    seedEdit,
    seedModeButtons,
    naming,
    prefixBox,
    appearance,
    themeButtons,
    swatches,
    m,
  };
}

function scriptPreview(text) {
  const scenes = parsedScenes({ widgets: [{ name: "scene_script", value: text }] });
  return scenes.length
    ? `${scenes.length} scene${scenes.length === 1 ? "" : "s"} separated by ${SCENE_DELIMITER}`
    : `Start each scene with ${SCENE_DELIMITER}`;
}

function drawUnlimitedUI(node, ctx) {
  ensureUnlimitedProperties(node);
  updateUnlimitedStatus(node);
  const layout = makeUnlimitedLayout(node);
  const t = tokens(node);
  const p = palette(node);
  const appearance = node.properties.kooCarouselAppearance;
  const scenes = parsedScenes(node);
  const mode = getUnlimitedValue(node, "seed_mode", "Fixed");

  node._kooCarouselUnlimitedHitboxes = layout.hitboxes;
  if (!node.size || Math.abs(node.size[1] - layout.desiredHeight) > 2) {
    node.size = [layout.width, layout.desiredHeight];
  }

  drawRound(ctx, { x: 8, y: 8, w: layout.width - 16, h: layout.desiredHeight - 16 }, t.background, t.borderStrong, 1.5, 12);
  const headerPad = 2;
  const headerGap = 14;
  const headerTextW = Math.max(80, layout.badge.x - layout.headerContent.x - headerGap);
  drawText(ctx, ellipsize(ctx, "KoO Carousel Unlimited", headerTextW), layout.headerContent.x + headerPad, layout.header.y + 25, layout.m.compact ? 24 : 29, t.text, "900");
  drawText(ctx, ellipsize(ctx, node.properties.kooCarouselUnlimitedStatus, headerTextW), layout.headerContent.x + headerPad, layout.header.y + 56, 14, t.textMuted, "600");
  drawRound(ctx, layout.badge, activeFill(p, 0.18), p.accentBorder, 1.5, 7);
  drawText(ctx, `${scenes.length} scenes`, layout.badge.x + layout.badge.w / 2, layout.badge.y + layout.badge.h / 2 + 1, 15, activeForeground(p, t.text), "850", "center");

  drawRound(ctx, layout.script, t.surface, t.border, 1, 7);
  drawSectionTitle(ctx, layout.script, "Scene Script", "click to edit", t);
  drawRound(ctx, layout.scriptBox, t.background, t.borderStrong, 1.2, 7);
  const script = sceneScript(node);
  const previewLines = script.trim() ? script.trim().split(/\r?\n/).slice(0, 9) : [scriptPreview(script)];
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.scriptBox.x + 12, layout.scriptBox.y + 12, layout.scriptBox.w - 24, layout.scriptBox.h - 24);
  ctx.clip();
  previewLines.forEach((line, index) => {
    const color = line.trim() === SCENE_DELIMITER ? p.accentSolid : t.text;
    drawText(ctx, ellipsize(ctx, line || " ", layout.scriptBox.w - 30), layout.scriptBox.x + 14, layout.scriptBox.y + 24 + index * 22, 13, color, line.trim() === SCENE_DELIMITER ? "850" : "550");
  });
  ctx.restore();

  drawRound(ctx, layout.summary, t.surface, t.border, 1, 7);
  drawSectionTitle(ctx, layout.summary, "Scenes Detected", scenes.length ? `${scenes.length} total` : "none", t);
  if (scenes.length) {
    for (let index = 0; index < layout.summaryRows; index++) {
      const y = layout.summary.y + 48 + index * 26;
      drawText(ctx, `Scene ${String(index + 1).padStart(2, "0")}`, layout.summary.x + 14, y, 12, p.accentSolid, "850");
      drawText(ctx, ellipsize(ctx, promptPreview(ctx, scenes[index], layout.summary.w - 120), layout.summary.w - 120), layout.summary.x + 92, y, 13, t.text, "600");
    }
    if (scenes.length > layout.summaryRows) {
      drawText(ctx, `+ ${scenes.length - layout.summaryRows} more`, layout.summary.x + layout.summary.w - 14, layout.summary.y + layout.summary.h - 16, 12, t.textMuted, "750", "right");
    }
  } else {
    drawText(ctx, `Add ${SCENE_DELIMITER} before each non-empty scene block.`, layout.summary.x + 14, layout.summary.y + 46, 13, t.textMuted, "650");
  }

  drawRound(ctx, layout.seed, t.surface, t.border, 1, 7);
  drawSectionTitle(ctx, layout.seed, "Seed Settings", "synchronized with scene order", t);
  drawRound(ctx, layout.seedEdit, t.background, t.border, 1, 5);
  drawText(ctx, "Base Seed", layout.seedEdit.x + 12, layout.seedEdit.y + layout.seedEdit.h / 2 + 1, 12, t.textMuted, "800");
  drawText(ctx, ellipsize(ctx, String(getUnlimitedValue(node, "base_seed", 0)), layout.seedEdit.w - 94), layout.seedEdit.x + 92, layout.seedEdit.y + layout.seedEdit.h / 2 + 1, 13, t.text, "750");
  for (const button of layout.seedModeButtons) {
    const active = mode === button.mode;
    drawRound(ctx, button, active ? activeFill(p, 0.18) : t.surfaceRaised, active ? p.accentBorder : t.border, active ? 2 : 1, 5);
    drawText(ctx, ellipsize(ctx, button.mode, button.w - 16), button.x + button.w / 2, button.y + button.h / 2 + 1, 12, active ? activeForeground(p, t.text) : t.textSecondary, active ? "850" : "650", "center");
  }

  drawRound(ctx, layout.naming, t.surface, t.border, 1, 7);
  drawSectionTitle(ctx, layout.naming, "Output Naming", "prefix_01, prefix_02, ...", t);
  drawRound(ctx, layout.prefixBox, t.background, t.border, 1, 5);
  drawText(ctx, ellipsize(ctx, String(getUnlimitedValue(node, "filename_prefix", "KoO_Carousel")), layout.prefixBox.w - 26), layout.prefixBox.x + 13, layout.prefixBox.y + layout.prefixBox.h / 2 + 1, 14, t.text, "700");

  drawRound(ctx, layout.appearance, t.surface, t.border, 1, 7);
  drawPaletteIcon(ctx, layout.appearance.x + 14, layout.appearance.y + 13, appearance.accent, t);
  drawText(ctx, "APPEARANCE", layout.appearance.x + 42, layout.appearance.y + 22, 13, t.textMuted, "850");
  drawText(ctx, appearance.open !== false ? "^" : "v", layout.appearance.x + layout.appearance.w - 24, layout.appearance.y + 22, 15, t.textSecondary, "900", "center");
  if (appearance.open !== false) {
    drawText(ctx, "THEME", layout.appearance.x + 14, layout.appearance.y + 56, 12, t.textMuted, "850");
    for (const button of layout.themeButtons) {
      const active = appearance.theme === button.theme;
      drawRound(ctx, button, active ? activeFill(p, 0.16) : t.surfaceRaised, active ? p.accentBorder : t.border, active ? 2 : 1, 5);
      drawText(ctx, button.theme, button.x + button.w / 2, button.y + button.h / 2 + 1, 12, active ? activeForeground(p, t.text) : t.textSecondary, active ? "850" : "650", "center");
    }
    const contrast = layout.hitboxes.find((item) => item.kind === "contrast");
    drawRound(ctx, contrast, appearance.contrast ? activeFill(p, 0.18) : t.surfaceRaised, appearance.contrast ? p.accentBorder : t.border, appearance.contrast ? 2 : 1, 5);
    drawText(ctx, "Contrast", contrast.x + contrast.w / 2, contrast.y + contrast.h / 2 + 1, 11, appearance.contrast ? activeForeground(p, t.text) : t.textSecondary, "750", "center");
    drawText(ctx, "ACCENT", layout.appearance.x + 14, layout.appearance.y + 101, 12, t.textMuted, "850");
    for (const swatch of layout.swatches) {
      ctx.beginPath();
      ctx.arc(swatch.x + swatch.w / 2, swatch.y + swatch.h / 2, swatch.w / 2, 0, Math.PI * 2);
      ctx.fillStyle = swatch.color;
      ctx.fill();
      if (normalizeHex(swatch.color) === normalizeHex(appearance.accent)) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = appearance.contrast ? p.accentForeground : t.text;
        ctx.stroke();
      }
    }
    const custom = layout.hitboxes.find((item) => item.kind === "customAccent");
    const reset = layout.hitboxes.find((item) => item.kind === "resetAccent");
    drawText(ctx, "Hex", custom.x, custom.y + 9, 11, t.textMuted, "750");
    drawText(ctx, "Reset", reset.x, reset.y + 9, 11, t.textMuted, "750");
  }
}

function unlimitedHit(node, pos) {
  const hitboxes = node._kooCarouselUnlimitedHitboxes || makeUnlimitedLayout(node).hitboxes;
  return hitboxes.find((box) => pos[0] >= box.x && pos[0] <= box.x + box.w && pos[1] >= box.y && pos[1] <= box.y + box.h);
}

function editSceneScript(node) {
  const overlay = document.createElement("div");
  overlay.className = "koo-carousel-unlimited-modal";
  overlay.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.54);display:flex;align-items:center;justify-content:center;";
  const panel = document.createElement("div");
  panel.style.cssText = "width:min(980px,calc(100vw - 42px));background:#15161A;border:1px solid #5A5F6B;border-radius:8px;padding:16px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#fff;box-shadow:0 18px 60px rgba(0,0,0,.38);";
  const title = document.createElement("div");
  title.textContent = "SCENE SCRIPT";
  title.style.cssText = "font-size:14px;font-weight:850;color:#CED1D8;margin-bottom:10px;";
  const textarea = document.createElement("textarea");
  textarea.value = sceneScript(node);
  textarea.placeholder = `${SCENE_DELIMITER}\nphotorealistic full-body frontal view...\n\n${SCENE_DELIMITER}\nclose-up portrait...`;
  textarea.style.cssText = "box-sizing:border-box;width:100%;height:min(70vh,720px);resize:vertical;background:#22242A;color:#FFFFFF;border:1px solid #444852;border-radius:6px;padding:12px;font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;outline:none;";
  const meta = document.createElement("div");
  meta.style.cssText = "margin-top:8px;color:#A9AFBD;font-size:12px;font-weight:650;";
  const refreshMeta = () => {
    const count = textarea.value.includes(SCENE_DELIMITER)
      ? textarea.value.split(SCENE_DELIMITER).slice(1).map((block) => block.trim()).filter(Boolean).length
      : 0;
    meta.textContent = `${count} scenes detected`;
  };
  textarea.addEventListener("input", refreshMeta);
  refreshMeta();
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:12px;";
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  cancel.style.cssText = "background:#2D3037;color:#CED1D8;border:1px solid #444852;border-radius:6px;padding:8px 12px;font-weight:700;";
  const save = document.createElement("button");
  save.textContent = "Save";
  save.style.cssText = "background:#FF4FA3;color:#17191D;border:1px solid #FF4FA3;border-radius:6px;padding:8px 14px;font-weight:850;";
  actions.append(cancel, save);
  panel.append(title, textarea, meta, actions);
  overlay.append(panel);
  document.body.append(overlay);
  textarea.focus();
  const close = () => overlay.remove();
  cancel.onclick = close;
  save.onclick = () => {
    setUnlimitedValue(node, "scene_script", textarea.value);
    close();
  };
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") save.click();
  });
}

function promptUnlimitedNumber(node, name, label) {
  const current = getUnlimitedValue(node, name, 0);
  const answer = prompt(label, String(current));
  if (answer === null) return;
  const number = name === "base_seed" ? safeSeed(answer) : Number(answer);
  if (!Number.isFinite(number)) return;
  setUnlimitedValue(node, name, number);
}

function promptUnlimitedTextValue(node, name, label) {
  const answer = prompt(label, String(getUnlimitedValue(node, name, "")));
  if (answer === null) return;
  setUnlimitedValue(node, name, answer);
}

function handleUnlimitedClick(node, pos) {
  const target = unlimitedHit(node, pos);
  if (!target) return false;
  ensureUnlimitedProperties(node);
  switch (target.kind) {
    case "sceneScript":
      editSceneScript(node);
      return true;
    case "baseSeed":
      promptUnlimitedNumber(node, "base_seed", "Base Seed");
      return true;
    case "seedMode":
      setUnlimitedValue(node, "seed_mode", target.value);
      return true;
    case "prefix":
      promptUnlimitedTextValue(node, "filename_prefix", "Filename Prefix");
      return true;
    case "appearanceToggle":
      node.properties.kooCarouselAppearance.open = node.properties.kooCarouselAppearance.open === false;
      node.setDirtyCanvas(true, true);
      return true;
    case "theme":
      node.properties.kooCarouselAppearance.theme = target.value;
      node.setDirtyCanvas(true, true);
      return true;
    case "contrast":
      node.properties.kooCarouselAppearance.contrast = !node.properties.kooCarouselAppearance.contrast;
      node._kooCarouselPalette = null;
      node.setDirtyCanvas(true, true);
      return true;
    case "accent":
      node.properties.kooCarouselAppearance.accent = target.value;
      node._kooCarouselPalette = null;
      node.setDirtyCanvas(true, true);
      return true;
    case "customAccent": {
      const color = normalizeHex(prompt("Accent hex color", node.properties.kooCarouselAppearance.accent || DEFAULT_ACCENT));
      if (color) {
        node.properties.kooCarouselAppearance.accent = color;
        node._kooCarouselPalette = null;
        node.setDirtyCanvas(true, true);
      }
      return true;
    }
    case "resetAccent":
      node.properties.kooCarouselAppearance.accent = DEFAULT_ACCENT;
      node._kooCarouselPalette = null;
      node.setDirtyCanvas(true, true);
      return true;
    default:
      return false;
  }
}

app.registerExtension({
  name: "KoO.CarouselPromptManager",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name === UNLIMITED_NODE_NAME) {
      const onNodeCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const result = onNodeCreated?.apply(this, arguments);
        ensureUnlimitedProperties(this);
        detachUnlimitedNativeWidgets(this);
        updateUnlimitedStatus(this);
        this.size = this.size || [700, 900];
        this.resizable = true;
        this.serialize_widgets = true;
        return result;
      };

      const onConfigure = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function (info) {
        const result = onConfigure?.apply(this, arguments);
        ensureUnlimitedProperties(this);
        detachUnlimitedNativeWidgets(this, info?.widgets_values);
        updateUnlimitedStatus(this);
        return result;
      };

      const serialize = nodeType.prototype.serialize;
      nodeType.prototype.serialize = function () {
        const data = serialize?.apply(this, arguments) || {};
        data.widgets_values = UNLIMITED_BACKEND_WIDGET_NAMES.map((name) => unlimitedWidget(this, name)?.value);
        data.properties = { ...(data.properties || {}), ...(this.properties || {}) };
        return data;
      };

      nodeType.prototype.onDrawForeground = function (ctx) {
        detachUnlimitedNativeWidgets(this);
        drawUnlimitedUI(this, ctx);
      };

      const onMouseDown = nodeType.prototype.onMouseDown;
      nodeType.prototype.onMouseDown = function (event, pos, canvas) {
        if (handleUnlimitedClick(this, pos)) return true;
        return onMouseDown?.apply(this, arguments);
      };

      const onResize = nodeType.prototype.onResize;
      nodeType.prototype.onResize = function () {
        const result = onResize?.apply(this, arguments);
        this.setDirtyCanvas(true, true);
        return result;
      };

      return;
    }

    if (nodeData.name !== NODE_NAME) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      ensureProperties(this);
      detachNativeWidgets(this);
      updateStatus(this);
      this.size = this.size || [660, 900];
      this.resizable = true;
      this.serialize_widgets = true;
      return result;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const result = onConfigure?.apply(this, arguments);
      ensureProperties(this);
      detachNativeWidgets(this, info?.widgets_values);
      updateStatus(this);
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
      if (handleClick(this, pos)) return true;
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
