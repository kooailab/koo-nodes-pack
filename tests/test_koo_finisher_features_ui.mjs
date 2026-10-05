import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const requests = [], liveUrls = new Set(), timers = new Map(), registrations = [];
let sequence = 0, holdBlob;
const context = vm.createContext({
  console, AbortController, DOMException, Blob, registrations,
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
const module = new vm.SourceTextModule(source + `\nglobalThis.test = { layout, getState, restoreState, previewSettings, requestPreview, setState, updateSlider, drawUI, releasePreviews, applyPreset, presetAction, presetMenu, numericConfig, applyNumericValue };`, { context });
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

let state=t.getState(node);assert.equal(state.softLens,0);assert.equal(state.chromaticAberration,0);
assert.equal(t.numericConfig("exposure").min,-5);assert.equal(t.numericConfig("exposure").max,5);assert.equal(t.numericConfig("exposure").step,.05);
assert.equal(t.numericConfig("exposure").sliderMin,-2);assert.equal(t.numericConfig("exposure").sliderMax,2);
t.applyNumericValue(node,"exposure","4.25");assert.equal(state.exposure,4.25);
node.serialize();assert.equal(state.exposure,4.25);
t.restoreState(node,{exposure:4.25});assert.equal(t.getState(node).exposure,4.25);state=t.getState(node);
const exposureRow=t.layout(node).rows.find(r=>r.control.name==="exposure");
t.updateSlider(node,"exposure",[exposureRow.track.x+exposureRow.track.w*.5625,exposureRow.y]);assert.equal(state.exposure,.25);
t.updateSlider(node,"exposure",[exposureRow.track.x+exposureRow.track.w,exposureRow.y]);assert.equal(state.exposure,2);
t.updateSlider(node,"exposure",[exposureRow.track.x,exposureRow.y]);assert.equal(state.exposure,-2);
t.applyNumericValue(node,"exposure","1.65");assert.equal(state.exposure,1.65);
state.cacheId="cache-feature";state.outputFolder="keep-folder";state.filenamePrefix="keep-prefix";state.format="WEBP";state.quality=83;state.autoSave=true;state.compare=true;state.divider=.3;
t.setState(node,"softLens",10);t.setState(node,"softLens",20);t.setState(node,"chromaticAberration",15);await flush();
const previews=requests.filter(r=>r.url==="/koo/finisher/preview");assert.equal(previews.length,1);assert.equal(previews[0].body.settings.soft_lens,20);assert.equal(previews[0].body.settings.chromatic_aberration,15);assert.equal(previews[0].body.max_size,1200);
t.setState(node,"softLens",25);await flush();assert.equal(previews[0].options.signal.aborted,true);
const documentElements=[];
context.document={body:{append(){}},createElement(tag){const element={tag,style:{},click(){this.clicked=true;},remove(){this.removed=true;}};documentElements.push(element);return element;}};
context.prompt=()=>"Unicode 柔らかい";context.confirm=()=>true;
let presets=[], nextId=0;
context.fetch=async(url,options)=>{
  const payload=options.body?JSON.parse(options.body):null;requests.push({url,options,body:payload});
  if(url.startsWith("/koo/finisher/presets")){
    let data={ok:true};
    if(payload){
      if(payload.action==="delete")presets=presets.filter(item=>item.id!==payload.id);
      else if(payload.action==="rename"){const item=presets.find(item=>item.id===payload.id);item.preset.name=payload.name;data={...data,...item};}
      else {
        const id=payload.action==="save"&&payload.id?payload.id:String(++nextId).padStart(32,"0");
        const imported=payload.action==="import"?JSON.parse(payload.json):null;
        const settings=imported?.settings||Object.fromEntries(Object.entries(payload.settings).filter(([name])=>name!=="bypass"));
        const item={id,preset:{schema_version:2,name:imported?.name||payload.name,finisher_version:"1.0.2",settings}};
        presets=presets.filter(item=>item.id!==id);presets.push(item);data={...data,...item,missing_lut:Boolean(settings.lut)};
      }
      data.presets=presets.map(item=>({id:item.id,name:item.preset.name}));
    }else if(url.includes("?id=")){data={...data,...presets.find(item=>item.id===url.split("?id=")[1])};}
    else data.presets=presets.map(item=>({id:item.id,name:item.preset.name}));
    return {ok:true,json:async()=>data};
  }
  return {ok:true,blob:async()=>({}),json:async()=>({ok:true})};
};
const beforeSave=requests.filter(r=>r.url==="/koo/finisher/preview").length;
await t.presetAction(node,"save");await flush();assert.equal(presets.length,1);assert.equal(requests.filter(r=>r.url==="/koo/finisher/preview").length,beforeSave);
const id=node._kooFinisherPresetId;await t.presetAction(node,"save");assert.equal(presets.length,1);assert.equal(node._kooFinisherPresetId,id);
await t.presetAction(node,"save_as");assert.equal(presets.length,2);assert.notEqual(node._kooFinisherPresetId,id);
await t.presetAction(node,"rename");await t.presetAction(node,"export");
assert.ok(documentElements.some(el=>el.tag==="a"&&el.download==="Unicode 柔らかい.json"&&el.clicked&&el.removed));await flush();
const priorPreview=requests.filter(r=>r.url==="/koo/finisher/preview").length;
await t.presetAction(node,"import",JSON.stringify({schema_version:2,name:"Imported",settings:{exposure:.2,soft_lens:40,chromatic_aberration:30,lut:"missing"}}));
assert.equal(state.exposure,.2);assert.equal(state.softLens,40);assert.equal(state.chromaticAberration,30);assert.equal(state.lut,"missing");assert.ok(node._kooFinisherPresetStatus.includes("LUT not found"));
assert.deepEqual([state.outputFolder,state.filenamePrefix,state.format,state.quality,state.autoSave,state.compare,state.divider],["keep-folder","keep-prefix","WEBP",83,true,true,.3]);
await flush();assert.equal(requests.filter(r=>r.url==="/koo/finisher/preview").length,priorPreview+1);
await t.presetAction(node,"load",id);await flush();assert.equal(state.softLens,25);await t.presetAction(node,"delete");
const serialized=node.serialize();assert.ok(!JSON.stringify(serialized).includes("PresetId"));assert.equal(JSON.parse(node.widgets[0].serializeValue()).settings.chromatic_aberration,15);
const l=t.layout(node);assert.equal(l.width,780);assert.equal(l.presetBox.h,40);assert.ok(l.preview.h>250);assert.ok(l.presetMore.y+l.presetMore.h<l.presetBox.y+l.presetBox.h);assert.ok(l.presetSelect.x+l.presetSelect.w<l.presetSave.x);assert.ok(l.presetBox.y+l.presetBox.h<l.exportBox.y);
const ca=l.rows.find(row=>row.control.name==="chromaticAberration");assert.ok(ca.track.x-ca.x>=140);assert.ok(ca.track.w>100);
node.onRemoved();assert.equal(liveUrls.size,0);assert.equal(timers.size,0);
assert.equal(source.includes("addDOMWidget"),false);
console.log("PASS: new neutral defaults, fine EV slider and extended numeric controls, one debounced/cancelled reduced preview, preset CRUD/import/export, look-only apply, missing LUT, compact Legacy layout and cleanup");
