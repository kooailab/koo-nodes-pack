import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const NODE_NAME = "KooLoadImageCrop";
const DISPLAY_NAME = "KoO.Load Image & Crop";

console.log("[KoO.Load Image & Crop] frontend v4 loaded");

const KOO = {
    bg: "#070b09",
    panel: "#0c1410",
    button: "#171c19",
    border: "#234b31",
    text: "#d9f7df",
    muted: "#8fbd99",
    green: "#39ff88",
    overlay: "rgba(0, 0, 0, 0.58)",
};

const STATE_WIDGETS = [
    "crop_x",
    "crop_y",
    "crop_width",
    "crop_height",
    "crop_enabled",
    "crop_confirmed",
];

const DEFAULT_NODE_WIDTH = 760;
const DEFAULT_NODE_HEIGHT = 920;
const MIN_NODE_WIDTH = 700;
const MIN_NODE_HEIGHT = 820;
const WIDGET_HEIGHT = 24;
const WIDGET_GAP = 6;
const TITLE_HEIGHT = 34;
const PADDING = 14;
const BUTTON_HEIGHT = 30;
const LABEL_HEIGHT = 26;
const PREVIEW_MIN_HEIGHT = 520;
const RESIZE_HANDLE_SIZE = 32;
const BOTTOM_SAFE_PADDING = 40;

function findWidget(node, name) {
    return node.widgets?.find((widget) => widget.name === name);
}

function widgetValue(node, name, fallback = 0) {
    const widget = findWidget(node, name);
    return widget ? widget.value : fallback;
}

function setWidgetValue(node, name, value) {
    const widget = findWidget(node, name);
    if (!widget) return;
    widget.value = value;
    if (widget.callback) {
        widget.callback.call(widget, value, app.canvas, node, app.canvas?.graph_mouse);
    }
}

function markDirty(node) {
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
    app.graph?.change?.();
}

function hiddenWidgetSize() {
    return [0, -4];
}

function suppressDefaultPreview(node) {
    node.imgs = [];
    node.imageIndex = null;
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
    const params = new URLSearchParams({
        filename,
        type,
        subfolder,
        rand: Math.random().toString(),
    });
    return api.apiURL(`/view?${params.toString()}`);
}

function ensureState(node) {
    if (!node.kooCrop) {
        node.kooCrop = {
            image: null,
            imageValue: null,
            imageReady: false,
            cropMode: false,
            startPoint: null,
            hoverPoint: null,
            hitboxes: {},
            layout: null,
        };
    }
    if (!node.properties) node.properties = {};
    if (!node.properties.koo_crop) node.properties.koo_crop = {};
    return node.kooCrop;
}

function enforceMinimumSize(node) {
    const width = Math.max(node.size?.[0] ?? 0, MIN_NODE_WIDTH);
    const height = Math.max(node.size?.[1] ?? 0, MIN_NODE_HEIGHT);
    if (!node.size || node.size[0] !== width || node.size[1] !== height) {
        node.size = [width, height];
        markDirty(node);
    }
}

function toggleAIOptimize(node) {
    const current = String(widgetValue(node, "optimize_long_side", "Off"));
    const next = current === "Off" ? "1024" : "Off";
    setWidgetValue(node, "optimize_long_side", next);
    markDirty(node);
}

function loadPreviewImage(node) {
    const state = ensureState(node);
    suppressDefaultPreview(node);

    const imageWidget = findWidget(node, "image");
    const value = imageWidget?.value;
    if (value === state.imageValue) return;

    state.imageValue = value;
    state.image = null;
    state.imageReady = false;
    state.startPoint = null;
    state.hoverPoint = null;

    const url = imageValueToViewUrl(value);
    if (!url) {
        markDirty(node);
        return;
    }

    const image = new Image();
    image.onload = () => {
        state.image = image;
        state.imageReady = true;
        markDirty(node);
    };
    image.onerror = () => {
        state.image = null;
        state.imageReady = false;
        markDirty(node);
    };
    image.src = url;
}

function getLayout(node) {
    const state = ensureState(node);
    const width = Math.max(MIN_NODE_WIDTH, node.size[0]);
    const height = Math.max(MIN_NODE_HEIGHT, node.size[1]);
    const contentWidth = width - PADDING * 2;
    const visibleWidgets = (node.widgets ?? []).filter((widget) => !widget.hidden);

    const widgetTop = node.widgets_start_y ?? TITLE_HEIGHT;
    const widgetBottom = visibleWidgets.reduce((bottom, widget, index) => {
        const measuredHeight = widget.computeSize ? widget.computeSize(width)[1] : WIDGET_HEIGHT;
        const widgetHeight = Math.max(WIDGET_HEIGHT, Number.isFinite(measuredHeight) ? measuredHeight : WIDGET_HEIGHT);
        if (Number.isFinite(widget.last_y) && widget.last_y >= widgetTop) {
            return Math.max(bottom, widget.last_y + widgetHeight);
        }
        return Math.max(bottom, widgetTop + (index + 1) * (WIDGET_HEIGHT + WIDGET_GAP));
    }, widgetTop);

    const buttonsTop = widgetBottom + PADDING;
    const buttonGap = 10;
    const buttonWidth = (contentWidth - buttonGap * 2) / 3;
    const previewTop = buttonsTop + BUTTON_HEIGHT + PADDING;
    const labelTop = height - BOTTOM_SAFE_PADDING - LABEL_HEIGHT;
    const availablePreviewHeight = Math.max(PREVIEW_MIN_HEIGHT, labelTop - previewTop - PADDING);
    const previewHeight = availablePreviewHeight;
    const previewBox = {
        x: PADDING,
        y: previewTop,
        w: contentWidth,
        h: previewHeight,
    };

    let imageRect = { ...previewBox };
    if (state.imageReady && state.image?.naturalWidth && state.image?.naturalHeight) {
        const scale = Math.min(previewBox.w / state.image.naturalWidth, previewBox.h / state.image.naturalHeight);
        const drawnWidth = state.image.naturalWidth * scale;
        const drawnHeight = state.image.naturalHeight * scale;
        imageRect = {
            x: previewBox.x + (previewBox.w - drawnWidth) / 2,
            y: previewBox.y + (previewBox.h - drawnHeight) / 2,
            w: drawnWidth,
            h: drawnHeight,
        };
    }

    return {
        cropButton: { x: PADDING, y: buttonsTop, w: buttonWidth, h: BUTTON_HEIGHT },
        resetButton: { x: PADDING + buttonWidth + buttonGap, y: buttonsTop, w: buttonWidth, h: BUTTON_HEIGHT },
        optimizeButton: { x: PADDING + (buttonWidth + buttonGap) * 2, y: buttonsTop, w: buttonWidth, h: BUTTON_HEIGHT },
        previewBox,
        imageRect,
        label: { x: PADDING, y: previewBox.y + previewBox.h + PADDING, w: contentWidth - RESIZE_HANDLE_SIZE, h: LABEL_HEIGHT },
    };
}

function isInResizeHandle(node, pos) {
    return pos?.[0] >= node.size[0] - RESIZE_HANDLE_SIZE && pos?.[1] >= node.size[1] - RESIZE_HANDLE_SIZE;
}

function pointInRect(point, rect) {
    return point[0] >= rect.x && point[0] <= rect.x + rect.w && point[1] >= rect.y && point[1] <= rect.y + rect.h;
}

function previewToImage(node, point) {
    const state = ensureState(node);
    const rect = state.layout?.imageRect;
    const image = state.image;
    if (!rect || !image?.naturalWidth || !image?.naturalHeight) return null;
    if (!pointInRect(point, rect)) return null;

    const px = point[0] - rect.x;
    const py = point[1] - rect.y;
    return {
        x: Math.max(0, Math.min(image.naturalWidth - 1, Math.round((px / rect.w) * image.naturalWidth))),
        y: Math.max(0, Math.min(image.naturalHeight - 1, Math.round((py / rect.h) * image.naturalHeight))),
    };
}

function cropFromPoints(a, b, image) {
    const x0 = Math.max(0, Math.min(image.naturalWidth - 1, a.x));
    const y0 = Math.max(0, Math.min(image.naturalHeight - 1, a.y));
    const x1 = Math.max(0, Math.min(image.naturalWidth, b.x));
    const y1 = Math.max(0, Math.min(image.naturalHeight, b.y));
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const right = Math.max(x0, x1);
    const bottom = Math.max(y0, y1);
    return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
}

function imageCropToPreview(node, crop) {
    const state = ensureState(node);
    const rect = state.layout?.imageRect;
    const image = state.image;
    if (!rect || !image?.naturalWidth || !image?.naturalHeight) return null;

    return {
        x: rect.x + crop.x * (rect.w / image.naturalWidth),
        y: rect.y + crop.y * (rect.h / image.naturalHeight),
        w: crop.w * (rect.w / image.naturalWidth),
        h: crop.h * (rect.h / image.naturalHeight),
    };
}

function currentConfirmedCrop(node) {
    const enabled = Boolean(widgetValue(node, "crop_enabled", false));
    const confirmed = Boolean(widgetValue(node, "crop_confirmed", false));
    const width = Number(widgetValue(node, "crop_width", 0));
    const height = Number(widgetValue(node, "crop_height", 0));
    if (!enabled || !confirmed || width <= 0 || height <= 0) return null;
    return {
        x: Number(widgetValue(node, "crop_x", 0)),
        y: Number(widgetValue(node, "crop_y", 0)),
        w: width,
        h: height,
    };
}

function liveCrop(node) {
    const state = ensureState(node);
    if (!state.cropMode || !state.startPoint || !state.hoverPoint || !state.imageReady) {
        return currentConfirmedCrop(node);
    }
    return cropFromPoints(state.startPoint, state.hoverPoint, state.image);
}

function setConfirmedCrop(node, crop) {
    setWidgetValue(node, "crop_x", crop.x);
    setWidgetValue(node, "crop_y", crop.y);
    setWidgetValue(node, "crop_width", crop.w);
    setWidgetValue(node, "crop_height", crop.h);
    setWidgetValue(node, "crop_enabled", true);
    setWidgetValue(node, "crop_confirmed", true);
    node.properties.koo_crop = {
        x: crop.x,
        y: crop.y,
        width: crop.w,
        height: crop.h,
        enabled: true,
        confirmed: true,
    };
    markDirty(node);
}

function resetCrop(node) {
    const state = ensureState(node);
    state.cropMode = false;
    state.startPoint = null;
    state.hoverPoint = null;
    setWidgetValue(node, "crop_x", 0);
    setWidgetValue(node, "crop_y", 0);
    setWidgetValue(node, "crop_width", 0);
    setWidgetValue(node, "crop_height", 0);
    setWidgetValue(node, "crop_enabled", false);
    setWidgetValue(node, "crop_confirmed", false);
    node.properties.koo_crop = { x: 0, y: 0, width: 0, height: 0, enabled: false, confirmed: false };
    markDirty(node);
}

function roundedRect(ctx, x, y, width, height, radius) {
    if (ctx.roundRect) {
        ctx.roundRect(x, y, width, height, radius);
        return;
    }
    const r = Math.min(radius, width / 2, height / 2);
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
}

function drawButton(ctx, button) {
    const { rect, label, active, hover } = button;
    ctx.save();
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = active ? "#133b22" : hover ? "#202820" : KOO.button;
    ctx.strokeStyle = active ? KOO.green : hover ? "#2f6b42" : KOO.border;
    ctx.lineWidth = active ? 1.8 : 1;
    ctx.shadowColor = active || hover ? KOO.green : "transparent";
    ctx.shadowBlur = active ? 12 : hover ? 5 : 0;
    ctx.beginPath();
    roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = active ? KOO.green : KOO.text;
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.restore();
}

function drawClippedText(ctx, text, x, y, maxWidth) {
    let output = text;
    if (ctx.measureText(output).width > maxWidth) {
        while (output.length > 4 && ctx.measureText(`${output}...`).width > maxWidth) {
            output = output.slice(0, -1);
        }
        output = `${output}...`;
    }
    ctx.fillText(output, x, y);
}

function drawOverlay(ctx, imageRect, cropRect) {
    if (!cropRect) return;
    const right = cropRect.x + cropRect.w;
    const bottom = cropRect.y + cropRect.h;
    const imageRight = imageRect.x + imageRect.w;
    const imageBottom = imageRect.y + imageRect.h;

    ctx.fillStyle = KOO.overlay;
    ctx.fillRect(imageRect.x, imageRect.y, imageRect.w, Math.max(0, cropRect.y - imageRect.y));
    ctx.fillRect(imageRect.x, bottom, imageRect.w, Math.max(0, imageBottom - bottom));
    ctx.fillRect(imageRect.x, cropRect.y, Math.max(0, cropRect.x - imageRect.x), Math.max(0, cropRect.h));
    ctx.fillRect(right, cropRect.y, Math.max(0, imageRight - right), Math.max(0, cropRect.h));
}

function drawNodeUI(node, ctx) {
    const state = ensureState(node);
    enforceMinimumSize(node);
    suppressDefaultPreview(node);
    loadPreviewImage(node);

    const layout = getLayout(node);
    state.layout = layout;
    state.hitboxes = {
        crop: layout.cropButton,
        reset: layout.resetButton,
        optimize: layout.optimizeButton,
        preview: layout.imageRect,
    };
    const hover = state.hoverPos ?? [-1, -1];

    drawButton(ctx, {
        rect: layout.cropButton,
        label: "Crop",
        active: state.cropMode || Boolean(currentConfirmedCrop(node)),
        hover: pointInRect(hover, layout.cropButton),
    });
    drawButton(ctx, {
        rect: layout.resetButton,
        label: "Reset Crop",
        active: false,
        hover: pointInRect(hover, layout.resetButton),
    });
    drawButton(ctx, {
        rect: layout.optimizeButton,
        label: "AI Optimize",
        active: String(widgetValue(node, "optimize_long_side", "Off")) !== "Off",
        hover: pointInRect(hover, layout.optimizeButton),
    });

    ctx.save();
    ctx.fillStyle = KOO.panel;
    ctx.strokeStyle = KOO.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    roundedRect(ctx, layout.previewBox.x, layout.previewBox.y, layout.previewBox.w, layout.previewBox.h, 6);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(layout.previewBox.x, layout.previewBox.y, layout.previewBox.w, layout.previewBox.h);
    ctx.clip();

    if (state.imageReady && state.image) {
        ctx.drawImage(state.image, layout.imageRect.x, layout.imageRect.y, layout.imageRect.w, layout.imageRect.h);
    } else {
        ctx.fillStyle = KOO.muted;
        ctx.font = "13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Select or upload an image", layout.previewBox.x + layout.previewBox.w / 2, layout.previewBox.y + layout.previewBox.h / 2);
    }

    const crop = liveCrop(node);
    const previewCrop = crop ? imageCropToPreview(node, crop) : null;
    if (previewCrop) {
        drawOverlay(ctx, layout.imageRect, previewCrop);
        ctx.strokeStyle = KOO.green;
        ctx.lineWidth = 2;
        ctx.shadowColor = KOO.green;
        ctx.shadowBlur = 8;
        ctx.strokeRect(previewCrop.x, previewCrop.y, previewCrop.w, previewCrop.h);
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
    }
    ctx.restore();

    const label = crop
        ? `Crop: ${crop.w} x ${crop.h} px   x: ${crop.x}, y: ${crop.y}, w: ${crop.w}, h: ${crop.h}`
        : state.imageReady && state.image
            ? `Image: ${state.image.naturalWidth} x ${state.image.naturalHeight} px`
            : "Crop: full image";

    ctx.fillStyle = "#09100c";
    ctx.strokeStyle = KOO.border;
    ctx.beginPath();
    roundedRect(ctx, layout.label.x, layout.label.y, layout.label.w, layout.label.h, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = KOO.text;
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    drawClippedText(ctx, label, layout.label.x + 8, layout.label.y + layout.label.h / 2, layout.label.w - 16);
    ctx.restore();
}

function installNode(nodeType) {
    const originalCreated = nodeType.prototype.onNodeCreated;
    const originalDrawBackground = nodeType.prototype.onDrawBackground;
    const originalDrawForeground = nodeType.prototype.onDrawForeground;
    const originalMouseDown = nodeType.prototype.onMouseDown;
    const originalMouseMove = nodeType.prototype.onMouseMove;
    const originalMouseUp = nodeType.prototype.onMouseUp;
    const originalMouseLeave = nodeType.prototype.onMouseLeave;
    const originalComputeSize = nodeType.prototype.computeSize;

    nodeType.prototype.onNodeCreated = function () {
        originalCreated?.apply(this, arguments);
        ensureState(this);
        suppressDefaultPreview(this);
        this.color = "#14381f";
        this.bgcolor = KOO.bg;

        for (const name of STATE_WIDGETS) {
            const widget = findWidget(this, name);
            if (widget) {
                widget.hidden = true;
                widget.computeSize = hiddenWidgetSize;
            }
        }

        this.size[0] = Math.max(this.size[0], DEFAULT_NODE_WIDTH);
        this.size[1] = Math.max(this.size[1], DEFAULT_NODE_HEIGHT);
        markDirty(this);
    };

    nodeType.prototype.computeSize = function () {
        const size = originalComputeSize ? originalComputeSize.apply(this, arguments) : [MIN_NODE_WIDTH, MIN_NODE_HEIGHT];
        return [Math.max(size[0], MIN_NODE_WIDTH), Math.max(size[1], MIN_NODE_HEIGHT)];
    };

    nodeType.prototype.onDrawBackground = function () {
        suppressDefaultPreview(this);
        const result = originalDrawBackground?.apply(this, arguments);
        suppressDefaultPreview(this);
        return result;
    };

    nodeType.prototype.onDrawForeground = function () {
        suppressDefaultPreview(this);
        originalDrawForeground?.apply(this, arguments);
        suppressDefaultPreview(this);
        drawNodeUI(this, arguments[0]);
    };

    nodeType.prototype.onMouseDown = function (event, pos) {
        const state = ensureState(this);
        if (isInResizeHandle(this, pos)) return false;

        if (state.hitboxes.crop && pointInRect(pos, state.hitboxes.crop)) {
            state.cropMode = true;
            state.startPoint = null;
            state.hoverPoint = null;
            markDirty(this);
            return true;
        }

        if (state.hitboxes.reset && pointInRect(pos, state.hitboxes.reset)) {
            resetCrop(this);
            return true;
        }

        if (state.hitboxes.optimize && pointInRect(pos, state.hitboxes.optimize)) {
            toggleAIOptimize(this);
            return true;
        }

        if (state.cropMode && state.hitboxes.preview && pointInRect(pos, state.hitboxes.preview)) {
            const point = previewToImage(this, pos);
            if (!point) return true;

            if (!state.startPoint) {
                state.startPoint = point;
                state.hoverPoint = point;
            } else {
                const crop = cropFromPoints(state.startPoint, point, state.image);
                setConfirmedCrop(this, crop);
                state.cropMode = false;
                state.startPoint = null;
                state.hoverPoint = null;
            }
            markDirty(this);
            return true;
        }

        return false;
    };

    nodeType.prototype.onMouseMove = function (event, pos, graphCanvas) {
        const state = ensureState(this);
        if (isInResizeHandle(this, pos)) {
            if (graphCanvas?.canvas) graphCanvas.canvas.style.cursor = "";
            return false;
        }

        state.hoverPos = pos;
        const overPreview = Boolean(state.hitboxes.preview && pointInRect(pos, state.hitboxes.preview));
        if (graphCanvas?.canvas) graphCanvas.canvas.style.cursor = state.cropMode && overPreview ? "crosshair" : "";

        if (state.cropMode && state.startPoint && overPreview) {
            const point = previewToImage(this, pos);
            if (point) {
                state.hoverPoint = point;
                markDirty(this);
                return true;
            }
        }

        markDirty(this);
        return false;
    };

    nodeType.prototype.onMouseUp = function (event, pos) {
        if (isInResizeHandle(this, pos)) return false;
        return originalMouseUp ? originalMouseUp.apply(this, arguments) : false;
    };

    nodeType.prototype.onMouseLeave = function () {
        ensureState(this).hoverPos = null;
        if (app.canvas?.canvas) app.canvas.canvas.style.cursor = "";
        return originalMouseLeave ? originalMouseLeave.apply(this, arguments) : false;
    };
}

app.registerExtension({
    name: "KoO.LoadImageCrop.v4",
    beforeRegisterNodeDef(nodeType, nodeData) {
        const names = [
            nodeData?.name,
            nodeData?.display_name,
            nodeData?.displayName,
            nodeType?.comfyClass,
            nodeType?.title,
        ].filter(Boolean);

        if (names.includes(NODE_NAME) || names.includes(DISPLAY_NAME)) {
            console.info("[KoO.Load Image & Crop] frontend extension v4 registered");
            installNode(nodeType);
        }
    },
});
