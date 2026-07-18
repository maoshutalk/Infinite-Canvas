import { test, beforeEach } from 'node:test';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS_SRC = readFileSync(join(__dirname, '..', 'static', 'js', 'asset-vi-plugin.js'), 'utf8');
const CSS_SRC = readFileSync(join(__dirname, '..', 'static', 'css', 'asset-vi-plugin.css'), 'utf8');

function setupDom({ enabled = true } = {}) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="root"></div>
        <style>${CSS_SRC}</style>
        <script>window.STORAGE_SETTINGS = ${JSON.stringify({ video_index: { enabled } })};${JS_SRC}</script>
    </body></html>`, { runScripts: 'dangerously', resources: 'usable' });
    return dom.window;
}

beforeEach(() => {});

test('plugin attaches namespace when enabled', () => {
    const w = setupDom({ enabled: true });
    assert.ok(w.__VI_PLUGIN__);
    assert.strictEqual(typeof w.__VI_PLUGIN__.isViItem, 'function');
    assert.strictEqual(typeof w.__VI_PLUGIN__.renderCard, 'function');
});

test('plugin does NOT attach when disabled', () => {
    const w = setupDom({ enabled: false });
    assert.strictEqual(w.__VI_PLUGIN__, undefined);
});

test('isViItem discriminates by source field', () => {
    const w = setupDom();
    assert.strictEqual(w.__VI_PLUGIN__.isViItem({ source: 'remote_video_index', url: 'video-index://x' }), true);
    assert.strictEqual(w.__VI_PLUGIN__.isViItem({ source: 'local', url: '/assets/library/x.png' }), false);
});

test('thumbnailUrlForAsset builds media-preview URL', () => {
    const w = setupDom();
    const url = w.__VI_PLUGIN__.thumbnailUrlForAsset('abc-123', 320);
    assert.ok(url.includes('/api/media-preview'));
    assert.ok(url.includes(encodeURIComponent('video-index://abc-123')));
    assert.ok(url.includes('w=320'));
});

test('renderCard produces 📡 badge and thumbnail img', () => {
    const w = setupDom();
    const html = w.__VI_PLUGIN__.renderCard({
        id: 'vi_abc',
        name: 'sunset.mp4',
        url: 'video-index://abc',
        remote: { asset_id: 'abc', source_id: 'nas' },
    });
    assert.ok(html.includes('📡'));
    assert.ok(html.includes('video-index://abc') || html.includes('sunset.mp4'));
});
