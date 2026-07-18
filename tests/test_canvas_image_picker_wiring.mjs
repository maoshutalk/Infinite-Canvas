import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', 'static', 'js', 'canvas.js'), 'utf8');

test('blank.onclick routes to openImageAssetPicker', () => {
    const re = /blank\.onclick\s*=\s*\(\)\s*=>\s*openImageAssetPicker\(/;
    assert.ok(re.test(SRC),
        'expected `blank.onclick = () => openImageAssetPicker(...)` in canvas.js');
});

test('legacy pickImageForNode still exists (used by picker upload button)', () => {
    assert.ok(/function\s+pickImageForNode\s*\(/.test(SRC),
        'pickImageForNode is preserved as the upload-button fallback');
});

test('image-picker:apply listener wired via setImageNodeFromOutput', () => {
    // Listener must exist AND call the real canvas.js mutator (not the
    // brief's non-existent setNodeField/persistNodes/refreshNodeRender).
    assert.ok(/addEventListener\(\s*['"]image-picker:apply['"]/.test(SRC),
        'expected `addEventListener("image-picker:apply", ...)` in canvas.js');
    assert.ok(/setImageNodeFromOutput\s*\(/.test(SRC),
        'listener must call setImageNodeFromOutput (the real canvas.js mutator)');
});