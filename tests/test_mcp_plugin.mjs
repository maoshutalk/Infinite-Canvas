import { test, beforeEach } from 'node:test';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_SRC = readFileSync(join(__dirname, '..', 'static', 'js', 'comfyui-mcp-plugin.js'), 'utf8');
const CSS_SRC = readFileSync(join(__dirname, '..', 'static', 'css', 'comfyui-mcp-plugin.css'), 'utf8');

function setupDom({ workflows = [], state = 'ok' } = {}) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div data-comfyui-mcp-trigger></div>
        <style>${CSS_SRC}</style>
    </body></html>`, { runScripts: 'outside-only', url: 'http://localhost/' });

    const fetchCalls = [];
    dom.window.fetch = async (url) => {
        fetchCalls.push(url);
        if (url.includes('/api/mcp/status')) {
            return { ok: true, json: async () => ({ state, matched_instance: 'test:8188', file_count: workflows.length }) };
        }
        if (url.includes('/api/mcp/workflows')) {
            return { ok: true, json: async () => ({ workflows }) };
        }
        return { ok: true, json: async () => ({}) };
    };
    dom.window.showToast = () => {};
    dom.window.loadList = () => Promise.resolve();
    dom.window.lucide = { createIcons: () => {} };

    dom.window.eval(PLUGIN_SRC);
    return { dom, fetchCalls, win: dom.window, doc: dom.window.document };
}

const makeWorkflows = (n) => Array.from({ length: n }, (_, i) => ({
    name: `wf-${String(i + 1).padStart(2, '0')}.json`,
    title: `Workflow ${i + 1}`,
    format: i % 2 === 0 ? 'api' : 'ui',
    size: 1024 * (i + 1),
    mtime: Date.now() - i * 1000,
}));

const computeFiltered = (items, filter, exclude) => {
    const term = (filter || '').trim().toLowerCase();
    const excl = (exclude || []).map(x => x.toLowerCase()).filter(Boolean);
    return items.filter(it => {
        const hay = `${it.name || ''} ${it.title || ''}`.toLowerCase();
        if (term && !hay.includes(term)) return false;
        if (excl.length && excl.some(x => hay.includes(x))) return false;
        return true;
    });
};

const SAMPLE = [
    { name: 'archived/old-ui.json',     title: 'old-ui',     format: 'ui' },
    { name: 'test-foo.json',            title: 'foo',        format: 'ui' },
    { name: 'wan-work.json',            title: 'wan-work',   format: 'api' },
    { name: 'z-image-turbo.json',       title: 'z-image',    format: 'ui' },
];

test('computeFiltered: no filters returns all items', () => {
    assert.equal(computeFiltered(SAMPLE, '', []).length, 4);
});

test('computeFiltered: search filters by name substring', () => {
    const r = computeFiltered(SAMPLE, 'wan', []);
    assert.equal(r.length, 1);
    assert.equal(r[0].name, 'wan-work.json');
});

test('computeFiltered: search filters by title substring', () => {
    const r = computeFiltered(SAMPLE, 'old', []);
    assert.equal(r.length, 1);
});

test('computeFiltered: search is case-insensitive', () => {
    const r = computeFiltered(SAMPLE, 'WAN', []);
    assert.equal(r.length, 1);
});

test('computeFiltered: single exclude term hides matches', () => {
    const r = computeFiltered(SAMPLE, '', ['archived']);
    assert.equal(r.length, 3);
    assert.ok(!r.some(it => it.name.includes('archived')));
});

test('computeFiltered: multiple exclude terms (any match hides)', () => {
    const r = computeFiltered(SAMPLE, '', ['archived', 'test']);
    assert.equal(r.length, 2);
});

test('computeFiltered: search AND exclude compose (both must pass)', () => {
    // search "image" matches z-image only; exclude "test" removes test-foo
    const r = computeFiltered(SAMPLE, 'image', ['test']);
    assert.equal(r.length, 1);
    assert.equal(r[0].name, 'z-image-turbo.json');
});

test('computeFiltered: exclude is case-insensitive', () => {
    const r = computeFiltered(SAMPLE, '', ['ARCHIVED']);
    assert.equal(r.length, 3);
});

test('computeFiltered: empty/whitespace-only exclude terms ignored', () => {
    const r = computeFiltered(SAMPLE, '', ['', '  ', 'archived']);
    assert.equal(r.length, 3);
});

const parseExclude = (input) => {
    const raw = String(input || '').trim();
    if (!raw) return [];
    const seen = new Set();
    raw.split(/\s+/).forEach(t => {
        const lower = t.toLowerCase();
        if (lower && !seen.has(lower)) seen.add(lower);
    });
    return Array.from(seen);
};

test('parseExclude: empty string → []', () => {
    assert.deepEqual(parseExclude(''), []);
});

test('parseExclude: whitespace-only → []', () => {
    assert.deepEqual(parseExclude('   '), []);
});

test('parseExclude: single keyword', () => {
    assert.deepEqual(parseExclude('archived'), ['archived']);
});

test('parseExclude: multiple space-separated', () => {
    assert.deepEqual(parseExclude('archived test foo'), ['archived', 'test', 'foo']);
});

test('parseExclude: dedupes case-insensitively', () => {
    assert.deepEqual(parseExclude('Archived ARCHIVED archived'), ['archived']);
});

test('parseExclude: drops empty tokens from double spaces', () => {
    assert.deepEqual(parseExclude('archived  test'), ['archived', 'test']);
});

test('parseExclude: lowercases output', () => {
    assert.deepEqual(parseExclude('ARCHIVED Test'), ['archived', 'test']);
});

const pageCount = (total, size) => Math.max(1, Math.ceil((total || 0) / size));
const pageSlice = (total, page, size) => {
    const pages = pageCount(total, size);
    const p = Math.max(1, Math.min(page || 1, pages));
    const start = (p - 1) * size;
    return { start, end: Math.min(start + size, total), page: p, pages };
};
const windowedPages = (current, total) => {
    const cur = Math.max(1, Math.min(current || 1, total));
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = new Set([1, total, cur, cur - 1, cur + 1, cur - 2, cur + 2]);
    const sorted = Array.from(pages).filter(p => p >= 1 && p <= total).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < sorted.length; i++) {
        if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('…');
        out.push(sorted[i]);
    }
    return out;
};

test('pageCount: 17 items / 10 → 2 pages', () => {
    assert.equal(pageCount(17, 10), 2);
});

test('pageCount: 0 items → 1 page (clamped)', () => {
    assert.equal(pageCount(0, 10), 1);
});

test('pageCount: 100 items / 10 → 10 pages', () => {
    assert.equal(pageCount(100, 10), 10);
});

test('pageCount: 25 items / 10 → 3 pages', () => {
    assert.equal(pageCount(25, 10), 3);
});

test('pageSlice: page 1 of 17 → start 0, end 10', () => {
    const s = pageSlice(17, 1, 10);
    assert.equal(s.start, 0);
    assert.equal(s.end, 10);
});

test('pageSlice: page 2 of 17 → start 10, end 17', () => {
    const s = pageSlice(17, 2, 10);
    assert.equal(s.start, 10);
    assert.equal(s.end, 17);
});

test('pageSlice: page 99 (out of range) → clamped to last page', () => {
    const s = pageSlice(17, 99, 10);
    assert.equal(s.page, 2);
    assert.equal(s.end, 17);
});

test('pageSlice: page 0 → clamped to 1', () => {
    const s = pageSlice(17, 0, 10);
    assert.equal(s.page, 1);
});

test('windowedPages: total ≤ 7 shows all', () => {
    assert.deepEqual(windowedPages(1, 5), [1, 2, 3, 4, 5]);
    assert.deepEqual(windowedPages(3, 7), [1, 2, 3, 4, 5, 6, 7]);
});

test('windowedPages: total 17, current 6 → 1 … 4 5 [6] 7 … 17', () => {
    assert.deepEqual(windowedPages(6, 17), [1, '…', 4, 5, 6, 7, 8, '…', 17]);
});

test('windowedPages: total 17, current 2 → 1 2 3 4 … 17', () => {
    assert.deepEqual(windowedPages(2, 17), [1, 2, 3, 4, '…', 17]);
});

test('windowedPages: total 17, current 17 → 1 … 15 16 17', () => {
    assert.deepEqual(windowedPages(17, 17), [1, '…', 15, 16, 17]);
});

test('windowedPages: total 17, current 1 → 1 2 3 … 17', () => {
    assert.deepEqual(windowedPages(1, 17), [1, 2, 3, '…', 17]);
});

test('renderList: with 17 workflows shows pagination with 2 pages', async () => {
    const { doc } = setupDom({ workflows: makeWorkflows(17) });
    await new Promise(r => setTimeout(r, 50));  // wait for loadStatusAndList
    const items = doc.querySelectorAll('.cmp-item');
    assert.equal(items.length, 10, 'first page shows 10 items');
    const pageBtns = doc.querySelectorAll('.cmp-page-btn');
    assert.ok(pageBtns.length >= 3, 'at least prev + page1 + next');
    const status = doc.querySelector('.cmp-page-status');
    assert.match(status.textContent, /共 17 项/);
});

test('renderList: clicking page 2 shows remaining items', async () => {
    const { doc, win } = setupDom({ workflows: makeWorkflows(17) });
    await new Promise(r => setTimeout(r, 50));
    const page2Btn = Array.from(doc.querySelectorAll('.cmp-page-btn')).find(b => b.dataset.page === '2');
    assert.ok(page2Btn);
    page2Btn.click();
    await new Promise(r => setTimeout(r, 20));
    const items = doc.querySelectorAll('.cmp-item');
    assert.equal(items.length, 7, 'second page shows 7 items');
    const status = doc.querySelector('.cmp-page-status');
    assert.match(status.textContent, /第 2\/2 页/);
});

test('renderList: empty workflows shows empty state, no pagination', async () => {
    const { doc } = setupDom({ workflows: [] });
    await new Promise(r => setTimeout(r, 50));
    const empty = doc.querySelector('.cmp-empty');
    assert.ok(empty);
    assert.match(empty.textContent, /暂无工作流/);
    const bar = doc.getElementById('cmpPagination');
    assert.ok(bar.classList.contains('is-hidden'), 'pagination hidden when 0 items');
});

test('renderList: search filter narrows result and resets to page 1', async () => {
    const { doc } = setupDom({ workflows: makeWorkflows(25) });
    await new Promise(r => setTimeout(r, 50));
    const search = doc.getElementById('cmpSearchInput');
    search.value = 'Workflow 1';
    search.dispatchEvent(new doc.defaultView.Event('input'));
    await new Promise(r => setTimeout(r, 20));
    // Workflows 1, 10-19 all contain "1" — at least 11 items
    const items = doc.querySelectorAll('.cmp-item');
    assert.ok(items.length > 0 && items.length <= 10, 'at most 10 items per page');
});

test('renderList: exclude filter narrows result', async () => {
    const { doc } = setupDom({ workflows: makeWorkflows(25) });
    await new Promise(r => setTimeout(r, 50));
    const exclude = doc.getElementById('cmpExcludeInput');
    exclude.value = 'wf-01 wf-02';
    exclude.dispatchEvent(new doc.defaultView.Event('input'));
    await new Promise(r => setTimeout(r, 20));
    const items = Array.from(doc.querySelectorAll('.cmp-item'));
    assert.ok(items.length > 0);
    items.forEach(it => {
        assert.ok(!it.dataset.name.includes('wf-01'));
        assert.ok(!it.dataset.name.includes('wf-02'));
    });
});

test('cross-page 全选: page 1 selects all 17 (current + after), page 2 toggle removes page-1 picks', async () => {
    // Spec: 全选 from current page selects current page + all subsequent pages.
    // On page 1 of 17: should select all 17 (10 + 7).
    // Navigate to page 2, click 全选 again: inScope = items 11-17, all already
    // selected → toggle deselects them. Final count = 10 (only page-1 items remain).
    const { doc, win } = setupDom({ workflows: makeWorkflows(17) });
    await new Promise(r => setTimeout(r, 50));
    const selectAll = doc.getElementById('cmpSelectAllToggle');
    selectAll.click();
    await new Promise(r => setTimeout(r, 20));
    let count = doc.getElementById('cmpSelectCount').textContent;
    assert.equal(count, '17', 'after page 1 全选, all 17 selected (current + after)');
    const page2Btn = Array.from(doc.querySelectorAll('.cmp-page-btn')).find(b => b.dataset.page === '2');
    page2Btn.click();
    await new Promise(r => setTimeout(r, 20));
    const selectAll2 = doc.getElementById('cmpSelectAllToggle');
    selectAll2.click();
    await new Promise(r => setTimeout(r, 20));
    count = doc.getElementById('cmpSelectCount').textContent;
    assert.equal(count, '10', 'after page 2 全选 (toggle), only page-1 items remain');
});

test('cache-busting: fetch URLs include ?_= query', async () => {
    const { fetchCalls } = setupDom({ workflows: makeWorkflows(5) });
    await new Promise(r => setTimeout(r, 50));
    const statusCalls = fetchCalls.filter(u => u.includes('/api/mcp/status'));
    const listCalls = fetchCalls.filter(u => u.includes('/api/mcp/workflows'));
    assert.ok(statusCalls.length >= 1);
    assert.ok(listCalls.length >= 1);
    assert.match(statusCalls[0], /\?_=\d+/);
    assert.match(listCalls[0], /\?_=\d+/);
});

test('lastFetched indicator updates after successful fetch', async () => {
    const { doc } = setupDom({ workflows: makeWorkflows(5) });
    await new Promise(r => setTimeout(r, 50));
    const lastFetched = doc.getElementById('cmpLastFetched');
    assert.match(lastFetched.textContent, /最后更新 \d{2}:\d{2}:\d{2}/);
});

test('search resets page to 1 when on a later page', async () => {
    const { doc, win } = setupDom({ workflows: makeWorkflows(25) });
    await new Promise(r => setTimeout(r, 50));
    // Navigate to page 2 via the page button
    const page2Btn = Array.from(doc.querySelectorAll('.cmp-page-btn')).find(b => b.dataset.page === '2');
    assert.ok(page2Btn);
    page2Btn.click();
    await new Promise(r => setTimeout(r, 20));
    let status = doc.querySelector('.cmp-page-status');
    assert.match(status.textContent, /第 2\/3 页/, 'confirm we start on page 2 of 3');
    // Type a narrow search term — this should reset STATE.page back to 1
    const search = doc.getElementById('cmpSearchInput');
    search.value = 'Workflow 5';
    search.dispatchEvent(new doc.defaultView.Event('input'));
    await new Promise(r => setTimeout(r, 20));
    // Verify auto-reset: status text must show page 1
    status = doc.querySelector('.cmp-page-status');
    assert.match(status.textContent, /第 1\//, 'search input resets page to 1');
});

test('arrow-left/right on pagination changes page', async () => {
    const { doc, win } = setupDom({ workflows: makeWorkflows(25) });
    await new Promise(r => setTimeout(r, 50));
    const paginationEl = doc.getElementById('cmpPagination');
    // Focus the pagination container, dispatch ArrowRight
    let status = doc.querySelector('.cmp-page-status');
    assert.match(status.textContent, /第 1\/3 页/, 'start on page 1 of 3');
    paginationEl.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await new Promise(r => setTimeout(r, 20));
    status = doc.querySelector('.cmp-page-status');
    assert.match(status.textContent, /第 2\/3 页/, 'ArrowRight advances to page 2');
    paginationEl.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await new Promise(r => setTimeout(r, 20));
    status = doc.querySelector('.cmp-page-status');
    assert.match(status.textContent, /第 3\/3 页/, 'second ArrowRight advances to page 3');
    paginationEl.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await new Promise(r => setTimeout(r, 20));
    paginationEl.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await new Promise(r => setTimeout(r, 20));
    status = doc.querySelector('.cmp-page-status');
    assert.match(status.textContent, /第 1\/3 页/, 'two ArrowLefts return to page 1');
});
