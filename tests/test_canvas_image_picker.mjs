import { test, beforeEach } from 'node:test';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS_SRC = readFileSync(join(__dirname, '..', 'static', 'js', 'canvas-image-picker.js'), 'utf8');
const CSS_SRC = readFileSync(join(__dirname, '..', 'static', 'css', 'canvas-image-picker.css'), 'utf8');

function setupDom({ enabled = false, items = [] } = {}) {
    const html = `<!DOCTYPE html><html><body>
        <div id="imageAssetPickerModal" class="hidden"></div>
        <div id="nodes"></div>
        <style>${CSS_SRC}</style>
        <script>
            window.STORAGE_SETTINGS = ${JSON.stringify({ video_index: { enabled } })};
            window.__TEST_NODES__ = ${JSON.stringify(items)};
            ${JS_SRC}
        </script>
    </body></html>`;
    return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true }).window;
}

test('openImageAssetPicker shows modal', () => {
    const w = setupDom({ items: [{ id: 'n1', url: '', name: '图片' }] });
    w.openImageAssetPicker('n1');
    assert.strictEqual(w.document.getElementById('imageAssetPickerModal').classList.contains('hidden'), false);
});

test('closeImageAssetPicker hides modal', () => {
    const w = setupDom();
    w.openImageAssetPicker('n1');
    w.closeImageAssetPicker();
    assert.strictEqual(w.document.getElementById('imageAssetPickerModal').classList.contains('hidden'), true);
});

test('applyImagePickerToNode writes url without copying bytes', () => {
    const w = setupDom({ items: [{ id: 'n1', url: '', name: '图片' }] });
    w.applyImagePickerToNode({ id: 'vi_abc', url: 'video-index://abc', name: 'sunset.mp4' }, 'n1');
    const node = w.__TEST_NODES__[0];
    assert.strictEqual(node.url, 'video-index://abc');
});

test('local-only mode works without VI plugin', () => {
    const w = setupDom({ enabled: false, items: [{ id: 'n1', url: '', name: '图片' }] });
    assert.strictEqual(w.__VI_PLUGIN_FOR_PICKER__, undefined);
    w.openImageAssetPicker('n1');
    assert.strictEqual(w.document.getElementById('imageAssetPickerModal').classList.contains('hidden'), false);
});
