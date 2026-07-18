// Regression test for Images-node 素材库 button (T11b).
// Verifies canvas.js wires a "素材库" button on every image node (with or
// without url) and routes clicks to openImageAssetPicker (Plan 2 picker modal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const canvasJsPath = path.join(here, '..', 'static', 'js', 'canvas.js');
const source = fs.readFileSync(canvasJsPath, 'utf8');

test('image node with url renders a 素材库 button (data-image-library-open)', () => {
  assert.match(source, /data-image-library-open[\s\S]*?data-image-library-node-id/);
  assert.match(source, /[\u6750\u6599\u5e93]/); // 素材库 Chinese label
});

test('blank image node renders a 素材库 button (data-blank-image-library-open)', () => {
  assert.match(source, /data-blank-image-library-open[\s\S]*?data-blank-image-library-node-id/);
});

test('image node 素材库 button click handler calls openImageAssetPicker', () => {
  // Locate the image-library-open handler block
  const start = source.search(/const\s+imageLibBtn\s*=\s*body\.querySelector\(\s*'\[data-image-library-open\]'\s*\)/);
  assert.notEqual(start, -1, 'image-library-open handler not found');
  let depth = 0;
  let i = source.indexOf('{', start);
  let end = i;
  for(; i < source.length; i++){
    if(source[i] === '{') depth++;
    else if(source[i] === '}') { depth--; if(depth === 0){ end = i; break; } }
  }
  const block = source.slice(start, end + 1);
  assert.match(block, /openImageAssetPicker\s*\(\s*node\.id\s*\)/);
});

test('blank image node 素材库 button click handler calls openImageAssetPicker', () => {
  const start = source.search(/const\s+blankLibBtn\s*=\s*body\.querySelector\(\s*'\[data-blank-image-library-open\]'\s*\)/);
  assert.notEqual(start, -1, 'blank-image-library-open handler not found');
  let depth = 0;
  let i = source.indexOf('{', start);
  let end = i;
  for(; i < source.length; i++){
    if(source[i] === '{') depth++;
    else if(source[i] === '}') { depth--; if(depth === 0){ end = i; break; } }
  }
  const block = source.slice(start, end + 1);
  assert.match(block, /openImageAssetPicker\s*\(\s*node\.id\s*\)/);
});

test('canvas.css has .image-caption-row layout rule', () => {
  const cssPath = path.join(here, '..', 'static', 'css', 'canvas.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(css, /\.image-caption-row\s*\{[^}]*display\s*:\s*flex/);
});