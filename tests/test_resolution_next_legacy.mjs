import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import vm from "node:vm";

const registrations = [], images = [], menus = [], drawing = [];
let answer = null;
const app = {registerExtension(extension) {registrations.push(extension);}, graph:{change() {},setDirtyCanvas() {}}, canvas:{canvas:{style:{}}}};
const api = {apiURL:url=>url,fetchApi:async()=>{throw Error("Unexpected backend request");}};
const context = vm.createContext({console,app,api,URLSearchParams,window:{},prompt:()=>answer,alert:()=>{},
  document:{createElement() {throw Error("Legacy controls must not create replacement DOM interfaces");}},
  Image:class {constructor() {this.naturalWidth=1000;this.naturalHeight=800;images.push(this);} set src(value) {this.url=value;}},
  LiteGraph:{closeAllContextMenus() {},ContextMenu:class {constructor(items,options) {menus.push({items,options});}}},
});
const appModule=new vm.SourceTextModule("export const app=globalThis.app;",{context});
const apiModule=new vm.SourceTextModule("export const api=globalThis.api;",{context});
for (const module of [appModule,apiModule]) {await module.link(()=>{});await module.evaluate();}
const canvas = new Proxy({}, {get(target,key) {if (key in target) return target[key]; if (key==="measureText") return text=>({width:String(text).length*7}); return (...args)=>drawing.push({kind:key,args});}});
class Node {
  constructor(names,values) {this.widgets=names.map((name,index)=>({name,value:values[index],options:{values:["fixture.png","other.png"]}}));this.properties={};this.size=[620,570];this.id="uuid-node";}
  setDirtyCanvas() {}
  computeSize() {return [200,120];}
  addDOMWidget() {throw Error("Rejected DOM conversion is still active");}
  serialize() {return {properties:structuredClone(this.properties),widgets_values:this.widgets.map(item=>item.value)};}
}
const plain = value=>JSON.parse(JSON.stringify(value));
const click = (node,hit)=>node.onMouseDown({},[hit.x+hit.w/2,hit.y+hit.h/2],app.canvas);
const load = async (path,hash,exports)=>{
  const bytes=await readFile(path), source=bytes.toString("utf8");
  assert.equal(createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex"),hash,"Frontend differs from the approved pre-conversion file");
  assert.equal(/addDOMWidget|ensureResolutionDOM|ensureCropDOM|koo_resolution_next_ui|koo_crop_next_ui/.test(source),false);
  const module=new vm.SourceTextModule(source+`\nglobalThis.testAPI={${exports}};`,{context});
  await module.link(specifier=>specifier.endsWith("api.js")?apiModule:appModule);await module.evaluate();
  return {extension:registrations.at(-1),api:context.testAPI};
};
const {extension,api:helpers}=await load(new URL("../web/resolution_next/koo_resolution_next.js",import.meta.url),"2f53eb49674edb834ddb673b30d55b1ee2102202bbcef8785f2096d0b7c20932","BACKEND_WIDGET_NAMES,RATIO_DEFAULTS,getState,finalDimensions,makeLayout");
class Resolution extends Node {constructor() {super(helpers.BACKEND_WIDGET_NAMES,[1536,864,"16:9",2048,false,"x1","Standard SD / SDXL",1]);}}
extension.beforeRegisterNodeDef(Resolution,{name:"KoOResolutionNext"});
const node=new Resolution();node.onNodeCreated();node.onDrawForeground(canvas);
assert.equal(node.widgets.length,8);assert.equal(node.properties.kooResolutionNextTheme,"Dark");
assert.ok(drawing.some(call=>call.kind==="fillText" && call.args[0]==="1536 x 864"));
const hit=(kind,value)=>{node.onDrawForeground(canvas);const box=node._kooResolutionNextHitboxes.find(box=>box.kind===kind && (value===undefined || box.value===value));assert.ok(box,kind);return box;};
for (const [ratio,[width,height]] of Object.entries(helpers.RATIO_DEFAULTS)) {
  assert.equal(click(node,hit("ratio",ratio)),true);assert.equal(helpers.getState(node).ratio,ratio);
  assert.deepEqual([helpers.getState(node).baseWidth,helpers.getState(node).baseHeight],[width,height]);
}
click(node,hit("ratio","16:9"));click(node,hit("lock"));click(node,hit("maxSide",1024));click(node,hit("scale","x2"));
assert.deepEqual(plain(helpers.finalDimensions(helpers.getState(node))),{baseWidth:1024,baseHeight:576,width:2048,height:1152});
answer="1111";click(node,hit("width"));answer=null;assert.equal(helpers.getState(node).baseWidth,1112);assert.equal(helpers.getState(node).ratio,"Custom");assert.equal(helpers.getState(node).locked,false);
click(node,hit("batch",1));click(node,hit("latent"));click(node,hit("theme","Light"));click(node,hit("accent","#3D8BFF"));
const saved=node.serialize(), copy=new Resolution();copy.properties=structuredClone(saved.properties);copy.onNodeCreated();copy.onConfigure(saved);copy.onDrawForeground(canvas);
assert.deepEqual(plain(copy.serialize()),plain(saved));assert.equal(saved.widgets_values.length,8);
assert.equal(copy.properties.kooResolutionNextAccent,"#3D8BFF");
copy.size=[500,570];copy.onResize();copy.onDrawForeground(canvas);const compact=helpers.makeLayout(copy);assert.equal(compact.compact,true);assert.equal(copy.size[0],500);assert.equal(copy.size[1],compact.desiredHeight);
console.log("PASS Legacy Resolution Next: exact approved source, canvas rendering/hitboxes, presets/lock/manual/scale/latent/batch/theme/accent, workflow reload and original compact layout");
