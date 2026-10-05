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
const module = new vm.SourceTextModule(source + `\nglobalThis.test = { layout, getState, restoreState, previewSettings, requestPreview, setState, updateSlider, drawUI, releasePreviews, applyPreset, presetAction, presetMenu, numericConfig, applyNumericValue, loadPresets, customPreset };`, { context });
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


const disk=new Map();let nextId=0;let answer="A";
context.prompt=()=>answer;context.confirm=()=>true;
context.document={body:{append(){}},createElement(){return {style:{},click(){},remove(){}};}};
context.fetch=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;requests.push({url,options,body});
  if(!url.startsWith("/koo/finisher/presets"))return {ok:true,json:async()=>({ok:true,luts:[]}),blob:async()=>({})};
  const list=()=>[...disk].map(([id,preset])=>({id,name:preset.name}));
  let data={ok:true,presets:list()};
  if(body){
    let id=body.id,preset;
    if(body.action==="delete")disk.delete(id);
    else if(body.action==="rename"){preset={...disk.get(id),name:body.name};disk.set(id,preset);}
    else{
      const imported=body.action==="import"?JSON.parse(body.json):null;
      let name=imported?.name||body.name;
      if(body.action!=="save"||!id){
        id=String(++nextId).padStart(32,"0");let suffix=2;const original=name;
        while([...disk.values()].some(p=>p.name.toLowerCase()===name.toLowerCase()))name=`${original} (${suffix++})`;
      }
      preset={schema_version:2,name,settings:structuredClone(imported?.settings||body.settings)};
      disk.set(id,preset);
    }
    data={ok:true,presets:list(),id,preset};
  }else if(url.includes("?id=")){
    const id=decodeURIComponent(url.split("?id=")[1]);data={ok:true,id,preset:structuredClone(disk.get(id))};
  }
  return {ok:true,json:async()=>data};
};
const click=(n,name)=>{const box=t.layout(n)[name];n.onMouseDown({preventDefault(){},stopPropagation(){}},[box.x+box.w/2,box.y+box.h/2]);n.onMouseUp();};
const choose=async(n,more,label)=>{
  click(n,more?"presetMore":"presetSelect");
  const entry=context.menu.options.find(item=>item?.content===label);assert.ok(entry,`Missing menu item ${label}`);
  context.menu.config.callback(entry);await settle();
};
const dropdown=n=>{click(n,"presetSelect");return Array.from(context.menu.options).filter(Boolean).map(item=>item.content);};
const snapshot=id=>JSON.stringify(disk.get(id));
const labels=[];
const ctx=new Proxy({measureText(text){return {width:String(text).length*7};},fillText(text){labels.push({text,color:this.fillStyle});}},{get(target,key){return key in target?target[key]:()=>{};}});
const label=n=>{labels.length=0;t.drawUI(n,ctx);return labels.slice();};
const placeholder=label(node).find(item=>item.text==="No Preset");assert.ok(placeholder);
assert.ok(!dropdown(node).includes("Custom"));assert.equal(context.menu.options[1],null);
const initialCount=disk.size;answer=null;await choose(node,false,"+ New Preset");assert.equal(disk.size,initialCount);assert.equal(node._kooFinisherPresetId,undefined);
const ids={};
for(const [name,ev] of [["A",.1],["B",.2],["C",.3]]){
  t.setState(node,"exposure",ev);answer=name;await choose(node,false,"+ New Preset");
  ids[name]=node._kooFinisherPresetId;assert.equal(disk.get(ids[name]).name,name);
}
assert.equal(disk.size,3);assert.equal(new Set(Object.values(ids)).size,3);
assert.deepEqual(dropdown(node),["+ New Preset","A","B","C"]);
for(const [name,ev] of [["A",.1],["B",.2],["C",.3]]){await choose(node,false,name);assert.equal(t.getState(node).exposure,ev);}
const bBefore=snapshot(ids.B),cBefore=snapshot(ids.C);
await choose(node,false,"A");t.setState(node,"exposure",.9);assert.equal(node._kooFinisherPresetModified,true);
assert.ok(label(node).some(item=>item.text==="A *"));
const savedLabel=label(node).find(item=>item.text==="A *");assert.notEqual(savedLabel.color,placeholder.color);
click(node,"presetSave");await settle();assert.equal(disk.get(ids.A).settings.exposure,.9);
assert.ok(label(node).some(item=>item.text==="A"));
assert.equal(snapshot(ids.B),bBefore);assert.equal(snapshot(ids.C),cBefore);assert.equal(disk.size,3);assert.equal(node._kooFinisherPresetModified,false);
const sourceBefore=snapshot(ids.A);answer="A Soft";await choose(node,true,"Save As");
const duplicateId=node._kooFinisherPresetId;assert.notEqual(duplicateId,ids.A);assert.equal(snapshot(ids.A),sourceBefore);
assert.equal(disk.get(duplicateId).settings.exposure,.9);assert.ok(dropdown(node).includes("A Soft"));
const cancelId=node._kooFinisherPresetId,cancelCount=disk.size;answer=null;await choose(node,false,"+ New Preset");
assert.equal(disk.size,cancelCount);assert.equal(node._kooFinisherPresetId,cancelId);
t.customPreset(node);assert.equal(node._kooFinisherPresetId,"");
const old=Object.fromEntries([...disk].map(([id,p])=>[id,JSON.stringify(p)]));answer="D";
click(node,"presetSave");await settle();assert.equal(disk.size,5);
assert.equal(requests.filter(r=>r.body?.action).at(-1).body.action,"save_as");
for(const [id,text] of Object.entries(old))assert.equal(snapshot(id),text);
await choose(node,false,"B");answer="B New";await choose(node,true,"Rename");
assert.equal(node._kooFinisherPresetId,ids.B);assert.equal(node._kooFinisherPresetName,"B New");
assert.equal(disk.get(ids.B).settings.exposure,.2);assert.ok(!dropdown(node).includes("B"));assert.ok(dropdown(node).includes("B New"));
await choose(node,false,"A");await choose(node,true,"Delete");assert.equal(node._kooFinisherPresetId,"");
assert.ok(!disk.has(ids.A));assert.ok(dropdown(node).includes("B New"));assert.ok(dropdown(node).includes("C"));
for(const name of ["Import 1","Import 2","Import 1"]){
  await t.presetAction(node,"import",JSON.stringify({schema_version:2,name,settings:{exposure:.4}}));
}
assert.ok(dropdown(node).includes("Import 1"));assert.ok(dropdown(node).includes("Import 2"));assert.ok(dropdown(node).includes("Import 1 (2)"));
const count=disk.size;t.customPreset(node);
const requestsBefore=requests.length;await choose(node,true,"Export");assert.equal(requests.length,requestsBefore);assert.ok(node._kooFinisherPresetStatus.includes("Save or select"));
answer=null;click(node,"presetSave");await settle();assert.equal(disk.size,count);assert.equal(node._kooFinisherPresetId,"");
const recreated=new Node();recreated.onNodeCreated();await settle();
assert.ok(dropdown(recreated).includes("B New"));assert.ok(dropdown(recreated).includes("C"));assert.equal(recreated._kooFinisherPresetId,undefined);
await choose(recreated,false,"C");const state=t.getState(recreated);recreated.onConfigure({properties:{koo_finisher_state:{...state}}});await settle();assert.equal(recreated._kooFinisherPresetId,ids.C);
recreated.onConfigure({properties:{koo_finisher_state:{exposure:1.1}}});await settle();assert.equal(recreated._kooFinisherPresetId,"");
// Entire list survives reinitialization; empty dropdown retains the creation action.
for(const name of dropdown(recreated).filter(name=>name!=="+ New Preset")){await choose(recreated,false,name);await choose(recreated,true,"Delete");}
assert.equal(disk.size,0);assert.deepEqual(dropdown(recreated),["+ New Preset"]);
node.onRemoved();recreated.onRemoved();assert.equal(liveUrls.size,0);
assert.equal(requests.filter(r=>r.url==="/koo/finisher/preview").length,0);
console.log("PASS preset regression: New Preset creates A/B/C, selected Save independence, unsaved Save As, rename/delete, multiple imports/collisions, reload and empty dropdown creation action");
