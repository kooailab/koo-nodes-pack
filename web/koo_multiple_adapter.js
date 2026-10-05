import { app } from "../../../scripts/app.js";

const MIN_WIDTH = 260;
function fitNode(node) {
  const minimum = node.computeSize();
  const size = [Math.max(MIN_WIDTH, node.size?.[0] || 0, minimum[0]), Math.max(node.size?.[1] || 0, minimum[1])];
  if (node.size?.[0] !== size[0] || node.size?.[1] !== size[1]) node.setSize(size);
}

app.registerExtension({
  name: "KoO.MultipleAdapter",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "KoOMultipleAdapter") return;
    const computeSize = nodeType.prototype.computeSize;
    nodeType.prototype.computeSize = function () {
      const size = computeSize.apply(this, arguments);
      const slots = Math.max(this.inputs?.length || 3, this.outputs?.length || 3);
      return [Math.max(MIN_WIDTH, size[0]), Math.max(slots * 20 + 44, size[1])];
    };
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      const index = this.widgets.findIndex(w => w.name === "multiple");
      const oldMultiple = this.widgets[index];
      if (oldMultiple.type === "koo_multiple") { this._kooMultipleRefresh?.(); fitNode(this); return result; }
      const direction = this.widgets.find(w => w.name === "direction");
      const offset = this.widgets.find(w => w.name === "offset");
      for (const widget of [direction, offset]) {
        widget.hidden = true;
        widget.type = "hidden";
        widget.computeSize = () => [0, -4];
        widget.draw = () => {};
      }
      const row = document.createElement("div");
      Object.assign(row.style, { display: "grid", gridTemplateColumns: "28px minmax(0, 80px) 28px 60px",
        gap: "6px", width: "214px", maxWidth: "100%", height: "26px", marginInline: "auto",
        alignItems: "stretch", boxSizing: "border-box" });
      const minus = document.createElement("button");
      const input = document.createElement("input");
      const plus = document.createElement("button");
      const offsetGroup = document.createElement("div");
      Object.assign(offsetGroup.style, { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0", minWidth: "0" });
      const zero = document.createElement("button");
      const one = document.createElement("button");
      zero.type = one.type = "button";
      zero.textContent = "+0"; one.textContent = "+1";
      zero.setAttribute("aria-label", "Offset zero"); one.setAttribute("aria-label", "Offset one");
      minus.type = plus.type = "button";
      minus.textContent = "−"; plus.textContent = "+";
      minus.setAttribute("aria-label", "Round down"); plus.setAttribute("aria-label", "Round up");
      input.type = "text"; input.inputMode = "numeric";
      input.setAttribute("aria-label", "Multiple (positive integer)");
      input.autocomplete = "off";
      for (const element of [minus, input, plus, zero, one]) {
        Object.assign(element.style, { minWidth: "0", width: "100%", margin: "0", padding: "0 3px",
          boxSizing: "border-box", border: "1px solid #444852", borderRadius: "4px",
          color: "#FFFFFF", background: "#292B31", font: "13px system-ui", textAlign: "center" });
      }
      offsetGroup.append(zero, one);
      row.append(minus, input, plus, offsetGroup);
      // ComfyUI sizes the host to the node; the inner grid keeps fixed tracks.
      const host = document.createElement("div");
      Object.assign(host.style, { display: "flex", justifyContent: "center", alignItems: "center",
        width: "100%", maxWidth: "100%", minWidth: "0", height: "28px", boxSizing: "border-box", overflow: "hidden" });
      host.append(row);
      let value = oldMultiple.value ?? 16;
      const refresh = () => {
        input.value = String(value);
        for (const [button, mode] of [[minus, "MINUS"], [plus, "PLUS"]]) {
          const selected = direction.value === mode;
          button.style.background = selected ? "#FF4FA3" : "#292B31";
          button.setAttribute("aria-pressed", String(selected));
        }
        for (const [button, mode] of [[zero, 0], [one, 1]]) {
          const selected = offset.value === mode;
          button.style.background = selected ? "#FF4FA3" : "#292B31";
          button.setAttribute("aria-pressed", String(selected));
        }
      };
      const changed = () => { refresh(); this.graph?.change?.(); this.setDirtyCanvas(true, true); };
      // Replace the native number widget entirely, keeping its serialized index/name.
      const multiple = this.addDOMWidget("multiple", "koo_multiple", host, {
        getValue: () => value,
        setValue: next => { value = next; refresh(); },
        getHeight: () => 28, getMinHeight: () => 28, getMaxHeight: () => 28, hideOnZoom: false,
      });
      this.widgets.splice(this.widgets.indexOf(multiple), 1);
      this.widgets.splice(index, 1, multiple);
      const select = mode => { direction.value = mode; changed(); };
      minus.onclick = () => select("MINUS"); plus.onclick = () => select("PLUS");
      zero.onclick = () => { offset.value = 0; changed(); };
      one.onclick = () => { offset.value = 1; changed(); };
      const commit = () => {
        const text = input.value.trim();
        const number = Number(text);
        if (/^\d+$/.test(text) && Number.isSafeInteger(number) && number >= 1) value = number;
        changed();
      };
      input.onchange = commit;
      input.onkeydown = event => {
        if (event.key === "Enter") { event.preventDefault(); commit(); input.blur(); }
        if (event.key === "Escape") { refresh(); input.blur(); }
      };
      for (const type of ["pointerdown", "mousedown", "dblclick", "wheel", "keydown"]) {
        row.addEventListener(type, event => event.stopPropagation());
      }
      this._kooMultipleRefresh = refresh;
      refresh();
      this.min_width = MIN_WIDTH;
      this.setSize(this.computeSize());
      return result;
    };
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const result = configure?.apply(this, arguments);
      // Original workflows had only the multiple/direction widget values.
      if (info?.widgets_values?.length === 2) {
        for (const name of ["width", "height"]) {
          const widget = this.widgets.find(w => w.name === name);
          if (widget) widget.value = 1024;
        }
        this.widgets.find(w => w.name === "multiple").value = info.widgets_values[0];
        this.widgets.find(w => w.name === "direction").value = info.widgets_values[1];
      }
      this.widgets.find(w => w.name === "offset").value = info?.widgets_values?.length > 4 ? info.widgets_values[4] : 0;
      this._kooMultipleRefresh?.();
      fitNode(this);
      return result;
    };
    const graphConfigured = nodeType.prototype.onGraphConfigured;
    nodeType.prototype.onGraphConfigured = function () {
      const result = graphConfigured?.apply(this, arguments);
      this._kooMultipleRefresh?.();
      fitNode(this);
      return result;
    };
    const resize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function () {
      const result = resize?.apply(this, arguments);
      fitNode(this);
      return result;
    };
  },
});
