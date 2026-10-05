import { app } from "../../../scripts/app.js";

const EXTENSION_NAME = "koo_on_off_manager";
const NODE_CLASS_NAME = "KoOOnOffManager";
const STATE_PROPERTY = "koo_on_off_state";
const OFF_STATE = "OFF";
const ON_STATE = "ON";
const ADD_ID_INPUT_NAME = "add target ID";
const ON_COLORS = {
    color: "#174c28",
    bgcolor: "#1f7a3a",
};
const OFF_COLORS = {
    color: "#5c1919",
    bgcolor: "#b32626",
};

function getLiteGraphConstant(name, fallback) {
    if (window.LiteGraph && typeof window.LiteGraph[name] !== "undefined") {
        return window.LiteGraph[name];
    }

    console.warn(
        `[${EXTENSION_NAME}] LiteGraph.${name} was not found; using fallback value ${fallback}.`
    );
    return fallback;
}

function parseTargetNodeIds(rawValue) {
    return String(rawValue ?? "")
        .split(/[,\n\r]+/)
        .map((id) => id.trim().replace(/^#/, "").trim())
        .filter((id) => /^\d+$/.test(id))
        .filter(Boolean);
}

function findWidget(node, widgetName) {
    return node.widgets?.find((widget) => widget.name === widgetName);
}

function findToggleWidget(node) {
    return node.widgets?.find(
        (widget) =>
            widget.kooOnOffToggle === true ||
            (widget.type === "button" && (widget.name === ON_STATE || widget.name === OFF_STATE))
    );
}

function getWidgetValue(node, widgetName, fallback = "") {
    const widget = findWidget(node, widgetName);
    return widget?.value ?? fallback;
}

function setWidgetValue(node, widgetName, value) {
    const widget = findWidget(node, widgetName);
    if (widget) {
        widget.value = value;
    }
}

function findNodeById(graph, id) {
    if (!graph) {
        return null;
    }

    const idText = String(id);
    const idNumber = Number(id);

    if (Number.isFinite(idNumber) && typeof graph.getNodeById === "function") {
        const foundByNumericId = graph.getNodeById(idNumber);
        if (foundByNumericId) {
            return foundByNumericId;
        }
    }

    return graph._nodes?.find((node) => String(node.id) === idText) ?? null;
}

function markGraphChanged(graph) {
    app.graph?.setDirtyCanvas?.(true, true);
    graph?.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
    graph?.change?.();
}

function getExistingTargetIdSet(managerNode) {
    return new Set(parseTargetNodeIds(getWidgetValue(managerNode, "target_node_ids")));
}

function writeTargetIds(managerNode, ids) {
    setWidgetValue(managerNode, "target_node_ids", ids.join("\n"));
    markGraphChanged(app.graph);
}

function addTargetNodeIds(managerNode, idsToAdd) {
    const ids = parseTargetNodeIds(idsToAdd.join("\n"));
    if (!ids.length) {
        return false;
    }

    const existingIds = getExistingTargetIdSet(managerNode);
    let changed = false;

    for (const id of ids) {
        if (String(managerNode.id) === String(id) || existingIds.has(id)) {
            continue;
        }

        existingIds.add(id);
        changed = true;
    }

    if (changed) {
        writeTargetIds(managerNode, [...existingIds]);
    }

    return changed;
}

function getSelectedNodes() {
    const selectedNodes = app.canvas?.selected_nodes;

    if (!selectedNodes) {
        return [];
    }

    if (Array.isArray(selectedNodes)) {
        return selectedNodes;
    }

    return Object.values(selectedNodes);
}

function addSelectedNodes(managerNode) {
    const selectedIds = getSelectedNodes()
        .filter((node) => node && node !== managerNode)
        .map((node) => String(node.id));

    if (!selectedIds.length) {
        console.warn(`[${EXTENSION_NAME}] No selectable target nodes are currently selected.`);
        return;
    }

    addTargetNodeIds(managerNode, selectedIds);
}

function setNodesMode(managerNode, targetMode) {
    const graph = app.graph;
    const ids = parseTargetNodeIds(getWidgetValue(managerNode, "target_node_ids"));

    if (!ids.length) {
        console.warn(`[${EXTENSION_NAME}] No target node IDs were provided.`);
        return;
    }

    for (const id of ids) {
        if (String(managerNode.id) === String(id)) {
            continue;
        }

        const targetNode = findNodeById(graph, id);

        if (!targetNode) {
            console.warn(`[${EXTENSION_NAME}] Could not find target node with ID "${id}".`);
            continue;
        }

        targetNode.mode = targetMode;
        targetNode.setDirtyCanvas?.(true, true);
    }

    markGraphChanged(graph);
}

function getSelectedOffMode(managerNode) {
    const mode = getWidgetValue(managerNode, "mode", "mute");

    if (mode === "bypass") {
        return getLiteGraphConstant("BYPASS", 4);
    }

    return getLiteGraphConstant("NEVER", 2);
}

function getManagerState(managerNode) {
    const state = managerNode.properties?.[STATE_PROPERTY];
    return state === OFF_STATE ? OFF_STATE : ON_STATE;
}

function setManagerVisualState(managerNode, state) {
    const colors = state === ON_STATE ? ON_COLORS : OFF_COLORS;
    managerNode.color = colors.color;
    managerNode.bgcolor = colors.bgcolor;

    const toggleWidget = findToggleWidget(managerNode);
    if (toggleWidget) {
        toggleWidget.kooOnOffToggle = true;
        toggleWidget.name = state;
        toggleWidget.label = state;
        toggleWidget.value = state;
    }

    markGraphChanged(app.graph);
}

function applyManagerState(managerNode, state, updateTargets = true) {
    managerNode.properties = managerNode.properties ?? {};
    managerNode.properties[STATE_PROPERTY] = state;

    setManagerVisualState(managerNode, state);

    if (updateTargets) {
        const targetMode =
            state === ON_STATE
                ? getLiteGraphConstant("ALWAYS", 0)
                : getSelectedOffMode(managerNode);

        setNodesMode(managerNode, targetMode);
    }
}

function toggleManagerState(managerNode) {
    const nextState = getManagerState(managerNode) === ON_STATE ? OFF_STATE : ON_STATE;
    applyManagerState(managerNode, nextState);
}

function addCaptureInput(managerNode) {
    const hasCaptureInput = managerNode.inputs?.some((input) => input.name === ADD_ID_INPUT_NAME);

    if (!hasCaptureInput) {
        managerNode.addInput(ADD_ID_INPUT_NAME, "*");
    }
}

app.registerExtension({
    name: EXTENSION_NAME,

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_CLASS_NAME) {
            return;
        }

        const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
        const originalOnConfigure = nodeType.prototype.onConfigure;
        const originalOnConnectInput = nodeType.prototype.onConnectInput;
        const originalOnConnectionsChange = nodeType.prototype.onConnectionsChange;

        nodeType.prototype.onNodeCreated = function () {
            originalOnNodeCreated?.apply(this, arguments);

            this.properties = this.properties ?? {};
            if (!this.properties[STATE_PROPERTY]) {
                this.properties[STATE_PROPERTY] = ON_STATE;
            }

            addCaptureInput(this);

            const modeWidget = findWidget(this, "mode");
            if (modeWidget && !modeWidget.value) {
                // Change the default frontend mode here if you also change the
                // Python default in koo_on_off_manager.py.
                modeWidget.value = "mute";
            }

            const toggleWidget = this.addWidget("button", getManagerState(this), null, () => {
                toggleManagerState(this);
            });
            toggleWidget.kooOnOffToggle = true;

            this.addWidget("button", "ADD SELECTED NODES", null, () => {
                addSelectedNodes(this);
            });

            setManagerVisualState(this, getManagerState(this));
        };

        nodeType.prototype.onConfigure = function () {
            originalOnConfigure?.apply(this, arguments);
            addCaptureInput(this);
            setManagerVisualState(this, getManagerState(this));
        };

        nodeType.prototype.onConnectInput = function (inputIndex, outputType, outputSlot, outputNode) {
            if (this.inputs?.[inputIndex]?.name === ADD_ID_INPUT_NAME) {
                if (outputNode?.id !== undefined) {
                    addTargetNodeIds(this, [String(outputNode.id)]);
                }

                return false;
            }

            return originalOnConnectInput?.apply(this, arguments);
        };

        nodeType.prototype.onConnectionsChange = function (type, slot, connected, linkInfo) {
            originalOnConnectionsChange?.apply(this, arguments);

            if (!connected || this.inputs?.[slot]?.name !== ADD_ID_INPUT_NAME) {
                return;
            }

            if (linkInfo?.origin_id !== undefined) {
                addTargetNodeIds(this, [String(linkInfo.origin_id)]);
            }

            if (linkInfo?.id !== undefined) {
                this.graph?.removeLink?.(linkInfo.id);
                markGraphChanged(this.graph);
            }
        };
    },
});
