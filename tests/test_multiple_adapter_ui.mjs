import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

class Element {
  constructor(tag) { this.tag = tag; this.style = {}; this.children = []; this.attributes = {}; this.listeners = {}; }
  append(...elements) { this.children.push(...elements); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  blur() {}
}
const registrations = [];
const context = vm.createContext({ registrations, document: { createElement: tag => new Element(tag) } });
const app = new vm.SourceTextModule("export const app = { registerExtension(value) { registrations.push(value); } };", { context });
await app.link(() => {}); await app.evaluate();
const source = await readFile(new URL("../web/koo_multiple_adapter.js", import.meta.url), "utf8");
const module = new vm.SourceTextModule(source, { context });
await module.link(() => app); await module.evaluate();
class Node {
  constructor() {
    this.widgets = [{ name: "width", value: 1024 }, { name: "height", value: 1024 },
      { name: "multiple", value: 16, type: "number", mouse() { this.value++; } },
      { name: "direction", value: "PLUS" }, { name: "offset", value: 0 }];
    this.graph = { change() {} };
  }
  addDOMWidget(name, type, element, options) {
    const widget = { name, type, element, options };
    Object.defineProperty(widget, "value", { get: options.getValue, set: options.setValue });
    this.widgets.push(widget);
    return widget;
  }
  computeSize() { return [210, 116]; }
  setSize(size) { this.size = size; this.onResize?.(size); }
  setDirtyCanvas() {}
  serialize() { return { widgets_values: this.widgets.map(w => w.value) }; }
  configure(info) {
    this.widgets.forEach((w, i) => { if (i < info.widgets_values.length) w.value = info.widgets_values[i]; });
    this.onConfigure(info); this.onGraphConfigured();
  }
}
class OtherNode {}
registrations[0].beforeRegisterNodeDef(OtherNode, { name: "KoOFinisher" });
assert.equal(OtherNode.prototype.onNodeCreated, undefined);
registrations[0].beforeRegisterNodeDef(Node, { name: "KoOMultipleAdapter" });
const node = new Node();
const nativeNumber = node.widgets[2];
node.onNodeCreated();
const multiple = node.widgets[2], direction = node.widgets[3], offset = node.widgets[4];
const host = multiple.element, row = host.children[0], [minus, input, plus, offsetGroup] = row.children;
const [zero, one] = offsetGroup.children;
assert.ok(!node.widgets.includes(nativeNumber));
assert.equal(multiple.type, "koo_multiple");
assert.equal(multiple.mouse, undefined);
assert.equal(direction.hidden, true);
assert.equal(plus.attributes["aria-pressed"], "true");
assert.equal(minus.attributes["aria-pressed"], "false");
assert.equal(plus.style.background, "#FF4FA3");
assert.equal(input.value, "16");
assert.equal(node.widgets.length, 5);
node.onNodeCreated(); assert.equal(node.widgets.length, 5); assert.equal(node.widgets[2], multiple);
console.log("PASS: native numeric widget removed; default PLUS highlighted; no duplicate widgets");

input.value = "10"; input.onchange();
assert.equal(multiple.value, 10);
for (let i = 0; i < 4; i++) {
  plus.onclick();
  assert.equal(multiple.value, 10); assert.equal(input.value, "10");
  assert.equal(direction.value, "PLUS"); assert.equal(plus.style.background, "#FF4FA3");
  assert.equal(minus.style.background, "#292B31");
  minus.onclick();
  assert.equal(multiple.value, 10); assert.equal(input.value, "10");
  assert.equal(direction.value, "MINUS"); assert.equal(minus.style.background, "#FF4FA3");
  assert.equal(plus.style.background, "#292B31");
}
assert.equal(nativeNumber.value, 16);
assert.equal(offset.value, 0); assert.equal(zero.attributes["aria-pressed"], "true");
one.onclick(); assert.equal(offset.value, 1); assert.equal(one.style.background, "#FF4FA3");
assert.equal(zero.style.background, "#292B31"); assert.equal(multiple.value, 10);
zero.onclick(); assert.equal(offset.value, 0); assert.equal(zero.style.background, "#FF4FA3");
assert.equal(one.style.background, "#292B31"); assert.equal(multiple.value, 10);
for (const name of ["pointerdown", "mousedown", "dblclick", "wheel", "keydown"]) {
  let stopped = false;
  row.listeners[name]({ stopPropagation() { stopped = true; } });
  assert.ok(stopped);
}
console.log("PASS: Multiple=10 remains 10 after repeated PLUS/MINUS clicks; native stepper cannot receive events");

for (const value of [1, 8, 16, 32, 64, 128, 10, 24, 7, 99991]) {
  input.value = String(value); input.onchange(); assert.equal(multiple.value, value);
}
for (const value of ["0", "-1", "1.2", "nan", "", "9007199254740992"]) {
  input.value = value; input.onchange(); assert.equal(multiple.value, 99991); assert.equal(input.value, "99991");
}
input.value = "24";
input.onkeydown({ key: "Enter", preventDefault() {} }); assert.equal(multiple.value, 24);
input.value = "35"; input.onkeydown({ key: "Escape" }); assert.equal(multiple.value, 24); assert.equal(input.value, "24");
assert.equal(input.type, "text"); assert.equal(input.inputMode, "numeric");
assert.equal(minus.type, "button"); assert.equal(plus.type, "button");
console.log("PASS: manual integer editing, Enter/Escape, arbitrary multiples, invalid values rejected");

for (const mode of ["MINUS", "PLUS"]) for (const selectedOffset of [0, 1]) {
  (mode === "MINUS" ? minus : plus).onclick();
  (selectedOffset === 0 ? zero : one).onclick();
  const saved = JSON.parse(JSON.stringify(node.serialize()));
  const reconstructed = new Node(); reconstructed.onNodeCreated(); reconstructed.configure(saved);
  assert.equal(reconstructed.widgets[2].value, 24);
  assert.equal(reconstructed.widgets[3].value, mode);
  assert.equal(reconstructed.widgets[4].value, selectedOffset);
  const selected = reconstructed.widgets[2].element.children[0].children[mode === "MINUS" ? 0 : 2];
  assert.equal(selected.attributes["aria-pressed"], "true");
  assert.equal(selected.style.background, "#FF4FA3");
  reconstructed.configure(saved); // Workflow/tab view restored on the same instance.
  assert.equal(reconstructed.widgets.length, 5);
  assert.equal(reconstructed.widgets[3].value, mode);
  assert.equal(reconstructed.widgets[4].value, selectedOffset);
}
const oldWorkflow = new Node(); oldWorkflow.onNodeCreated();
oldWorkflow.configure({ widgets_values: [10, "MINUS"] });
assert.equal(oldWorkflow.widgets[2].value, 10); assert.equal(oldWorkflow.widgets[3].value, "MINUS");
assert.equal(oldWorkflow.widgets[0].value, 1024); assert.equal(oldWorkflow.widgets[1].value, 1024);
assert.equal(oldWorkflow.widgets[4].value, 0);
const manual = new Node(); manual.onNodeCreated();
manual.configure({ widgets_values: [63, 1080, 10, "PLUS"] });
assert.deepEqual(Array.from(manual.serialize().widgets_values), [63, 1080, 10, "PLUS", 0]);
console.log("PASS: PLUS/MINUS persist across save/reload, graph reconstruction and view restore; legacy two-value workflows migrate");

const initialStyle = JSON.stringify(row.style);
for (const width of [180, 210, 260, 400, 1000, 4000]) {
  node.size[0] = width;
  node.size[1] = 40;
  node.onResize();
  assert.ok(node.size[0] >= 260); assert.ok(node.size[1] >= node.computeSize()[1]);
  host.style.width = `${node.size[0] - 20}px`; // ComfyUI sizes the outer DOM host during redraw.
  for (let redraw = 0; redraw < 10; redraw++) node._kooMultipleRefresh();
  assert.equal(JSON.stringify(row.style), initialStyle);
  assert.equal(row.style.display, "grid");
  assert.equal(row.style.gridTemplateColumns, "28px minmax(0, 80px) 28px 60px");
  assert.equal(row.style.width, "214px"); assert.equal(row.style.maxWidth, "100%");
  assert.ok(214 <= node.size[0] - 20);
  assert.equal(row.style.marginInline, "auto");
  assert.equal(multiple.options.getMinHeight(), 28); assert.equal(multiple.options.getMaxHeight(), 28);
  assert.equal(row.style.position, undefined);
}
assert.equal(28 + 80 + 28 + 60 + 3 * 6, 214);
assert.equal(multiple.computeSize, undefined); // Keep native DOMWidget layout sizing.
assert.equal(multiple.options.getHeight(), 28);
assert.equal(host.style.overflow, "hidden");
node.size = [100, 30]; node.configure(node.serialize());
assert.ok(node.size[0] >= 260); assert.ok(node.size[1] >= node.computeSize()[1]);
assert.equal(input.style.minWidth, "0"); assert.equal(input.style.boxSizing, "border-box");
assert.ok(!source.includes("window.prompt"));
console.log("PASS: center bounded at 80px; direction/offset controls aligned; undersized nodes clamped on resize/reload; native DOM layout retained");
assert.equal(OtherNode.prototype.onConfigure, undefined);
console.log("PASS: unrelated node classes and global numeric behavior untouched");
