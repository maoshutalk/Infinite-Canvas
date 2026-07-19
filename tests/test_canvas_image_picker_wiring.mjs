import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', 'static', 'js', 'canvas.js'), 'utf8');

test('blank.onclick routes to pickImageForNode (file upload), NOT asset picker', () => {
    // Clicking the empty area of a blank image node triggers the OS file
    // picker (pickImageForNode), so existing upload behavior is preserved.
    // Only the explicit 素材库 button opens the asset library picker.
    const blankClickRe = /blank\.onclick\s*=\s*e\s*=>\s*\{[\s\S]*?pickImageForNode\s*\(\s*node\.id\s*\)\s*;/;
    assert.ok(blankClickRe.test(SRC),
        'expected blank.onclick handler that calls pickImageForNode(node.id); when the 素材库 button is not the click target');
});

test('blank image 素材库 button still routes to openImageAssetPicker', () => {
    // The 素材库 button must still open the asset library picker.
    const re = /blankLibBtn\.onclick\s*=\s*e\s*=>\s*\{[\s\S]*?openImageAssetPicker\s*\(\s*node\.id\s*\)\s*;/;
    assert.ok(re.test(SRC),
        'expected blankLibBtn.onclick handler that calls openImageAssetPicker(node.id);');
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
