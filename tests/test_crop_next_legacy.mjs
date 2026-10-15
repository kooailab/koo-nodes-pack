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
const {extension,api:helpers}=await load(new URL("../web/load_image_crop_next/js/koo_load_image_crop_next.js",import.meta.url),"ae30e359a0cabeb4ce03dfc741a104ad803ca605fed7bd655be2ed994fe305a5","BACKEND_WIDGET_NAMES,cropFromWidgets,cropHandles,imageToPreview,legacyValuesToCurrent");
class Crop extends Node {constructor() {super(helpers.BACKEND_WIDGET_NAMES,["fixture.png","Free",4,5,0,0,0,0,false,false]);}}
extension.beforeRegisterNodeDef(Crop,{name:"KoO_LoadImageCropNext"});extension.beforeRegisterNodeDef(Crop,{name:"KoO_LoadImageCropNext"});
const node=new Crop();node.onNodeCreated();node.onDrawForeground(canvas);assert.equal(images.length,1);images[0].onload();node.onDrawForeground(canvas);
assert.equal(node.widgets.length,10);assert.equal(node.kooLoadImageCropNext.imageReady,true);assert.ok(drawing.some(call=>call.kind==="drawImage"));
const pos=(x,y)=>{const rect=node.kooLoadImageCropNext.layout.imageRect;return [rect.x+x/1000*rect.w,rect.y+y/800*rect.h];};
assert.equal(node.onMouseDown({},pos(100,100)),true);assert.equal(node.kooLoadImageCropNext.drag.kind,"create");node.onMouseMove({},pos(500,400),app.canvas);node.onMouseUp();
assert.deepEqual(plain(helpers.cropFromWidgets(node)),{x:100,y:100,w:400,h:300});
node.onDrawForeground(canvas);assert.equal(helpers.cropHandles(helpers.imageToPreview(node,helpers.cropFromWidgets(node))).length,8);assert.ok(drawing.some(call=>call.kind==="strokeRect"));
node.onMouseDown({},pos(300,250));assert.equal(node.kooLoadImageCropNext.drag.kind,"move");node.onMouseMove({},pos(350,300),app.canvas);node.onMouseUp();
assert.deepEqual(plain(helpers.cropFromWidgets(node)),{x:150,y:150,w:400,h:300});
node.onMouseDown({},pos(550,450));assert.equal(node.kooLoadImageCropNext.drag.handle,"se");node.onMouseMove({},pos(650,550),app.canvas);node.onMouseUp();
assert.deepEqual(plain(helpers.cropFromWidgets(node)),{x:150,y:150,w:500,h:400});
node.onDrawForeground(canvas);const ratioHit=node.kooLoadImageCropNext.hitboxes.find(hit=>hit.kind==="ratioMenu");click(node,ratioHit);
menus.at(-1).items.find(item=>item.content==="1:1").callback();assert.deepEqual(plain(helpers.cropFromWidgets(node)),{x:200,y:150,w:400,h:400});
const saved=node.serialize(),copy=new Crop();copy.properties=structuredClone(saved.properties);copy.onNodeCreated();copy.onConfigure(saved);copy.onDrawForeground(canvas);images.at(-1).onload();copy.onDrawForeground(canvas);
assert.deepEqual(plain(copy.serialize()),plain(saved));assert.equal(saved.widgets_values.length,10);
const old=new Crop();old.onNodeCreated();old.onConfigure({widgets_values:["fixture.png","4:5",4,5,0,0,0,100,200,400,500,true,true]});old.onDrawForeground(canvas);images.at(-1).onload();old.onDrawForeground(canvas);
assert.deepEqual(plain(helpers.cropFromWidgets(old)),{x:100,y:200,w:400,h:500});
assert.equal(images.length,3,"Crop interaction must not reload/process images");assert.ok(node.computeSize()[0]>=540);assert.ok(node.computeSize()[1]>=705);
node.onRemoved();assert.equal(node.kooLoadImageCropNext.image,null);assert.equal(node.kooLoadImageCropNext.drag,null);assert.equal(node.kooLoadImageCropNext.hitboxes.length,0);
console.log("PASS Legacy Crop Next: exact approved source, image/canvas overlay/eight handles, create/move/resize, LiteGraph menus, legacy/current workflow restoration, sizing and original cleanup");
