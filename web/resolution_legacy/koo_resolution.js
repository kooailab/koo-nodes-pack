import { app } from "../../../scripts/app.js";

const NODE_CLASS = "KoOResolution";
const CUSTOM_KEY = "custom";
const DEFAULT_ACCENT = "#FF3048";
const DEFAULT_THEME = "dark";
const DEFAULT_MULTIPLIER = "1x";
const LAYOUT_VERSION = 4;
const MIN_DIMENSION = 64;
const MAX_DIMENSION = 16384;
const SNAP = 8;
const OUTPUT_SPECS = [
    { name: "width", type: "INT" },
    { name: "height", type: "INT" },
    { name: "resolution_label", type: "STRING" },
    { name: "latent", type: "LATENT" },
];

const RATIO_PRESETS = [
    { key: "1:1", width: 1024, height: 1024 },
    { key: "16:9", width: 1536, height: 864 },
    { key: "9:16", width: 864, height: 1536 },
    { key: "4:3", width: 1152, height: 864 },
    { key: "3:4", width: 864, height: 1152 },
    { key: "3:2", width: 1248, height: 832 },
    { key: "2:3", width: 832, height: 1248 },
    { key: "21:9", width: 1344, height: 576 },
    { key: "4:5", width: 1024, height: 1280 },
    { key: "Custom", width: 1024, height: 1024 },
];

const LATENT_MODES = ["Resolution Only", "Standard SD / SDXL", "SD3 / Flux 1 / Qwen Image", "Flux 2"];
const THEMES = {
    light: {
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
    dark: {
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
    spicy: {
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
        selectionStart: "#7B3FF2",
        selectionEnd: "#5A7BFF",
        purpleGlow: "rgba(123,63,242,0.35)",
    },
};
const SEMANTIC = {
    success: "#34D399",
    warning: "#F5B642",
    error: "#F87171",
    errorTint: "rgba(248, 113, 113, 0.14)",
};
const SWATCHES = [
    ["KoO Crimson", "#FF3048"],
    ["Saturated Azure", "#00BFFF"],
    ["Electric Blue", "#008CFF"],
    ["Orange", "#FF7A30"],
    ["Gold", "#D9B45B"],
    ["Green", "#34D399"],
    ["Violet", "#9B6CFF"],
    ["Pink", "#FF4FA3"],
    ["White", "#E8E8EC"],
];

function findWidget(node, name) {
    return node.widgets?.find((widget) => widget.name === name);
}

function markDirty(node) {
    node.setDirtyCanvas?.(true, true);
    node.graph?.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function finiteNumber(value, fallback) {
    if (value === null || value === undefined || typeof value === "boolean") {
        return fallback;
    }
    const number = Number(String(value).trim());
    return Number.isFinite(number) ? number : fallback;
}

function snapDimension(value, fallback = 1024) {
    const number = finiteNumber(value, fallback);
    return clamp(Math.round(number / SNAP) * SNAP, MIN_DIMENSION, MAX_DIMENSION);
}

function anchorDimension(value, fallback = 1024) {
    const number = finiteNumber(value, fallback);
    return clamp(Math.round(number), MIN_DIMENSION, MAX_DIMENSION);
}

function normalizeHex(value) {
    if (typeof value !== "string") {
        return null;
    }
    let text = value.trim();
    if (!text) {
        return null;
    }
    if (!text.startsWith("#")) {
        text = `#${text}`;
    }
    if (/^#[0-9a-fA-F]{3}$/.test(text)) {
        text = `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
    }
    return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toUpperCase() : null;
}

function hexToRgb(hex) {
    const normalized = normalizeHex(hex) || DEFAULT_ACCENT;
    return {
        r: parseInt(normalized.slice(1, 3), 16),
        g: parseInt(normalized.slice(3, 5), 16),
        b: parseInt(normalized.slice(5, 7), 16),
    };
}

function rgbToHex(rgb) {
    const part = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
    return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`.toUpperCase();
}

function mix(aHex, bHex, amount) {
    const a = hexToRgb(aHex);
    const b = hexToRgb(bHex);
    return rgbToHex({
        r: a.r + (b.r - a.r) * amount,
        g: a.g + (b.g - a.g) * amount,
        b: a.b + (b.b - a.b) * amount,
    });
}

function rgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function luminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const linear = [r, g, b].map((value) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function deriveAccent(hex) {
    const accent = normalizeHex(hex) || DEFAULT_ACCENT;
    return {
        accent,
        hover: mix(accent, "#FFFFFF", 0.22),
        dark: mix(accent, "#000000", 0.32),
        tint: rgba(accent, 0.16),
        tintStrong: rgba(accent, 0.30),
        focus: rgba(accent, 0.55),
        foreground: luminance(accent) > 0.5 ? "#202124" : "#FFFFFF",
    };
}

function ensureProperties(node) {
    node.properties = node.properties || {};
    const theme = String(node.properties.kooThemeMode || DEFAULT_THEME).toLowerCase();
    node.properties.kooThemeMode = THEMES[theme] ? theme : DEFAULT_THEME;
    node.properties.kooAccentColor = normalizeHex(node.properties.kooAccentColor) || DEFAULT_ACCENT;
    node.properties.kooRatioLocked = node.properties.kooRatioLocked === undefined ? true : Boolean(node.properties.kooRatioLocked);
    node.properties.kooLockedRatio = finiteNumber(node.properties.kooLockedRatio, 1);
    node.properties.kooLastEditedDimension = node.properties.kooLastEditedDimension === "height" ? "height" : "width";
    node.properties.kooRatioAnchor = node.properties.kooRatioAnchor === "height" ? "height" : "width";
    node.properties.kooResolutionMultiplier = node.properties.kooResolutionMultiplier === "2x" ? "2x" : DEFAULT_MULTIPLIER;
    node.properties.kooAppearanceOpen = Boolean(node.properties.kooAppearanceOpen);
}

function theme(node) {
    ensureProperties(node);
    return THEMES[node.properties.kooThemeMode] || THEMES.dark;
}

function accent(node) {
    ensureProperties(node);
    const value = node.properties.kooAccentColor;
    if (!node.__kooAccent || node.__kooAccent.accent !== value) {
        node.__kooAccent = deriveAccent(value);
    }
    return node.__kooAccent;
}

function setWidgetValue(node, name, value) {
    const widget = findWidget(node, name);
    if (!widget || widget.value === value) {
        return;
    }
    const oldValue = widget.value;
    node.__kooUpdating = true;
    widget.value = value;
    widget.callback?.(value, app.canvas, node);
    node.onWidgetChanged?.(name, value, oldValue, widget);
    node.__kooUpdating = false;
    node.graph?.incrementVersion?.();
}

function widgetValue(node, name, fallback) {
    const value = findWidget(node, name)?.value;
    return value === undefined || value === null || value === "" ? fallback : value;
}

function baseDimensions(node) {
    return {
        width: anchorDimension(widgetValue(node, "custom_width", 1024), 1024),
        height: anchorDimension(widgetValue(node, "custom_height", 1024), 1024),
    };
}

function multiplier(node) {
    ensureProperties(node);
    return node.properties.kooResolutionMultiplier === "2x" ? "2x" : "1x";
}

function finalDimensions(node) {
    const base = baseDimensions(node);
    const factor = multiplier(node) === "2x" ? 2 : 1;
    return {
        baseWidth: base.width,
        baseHeight: base.height,
        width: snapDimension(base.width * factor, base.width),
        height: snapDimension(base.height * factor, base.height),
        factor,
    };
}

function gcd(a, b) {
    return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

function ratioText(width, height) {
    const divisor = gcd(Math.round(width), Math.round(height)) || 1;
    return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function selectedRatio(node) {
    const value = String(widgetValue(node, "aspect_ratio", "Custom"));
    return RATIO_PRESETS.some((ratio) => ratio.key === value) ? value : "Custom";
}

function setBaseDimensions(node, width, height) {
    setWidgetValue(node, "resolution_preset", CUSTOM_KEY);
    setWidgetValue(node, "custom_width", anchorDimension(width, 1024));
    setWidgetValue(node, "custom_height", anchorDimension(height, 1024));
}

function defaultAnchorFor(width, height) {
    return height > width ? "height" : "width";
}

function activeRatioValue(node) {
    const selected = selectedRatio(node);
    const preset = RATIO_PRESETS.find((ratio) => ratio.key === selected && ratio.key !== "Custom");
    if (preset) {
        return preset.width / preset.height;
    }
    return finiteNumber(node.properties.kooLockedRatio, baseDimensions(node).width / baseDimensions(node).height);
}

function applyLockedAnchor(node, anchor) {
    const base = baseDimensions(node);
    const ratio = activeRatioValue(node);
    const safeAnchor = anchor === "height" ? "height" : "width";
    let width = base.width;
    let height = base.height;
    if (safeAnchor === "height") {
        height = anchorDimension(base.height, 1024);
        width = snapDimension(height * ratio, width);
    } else {
        width = anchorDimension(base.width, 1024);
        height = snapDimension(width / ratio, height);
    }
    node.properties.kooRatioAnchor = safeAnchor;
    node.properties.kooLastEditedDimension = safeAnchor;
    node.properties.kooLockedRatio = ratio;
    setBaseDimensions(node, width, height);
}

function setRatio(node, ratioKey) {
    const preset = RATIO_PRESETS.find((ratio) => ratio.key === ratioKey) || RATIO_PRESETS[0];
    setWidgetValue(node, "aspect_ratio", preset.key);
    if (preset.key === "Custom") {
        node.properties.kooRatioLocked = false;
        node.properties.kooLockedRatio = baseDimensions(node).width / baseDimensions(node).height;
    } else {
        setBaseDimensions(node, preset.width, preset.height);
        node.properties.kooRatioLocked = true;
        node.properties.kooLockedRatio = preset.width / preset.height;
        const anchor = defaultAnchorFor(preset.width, preset.height);
        node.properties.kooLastEditedDimension = anchor;
        node.properties.kooRatioAnchor = anchor;
    }
    node.graph?.incrementVersion?.();
    markDirty(node);
}

function setDimension(node, side, value) {
    ensureProperties(node);
    const current = baseDimensions(node);
    const next = anchorDimension(value, side === "width" ? current.width : current.height);
    if (node.properties.kooRatioLocked) {
        if (side === "width") {
            setBaseDimensions(node, next, current.height);
        } else {
            setBaseDimensions(node, current.width, next);
        }
        applyLockedAnchor(node, side);
    } else if (side === "width") {
        setBaseDimensions(node, next, current.height);
    } else {
        setBaseDimensions(node, current.width, next);
    }
    node.properties.kooLastEditedDimension = side === "height" ? "height" : "width";
    node.properties.kooRatioAnchor = node.properties.kooRatioLocked ? node.properties.kooLastEditedDimension : node.properties.kooRatioAnchor;
    if (!node.properties.kooRatioLocked) {
        if (selectedRatio(node) === "Custom") {
            node.properties.kooLockedRatio = baseDimensions(node).width / baseDimensions(node).height;
        }
    }
    node.graph?.incrementVersion?.();
    markDirty(node);
}

function toggleLock(node) {
    ensureProperties(node);
    if (node.properties.kooRatioLocked) {
        node.properties.kooRatioLocked = false;
    } else {
        const base = baseDimensions(node);
        const anchor = node.properties.kooLastEditedDimension || defaultAnchorFor(base.width, base.height);
        node.properties.kooRatioLocked = true;
        node.properties.kooLockedRatio = activeRatioValue(node);
        applyLockedAnchor(node, anchor);
    }
    node.graph?.incrementVersion?.();
    markDirty(node);
}

function setMultiplier(node, value) {
    const next = value === "2x" ? "2x" : "1x";
    ensureProperties(node);
    node.properties.kooResolutionMultiplier = next;
    setWidgetValue(node, "upscale_multiplier", next);
    markDirty(node);
}

function cycleLatentMode(node) {
    const current = String(widgetValue(node, "latent_mode", "Resolution Only"));
    const index = Math.max(0, LATENT_MODES.indexOf(current));
    setWidgetValue(node, "latent_mode", LATENT_MODES[(index + 1) % LATENT_MODES.length]);
    markDirty(node);
}

function setBatch(node, delta) {
    const current = finiteNumber(widgetValue(node, "batch_size", 1), 1);
    setWidgetValue(node, "batch_size", clamp(Math.round(current + delta), 1, 4096));
    markDirty(node);
}

function pointInRect(x, y, rect) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function roundedRect(ctx, x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function rect(ctx, box, fill, stroke = null, radius = 8) {
    roundedRect(ctx, box.x, box.y, box.w, box.h, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

function addBox(boxes, type, box, data = {}) {
    const result = { type, ...box, ...data };
    boxes.push(result);
    return result;
}

function calculateLayout(node, state = {}) {
    ensureProperties(node);
    const width = Math.max(430, node.size?.[0] || 540);
    const appearanceOpen = state.appearanceOpen ?? node.properties.kooAppearanceOpen;
    const padding = clamp(Math.round(width * 0.026), 10, 16);
    const gap = clamp(Math.round(width * 0.018), 8, 12);
    const contentWidth = width - padding * 2;
    const boxes = [];
    let y = state.y ?? 0;

    const summary = { x: padding, y: y + 6, w: contentWidth, h: 42 };
    y = summary.y + summary.h + gap;

    const previewW = clamp(Math.round(contentWidth * 0.28), 104, 150);
    const preview = { x: padding, y, w: previewW, h: 80 };
    const cols = width < 500 ? 2 : width > 620 ? 5 : 4;
    const ratioAreaX = preview.x + preview.w + gap;
    const ratioAreaW = contentWidth - preview.w - gap;
    const buttonGap = 7;
    const ratioButtonW = Math.floor((ratioAreaW - buttonGap * (cols - 1)) / cols);
    const ratioButtonH = 34;
    const ratioButtons = RATIO_PRESETS.map((ratio, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        return addBox(boxes, "ratio", {
            x: ratioAreaX + col * (ratioButtonW + buttonGap),
            y: y + row * (ratioButtonH + buttonGap),
            w: ratioButtonW,
            h: ratioButtonH,
        }, { ratio: ratio.key });
    });
    const ratioRows = Math.ceil(RATIO_PRESETS.length / cols);
    y += Math.max(preview.h, ratioRows * (ratioButtonH + buttonGap) - buttonGap) + gap;

    const dimW = Math.floor((contentWidth - gap - 42) / 2);
    const widthControl = addBox(boxes, "dimension", { x: padding, y, w: dimW, h: 36 }, { side: "width" });
    const lock = addBox(boxes, "lock", { x: widthControl.x + widthControl.w + Math.floor(gap / 2), y, w: 42, h: 36 });
    const heightControl = addBox(boxes, "dimension", { x: lock.x + lock.w + Math.ceil(gap / 2), y, w: dimW, h: 36 }, { side: "height" });
    y += 36 + gap;

    const segmentW = Math.floor((contentWidth - gap * 3) / 4);
    const mult1 = addBox(boxes, "multiplier", { x: padding, y, w: segmentW, h: 34 }, { value: "1x" });
    const mult2 = addBox(boxes, "multiplier", { x: mult1.x + mult1.w + gap, y, w: segmentW, h: 34 }, { value: "2x" });
    const latent = addBox(boxes, "latent", { x: mult2.x + mult2.w + gap, y, w: contentWidth - segmentW * 2 - gap * 3 - 92, h: 34 });
    const appearance = addBox(boxes, "appearance", { x: padding + contentWidth - 92, y, w: 92, h: 34 });
    y += 34 + gap;

    const batchMinus = addBox(boxes, "batch", { x: padding, y, w: 44, h: 34 }, { delta: -1 });
    const batch = { x: batchMinus.x + batchMinus.w + gap, y, w: contentWidth - 44 * 2 - gap * 2, h: 34 };
    const batchPlus = addBox(boxes, "batch", { x: padding + contentWidth - 44, y, w: 44, h: 34 }, { delta: 1 });
    y += 34;

    let drawer = null;
    if (appearanceOpen) {
        y += gap;
        const drawerH = width < 520 ? 144 : 112;
        const panel = { x: padding, y, w: contentWidth, h: drawerH };
        const themeW = Math.floor((contentWidth - 20 - gap * 2) / 3);
        const light = addBox(boxes, "theme", { x: panel.x + 10, y: panel.y + 12, w: themeW, h: 28 }, { value: "light" });
        const dark = addBox(boxes, "theme", { x: light.x + themeW + gap, y: light.y, w: themeW, h: 28 }, { value: "dark" });
        const spicy = addBox(boxes, "theme", { x: dark.x + themeW + gap, y: light.y, w: themeW, h: 28 }, { value: "spicy" });
        const swatchSize = 22;
        const swatchCols = width < 520 ? 5 : 9;
        const swatches = SWATCHES.map(([name, color], index) => addBox(boxes, "accent", {
            x: panel.x + 10 + (index % swatchCols) * (swatchSize + 7),
            y: panel.y + 52 + Math.floor(index / swatchCols) * 30,
            w: swatchSize,
            h: swatchSize,
        }, { name, color }));
        const actionY = width < 520 ? panel.y + 106 : panel.y + 82;
        const customAccent = addBox(boxes, "customAccent", { x: panel.x + 10, y: actionY, w: 54, h: 28 });
        const hexAccent = addBox(boxes, "hexAccent", { x: customAccent.x + 62, y: customAccent.y, w: 44, h: 28 });
        const resetAccent = addBox(boxes, "resetAccent", { x: hexAccent.x + 52, y: customAccent.y, w: 54, h: 28 });
        drawer = { panel, light, dark, spicy, swatches, customAccent, hexAccent, resetAccent };
        y += drawerH;
    }

    return {
        width,
        height: y + 8 - (state.y ?? 0),
        boxes,
        summary,
        preview,
        ratioButtons,
        widthControl,
        heightControl,
        lock,
        mult1,
        mult2,
        latent,
        appearance,
        batchMinus,
        batch,
        batchPlus,
        drawer,
    };
}

function localMouse(pos, node) {
    let [x, y] = pos;
    if (node.pos && node.size) {
        const graphX = x - node.pos[0];
        const graphY = y - node.pos[1];
        const fitsGraphCoords = graphX >= -20 && graphX <= node.size[0] + 20 && graphY >= -80 && graphY <= node.size[1] + 20;
        const looksGlobal = x > node.size[0] + 20 || y > node.size[1] + 20;
        if (looksGlobal && fitsGraphCoords) {
            x = graphX;
            y = graphY;
        }
    }
    return [x, y];
}

function text(ctx, value, x, y, color, font, align = "left") {
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(value, x, y);
    ctx.textAlign = "left";
}

function fitText(ctx, value, maxWidth) {
    let output = String(value);
    while (output.length > 4 && ctx.measureText(output).width > maxWidth) {
        output = `${output.slice(0, -4)}...`;
    }
    return output;
}

function drawRatioIcon(ctx, box, ratioKey, color) {
    const ratio = RATIO_PRESETS.find((item) => item.key === ratioKey) || RATIO_PRESETS[0];
    const ratioValue = ratio.width / ratio.height;
    const maxW = Math.min(30, box.w - 10);
    const maxH = 15;
    let w = maxW;
    let h = w / ratioValue;
    if (h > maxH) {
        h = maxH;
        w = h * ratioValue;
    }
    const x = box.x + box.w - maxW - 5 + (maxW - w) / 2;
    const y = box.y + (box.h - h) / 2;
    roundedRect(ctx, x, y, w, h, 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
}

function drawButton(ctx, box, label, active, hovered, tokens, acc) {
    const spicyActive = active && tokens.primaryPurple;
    const fill = spicyActive ? tokens.primaryPurple : active ? acc.tintStrong : hovered ? tokens.surfaceHover : tokens.surfaceRaised;
    const stroke = active ? (tokens.borderStrong || acc.focus) : tokens.border;
    const labelColor = spicyActive ? "#FFFFFF" : active ? acc.accent : tokens.textSecondary;
    rect(ctx, box, fill, stroke, 8);
    text(ctx, fitText(ctx, label, box.w - 12), box.x + box.w / 2, box.y + box.h / 2, labelColor, "700 12px Inter, system-ui, sans-serif", "center");
}

function drawLock(ctx, box, locked, hovered, tokens, acc, anchorText) {
    drawButton(ctx, box, "", locked, hovered, tokens, acc);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2 + 3;
    ctx.strokeStyle = locked ? acc.accent : tokens.textSecondary;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.rect(cx - 8, cy - 3, 16, 12);
    ctx.stroke();
    ctx.beginPath();
    if (locked) {
        ctx.arc(cx, cy - 3, 6, Math.PI, 0);
    } else {
        ctx.arc(cx + 4, cy - 3, 6, Math.PI, -0.2);
    }
    ctx.stroke();
    if (locked) {
        text(ctx, anchorText, box.x + box.w - 9, box.y + 9, acc.accent, "800 9px Inter, system-ui, sans-serif", "center");
    }
}

function drawPreview(ctx, box, final, tokens, acc) {
    const ratio = final.width / final.height;
    const maxW = box.w - 18;
    const maxH = box.h - 18;
    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
        h = maxH;
        w = h * ratio;
    }
    const x = box.x + (box.w - w) / 2;
    const y = box.y + (box.h - h) / 2;
    rect(ctx, box, tokens.surface, null, 8);
    roundedRect(ctx, x, y, w, h, 5);
    ctx.fillStyle = acc.tint;
    ctx.fill();
    ctx.strokeStyle = acc.accent;
    ctx.lineWidth = 1.8;
    ctx.stroke();
}

function drawPanel(ctx, node, widgetWidth, y) {
    const tokens = theme(node);
    const acc = accent(node);
    const layout = calculateLayout(node, { y });
    const final = finalDimensions(node);
    const base = baseDimensions(node);
    const ratio = selectedRatio(node);
    const mult = multiplier(node);
    const locked = Boolean(node.properties.kooRatioLocked);
    const batch = finiteNumber(widgetValue(node, "batch_size", 1), 1);
    const latentMode = String(widgetValue(node, "latent_mode", "Resolution Only"));

    rect(ctx, { x: 4, y: y + 1, w: Math.max(widgetWidth, layout.width) - 8, h: layout.height - 2 }, tokens.background, null, 10);

    const summaryText = mult === "2x"
        ? `${base.width} x ${base.height} -> ${final.width} x ${final.height}`
        : `${final.width} x ${final.height}`;
    text(ctx, summaryText, layout.summary.x + 2, layout.summary.y + 13, tokens.text, "800 20px Inter, system-ui, sans-serif");
    text(ctx, `${ratioText(final.width, final.height)} | ${mult} | Batch ${batch}`, layout.summary.x + 2, layout.summary.y + 33, tokens.textSecondary, "600 12px Inter, system-ui, sans-serif");
    ctx.fillStyle = acc.accent;
    ctx.fillRect(layout.summary.x, layout.summary.y + layout.summary.h - 3, 58, 2);

    drawPreview(ctx, layout.preview, final, tokens, acc);

    for (const box of layout.ratioButtons) {
        const active = ratio === box.ratio;
        const hovered = node.__kooHover === box;
        const spicyActive = active && tokens.primaryPurple;
        rect(ctx, box, spicyActive ? tokens.primaryPurple : active ? acc.tintStrong : hovered ? tokens.surfaceHover : tokens.surfaceRaised, active ? (tokens.borderStrong || acc.focus) : tokens.border, 8);
        text(ctx, box.ratio, box.x + 9, box.y + box.h / 2, spicyActive ? "#FFFFFF" : active ? acc.accent : tokens.text, "700 12px Inter, system-ui, sans-serif");
        drawRatioIcon(ctx, box, box.ratio, active ? acc.accent : tokens.textMuted);
    }

    drawButton(ctx, layout.widthControl, `W ${base.width}`, false, node.__kooHover === layout.widthControl, tokens, acc);
    drawLock(ctx, layout.lock, locked, node.__kooHover === layout.lock, tokens, acc, node.properties.kooRatioAnchor === "height" ? "H" : "W");
    drawButton(ctx, layout.heightControl, `H ${base.height}`, false, node.__kooHover === layout.heightControl, tokens, acc);

    drawButton(ctx, layout.mult1, "x1", mult === "1x", node.__kooHover === layout.mult1, tokens, acc);
    drawButton(ctx, layout.mult2, "x2", mult === "2x", node.__kooHover === layout.mult2, tokens, acc);
    drawButton(ctx, layout.latent, fitText(ctx, latentMode, layout.latent.w - 12), latentMode !== "Resolution Only", node.__kooHover === layout.latent, tokens, acc);
    drawButton(ctx, layout.appearance, "Palette", node.properties.kooAppearanceOpen, node.__kooHover === layout.appearance, tokens, acc);

    drawButton(ctx, layout.batchMinus, "-", false, node.__kooHover === layout.batchMinus, tokens, acc);
    rect(ctx, layout.batch, tokens.surface, tokens.border, 8);
    text(ctx, `Batch ${batch}`, layout.batch.x + layout.batch.w / 2, layout.batch.y + layout.batch.h / 2, acc.accent, "800 13px Inter, system-ui, sans-serif", "center");
    drawButton(ctx, layout.batchPlus, "+", false, node.__kooHover === layout.batchPlus, tokens, acc);

    if (layout.drawer) {
        rect(ctx, layout.drawer.panel, tokens.surface, tokens.border, 10);
        for (const item of [layout.drawer.light, layout.drawer.dark, layout.drawer.spicy]) {
            const active = node.properties.kooThemeMode === item.value;
            drawButton(ctx, item, item.value[0].toUpperCase() + item.value.slice(1), active, node.__kooHover === item, tokens, acc);
        }
        for (const swatch of layout.drawer.swatches) {
            const active = normalizeHex(swatch.color) === node.properties.kooAccentColor;
            rect(ctx, swatch, swatch.color, active ? tokens.text : tokens.border, 6);
        }
        drawButton(ctx, layout.drawer.customAccent, "Pick", false, node.__kooHover === layout.drawer.customAccent, tokens, acc);
        drawButton(ctx, layout.drawer.hexAccent, "Hex", Boolean(node.__kooInvalidAccent), node.__kooHover === layout.drawer.hexAccent, tokens, node.__kooInvalidAccent ? { ...acc, accent: SEMANTIC.error, tintStrong: SEMANTIC.errorTint, focus: SEMANTIC.error } : acc);
        drawButton(ctx, layout.drawer.resetAccent, "Reset", node.properties.kooAccentColor === DEFAULT_ACCENT, node.__kooHover === layout.drawer.resetAccent, tokens, acc);
    }
}

function promptDimension(node, side) {
    const base = baseDimensions(node);
    const current = side === "width" ? base.width : base.height;
    const value = window.prompt(side === "width" ? "Base width" : "Base height", String(current));
    if (value !== null) {
        setDimension(node, side, value);
    }
}

function promptHex(node) {
    const value = window.prompt("Accent hex color", node.properties.kooAccentColor || DEFAULT_ACCENT);
    if (value === null) {
        return;
    }
    const normalized = normalizeHex(value);
    if (!normalized) {
        node.__kooInvalidAccent = true;
        markDirty(node);
        return;
    }
    node.__kooInvalidAccent = false;
    node.properties.kooAccentColor = normalized;
    node.__kooAccent = deriveAccent(normalized);
    node.graph?.incrementVersion?.();
    markDirty(node);
}

function pickColor(node) {
    const input = document.createElement("input");
    input.type = "color";
    input.value = normalizeHex(node.properties.kooAccentColor) || DEFAULT_ACCENT;
    input.style.position = "fixed";
    input.style.left = "-1000px";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
        const normalized = normalizeHex(input.value);
        if (normalized) {
            node.__kooInvalidAccent = false;
            node.properties.kooAccentColor = normalized;
            node.__kooAccent = deriveAccent(normalized);
            node.graph?.incrementVersion?.();
            markDirty(node);
        }
        input.remove();
    }, { once: true });
    input.click();
}

function handleBox(node, box) {
    if (box.type === "ratio") {
        setRatio(node, box.ratio);
    } else if (box.type === "dimension") {
        promptDimension(node, box.side);
    } else if (box.type === "lock") {
        toggleLock(node);
    } else if (box.type === "multiplier") {
        setMultiplier(node, box.value);
    } else if (box.type === "latent") {
        cycleLatentMode(node);
    } else if (box.type === "batch") {
        setBatch(node, box.delta);
    } else if (box.type === "appearance") {
        node.properties.kooAppearanceOpen = !node.properties.kooAppearanceOpen;
        node.graph?.incrementVersion?.();
        const layout = calculateLayout(node, { y: 0 });
        node.size[1] = layout.height + 80;
    } else if (box.type === "theme") {
        node.properties.kooThemeMode = THEMES[box.value] ? box.value : DEFAULT_THEME;
        node.bgcolor = theme(node).background;
        node.color = theme(node).border;
        node.graph?.incrementVersion?.();
    } else if (box.type === "accent") {
        node.__kooInvalidAccent = false;
        node.properties.kooAccentColor = normalizeHex(box.color) || DEFAULT_ACCENT;
        node.__kooAccent = deriveAccent(node.properties.kooAccentColor);
        node.graph?.incrementVersion?.();
    } else if (box.type === "customAccent") {
        pickColor(node);
    } else if (box.type === "hexAccent") {
        promptHex(node);
    } else if (box.type === "resetAccent") {
        node.__kooInvalidAccent = false;
        node.properties.kooAccentColor = DEFAULT_ACCENT;
        node.__kooAccent = deriveAccent(DEFAULT_ACCENT);
        node.graph?.incrementVersion?.();
    }
    markDirty(node);
}

function createPanelWidget(node) {
    return {
        name: "koo_resolution_panel",
        type: "koo_resolution_panel",
        serialize: false,
        _y: 0,
        computeSize(width) {
            const layout = calculateLayout(node, { y: 0 });
            return [Math.max(430, width), layout.height];
        },
        draw(ctx, node, widgetWidth, y) {
            this._y = y;
            drawPanel(ctx, node, widgetWidth, y);
        },
        mouse(event, pos, node) {
            const [x, y] = localMouse(pos, node);
            const layout = calculateLayout(node, { y: this._y });
            const hit = layout.boxes.find((box) => pointInRect(x, y, box));
            if (event.type === "pointermove" || event.type === "mousemove") {
                if (node.__kooHover !== hit) {
                    node.__kooHover = hit || null;
                    markDirty(node);
                }
                return false;
            }
            if ((event.type === "pointerdown" || event.type === "mousedown") && hit) {
                handleBox(node, hit);
                return true;
            }
            return false;
        },
    };
}

function hideWidget(widget) {
    if (!widget || widget.__kooHidden) {
        return;
    }
    widget.__kooHidden = true;
    widget.computeSize = () => [0, 0];
    widget.draw = () => {};
}

function wrapWidget(node, widget) {
    if (!widget || widget.__kooWrapped) {
        return;
    }
    const original = widget.callback;
    widget.__kooWrapped = true;
    widget.callback = function (...args) {
        const result = original?.apply(this, args);
        if (!node.__kooUpdating && (widget.name === "custom_width" || widget.name === "custom_height")) {
            setDimension(node, widget.name === "custom_height" ? "height" : "width", widget.value);
            return result;
        }
        markDirty(node);
        return result;
    };
}

function normalizeOutputSlots(node) {
    if (!Array.isArray(node.outputs)) {
        return;
    }
    let changed = false;
    if (node.outputs.length > OUTPUT_SPECS.length) {
        node.outputs.length = OUTPUT_SPECS.length;
        changed = true;
    }
    for (let index = 0; index < Math.min(node.outputs.length, OUTPUT_SPECS.length); index++) {
        const expected = OUTPUT_SPECS[index];
        const output = node.outputs[index];
        if (!output) {
            continue;
        }
        if (output.name !== expected.name) {
            output.name = expected.name;
            changed = true;
        }
        if (output.type !== expected.type) {
            output.type = expected.type;
            changed = true;
        }
    }
    if (changed) {
        node.graph?.incrementVersion?.();
    }
}

function setupNode(node) {
    if (node.__kooReady) {
        return;
    }
    node.__kooReady = true;
    const previousLayoutVersion = finiteNumber(node.properties?.kooLayoutVersion, 0);
    ensureProperties(node);
    normalizeOutputSlots(node);
    node.bgcolor = theme(node).background;
    node.color = theme(node).border;

    if (findWidget(node, "upscale_multiplier")?.value) {
        node.properties.kooResolutionMultiplier = findWidget(node, "upscale_multiplier").value === "2x" ? "2x" : "1x";
    }

    for (const widget of node.widgets || []) {
        wrapWidget(node, widget);
        hideWidget(widget);
    }

    const panel = createPanelWidget(node);
    node.addCustomWidget(panel);
    node.widgets = [panel, ...node.widgets.filter((widget) => widget !== panel)];

    const originalMove = node.onMouseMove;
    const originalLeave = node.onMouseLeave;
    const originalResize = node.onResize;
    node.onMouseMove = function (event, pos, canvas) {
        panel.mouse(event, pos, this);
        return originalMove?.apply(this, arguments);
    };
    node.onMouseLeave = function (...args) {
        this.__kooHover = null;
        markDirty(this);
        return originalLeave?.apply(this, args);
    };
    node.onResize = function (...args) {
        this.__kooManualSizeTouched = true;
        return originalResize?.apply(this, args);
    };

    const defaultLayout = calculateLayout(node, { y: 0 });
    node.size = node.size || [540, defaultLayout.height + 80];
    const obsoleteGiantSize = previousLayoutVersion < LAYOUT_VERSION && (node.size[0] > 760 || node.size[1] > 680);
    if (obsoleteGiantSize) {
        node.size[0] = 540;
        node.size[1] = defaultLayout.height + 80;
    } else {
        if (node.size[0] < 430) {
            node.size[0] = 540;
        }
        if (!node.size[1] || node.size[1] < 360) {
            node.size[1] = defaultLayout.height + 80;
        }
    }
    node.properties.kooLayoutVersion = LAYOUT_VERSION;
}

app.registerExtension({
    name: "koo.resolution",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_CLASS && nodeType.comfyClass !== NODE_CLASS) {
            return;
        }
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = onNodeCreated?.apply(this, arguments);
            setupNode(this);
            return result;
        };
    },
    async nodeCreated(node) {
        if (node.comfyClass === NODE_CLASS || node.type === NODE_CLASS) {
            setupNode(node);
        }
    },
    async afterConfigureGraph() {
        for (const node of app.graph?._nodes || []) {
            if (node.comfyClass === NODE_CLASS || node.type === NODE_CLASS) {
                setupNode(node);
                markDirty(node);
            }
        }
    },
});
