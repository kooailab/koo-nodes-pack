import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registrations = [];
const context = vm.createContext({ console, registrations });
const app = new vm.SourceTextModule('export const app = {registerExtension(value) { registrations.push(value.name); }};', { context });
const api = new vm.SourceTextModule('export const api = {};', { context });
await app.link(() => {}); await api.link(() => {});
await app.evaluate(); await api.evaluate();
const modules = new Map();
async function load(file) {
  if (modules.has(file)) return modules.get(file);
  const module = new vm.SourceTextModule(await readFile(file, 'utf8'), { context, identifier: file });
  modules.set(file, module);
  await module.link(async (specifier, owner) => {
    if (specifier.endsWith('/scripts/app.js')) return app;
    if (specifier.endsWith('/scripts/api.js')) return api;
    return load(path.resolve(path.dirname(owner.identifier), specifier));
  });
  return module;
}
// ComfyUI may enumerate both the main extension and its historical nested entry point.
for (const file of ['web/load_image_crop/koo_load_image_crop.js', 'web/load_image_crop/js/koo_load_image_crop.js']) {
  await (await load(path.join(root, file))).evaluate();
}
assert.deepEqual(registrations, ['KoO.LoadImageCrop.v4']);
console.log('Crop extension registers once across both entry points');
