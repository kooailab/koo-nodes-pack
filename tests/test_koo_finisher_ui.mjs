import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const requests = [], liveUrls = new Set(), timers = new Map(), registrations = [];
let sequence = 0, holdBlob;
const context = vm.createContext({
  console, AbortController, registrations,
  window: { LiteGraph: { ContextMenu: class {
    constructor(options, config) { context.menu = { options, config }; }
  } } },
  LiteGraph: { ContextMenu: class {
    constructor(options, config) { context.menu = { options, config }; }
  } },
  setTimeout(fn) { const id = ++sequence; timers.set(id, fn); return id; },
  clearTimeout(id) { timers.delete(id); },
  URL: {
    createObjectURL() { const url = `blob:test-${++sequence}`; liveUrls.add(url); return url; },
    revokeObjectURL(url) { liveUrls.delete(url); },
  },
  Image: class {
    width = 1200; height = 800;
    set src(value) { this.url = value; queueMicrotask(() => this.onload?.()); }
  },
  async fetch(url, options) {
    requests.push({ url, options, body: options?.body ? JSON.parse(options.body) : null });
    return { ok: true, async json() { return { ok: true, luts: [], status: "Ready" }; },
      async blob() { if (holdBlob) await holdBlob; return {}; } };
  },
});
const app = new vm.SourceTextModule(`export const app = { registerExtension(extension) { registrations.push(extension); } };`, { context });
await app.link(() => {}); await app.evaluate();
const source = await readFile(new URL("../web/koo_finisher.js", import.meta.url), "utf8");
const module = new vm.SourceTextModule(source + `\nglobalThis.test = { layout, getState, restoreState, previewSettings, requestPreview, setState, updateSlider, drawUI, releasePreviews };`, { context });
await module.link(() => app); await module.evaluate();
const t = context.test;
class Node {
  constructor() { this.widgets = [{ name: "finisher_settings", value: "" }]; this.size = [780, 1084]; this.pos = [0, 0]; }
  setDirtyCanvas() {}
  serialize() { return { properties: {}, widgets_values: this.widgets.map(w => w.value) }; }
}
registrations[0].beforeRegisterNodeDef(Node, { name: "KoOFinisher" });
const node = new Node(); node.onNodeCreated();
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const flush = async () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } await settle(); };
await settle();
const defaults = t.getState(node);
assert.equal(defaults.compare, false); assert.equal(defaults.autoSave, false);
for (const name of ["midtones", "whites", "blacks"]) assert.equal(defaults[name], 0);
t.restoreState(node, { exposure: .5, filenamePrefix: "old-workflow" });
assert.equal(t.getState(node).midtones, 0); assert.equal(t.getState(node).compare, false);
assert.equal(t.getState(node).exposure, .5);
console.log("PASS: old workflow defaults and hidden execution settings");

node.onExecuted({ koo_finisher: [{ cache_id: "execution-1", width: 1200, height: 800 }] });
await flush();
assert.ok(node._kooFinisherPreviewImage); assert.ok(node._kooFinisherOriginalImage);
assert.equal(requests.filter(r => r.body?.original === true).length, 1);
assert.equal(requests.filter(r => r.body?.original === false).length, 1);
assert.equal(liveUrls.size, 2);
const previewRequests = requests.filter(r => r.url.endsWith("/preview")).length;
let layout = t.layout(node);
node.onMouseDown({}, [layout.compare.x + 5, layout.compare.y + 5]);
assert.equal(t.getState(node).compare, true);
layout = t.layout(node);
node.onMouseDown({}, [layout.preview.x + layout.preview.w * .25, layout.preview.y + 20]);
node.onMouseMove({}, [layout.preview.x + layout.preview.w * .7, layout.preview.y + 20]);
node.onMouseUp();
assert.ok(Math.abs(t.getState(node).divider - .7) < 1e-10);
assert.equal(requests.filter(r => r.url.endsWith("/preview")).length, previewRequests);
const settingsWithCompare = node.widgets[0].value;
node.onMouseDown({}, [layout.compare.x + 5, layout.compare.y + 5]);
assert.equal(t.getState(node).compare, false);
assert.equal(node.widgets[0].value, settingsWithCompare);
assert.equal(t.getState(node).divider, .7);
console.log("PASS: A/B toggle and draggable divider never process or alter execution settings");

const saved = node.serialize();
assert.equal(saved.properties.koo_finisher_state.cacheId, "execution-1");
assert.ok(!JSON.stringify(saved).includes("blob:test"));
assert.ok(JSON.stringify(saved).length < 2500);
const currentImage = node._kooFinisherPreviewImage;
node.onConfigure(saved);
assert.equal(node._kooFinisherPreviewImage, currentImage);
await flush();
node.onRemoved(); assert.equal(liveUrls.size, 0); assert.equal(timers.size, 0);
const restored = new Node(); restored.onNodeCreated(); restored.onConfigure(saved);
await flush();
assert.equal(t.getState(restored).divider, .7);
assert.ok(restored._kooFinisherPreviewImage); assert.ok(restored._kooFinisherOriginalImage);
assert.equal(liveUrls.size, 2);
console.log("PASS: preview restores after live view/configure and workflow node recreation; JSON has no blobs");

layout = t.layout(restored);
restored.onMouseDown({}, [layout.autoSave.x + 5, layout.autoSave.y + 5]);
assert.equal(JSON.parse(restored.widgets[0].serializeValue()).auto_save, true);
t.setState(restored, "midtones", 30); await flush();
assert.equal(JSON.parse(restored.widgets[0].serializeValue()).settings.midtones, 30);
assert.equal(requests.filter(r => r.url.endsWith("/save")).length, 0);
restored.onExecuted({ koo_finisher: [{ cache_id: "execution-1" }] });
await flush();
assert.equal(requests.filter(r => r.url.endsWith("/save")).length, 0);
console.log("PASS: sliders and duplicate execution notifications never auto-save in frontend");

restored.onMouseDown({}, [layout.format.x + 5, layout.format.y + 5]);
assert.deepEqual(Array.from(context.menu.options), ["PNG", "JPG", "WEBP"]);
context.menu.config.callback("WEBP");
assert.equal(t.getState(restored).format, "WEBP");
assert.equal(JSON.parse(restored.widgets[0].value).format, "WEBP");
console.log("PASS: Format is a dropdown retaining PNG/JPG/WEBP");

for (const width of [400, 760, 780, 1100, 1600]) {
  restored.size = [width, 1084]; const l = t.layout(restored);
  assert.equal(l.height, 1132); assert.ok(l.preview.h > 250);
  assert.ok(l.outputSet.y + l.outputSet.h < l.prefix.y - 18);
  assert.ok(l.prefix.x + l.prefix.w + 8 < l.format.x);
  assert.ok(l.format.x + l.format.w + 8 < l.quality.x);
  assert.ok(l.prefix.y + l.prefix.h < l.reset.y - 22);
  assert.ok(l.exportBox.y + l.exportBox.h <= l.height - 18);
  for (const row of l.rows) {
    assert.ok(row.track.w > 60);
    assert.ok(row.track.x + row.track.w + 8 <= row.valueBox.x);
    const section = l.sections.find(s => s.name === row.control.section);
    assert.ok(row.y + row.h <= section.y + section.h);
  }
  const upper = l.sections.filter(s => ["LIGHT", "COLOR"].includes(s.name));
  const lower = l.sections.filter(s => ["DETAIL", "EFFECTS"].includes(s.name));
  assert.ok(Math.max(...upper.map(s => s.y + s.h)) < Math.min(...lower.map(s => s.y)));
}
t.getState(restored).outputFolder = "C:/" + "long-folder/".repeat(100);
t.getState(restored).filenamePrefix = "long-filename".repeat(100);
const labels = [], clips = [];
const ctx = new Proxy({ measureText: value => ({ width: String(value).length * 7 }),
  fillText: text => labels.push(text), rect: (...args) => clips.push(args) }, {
  get(target, name) { return target[name] ?? (() => {}); }, set(target, name, value) { target[name] = value; return true; },
});
t.drawUI(restored, ctx);
assert.ok(labels.includes("WEBP ▼"));
assert.ok(labels.some(label => label.endsWith("...")));
assert.equal(t.getState(restored).filenamePrefix.length, 1300);
t.getState(restored).compare = true; t.drawUI(restored, ctx);
assert.ok(labels.includes("A · Original")); assert.ok(labels.includes("B · Finished")); assert.ok(clips.length);
console.log("PASS: flowing grid bounds, labels, dropdown indicator, long-value truncation and wipe clipping");

// Removing a node while a response is pending must not create a new blob URL.
let resume; holdBlob = new Promise(resolve => { resume = resolve; });
const pending = t.requestPreview(restored); await settle(); restored.onRemoved();
resume(); await pending; await settle();
assert.equal(liveUrls.size, 0); assert.equal(timers.size, 0);
console.log("PASS: all object URLs, timers and in-flight requests are cleaned up on removal");
