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
