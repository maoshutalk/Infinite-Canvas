import { test } from 'node:test';
import assert from 'node:assert/strict';

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
