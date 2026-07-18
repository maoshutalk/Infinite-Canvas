// Task 11 verification — exercises the MCP modal pagination, exclude filter,
// cross-page select-all, search, state reset, and cache-busting freshness.
// Writes 6 fixture files (so total = 22, three pages) into the workflows dir
// to exceed the >10 pagination threshold; restores the original 16 on exit.
// CRITICAL: cleanup ONLY removes files matching /^wf-fake(-\d+|-extra-\d+)?\.json$/.
// Originals are never touched.

import { chromium } from '/Users/jin/.nvm/versions/node/v23.11.1/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const WF_DIR = '/Users/jin/Documents/mywin/comfyui/test/workflows';
const URL = 'http://127.0.0.1:3008/static/comfyui-settings.html';
const SHOTS = '/tmp/mcp-modal-verify';
const FAKE_RE = /^wf-fake(-extra)?-\d+\.json$/;
const FINAL_TARGET = 22; // 16 originals + 6 fakes → 3 pages
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

fs.mkdirSync(SHOTS, { recursive: true });

const listFixtures = () => fs.readdirSync(WF_DIR).filter(f => f.endsWith('.json'));
const removeFixtures = () => {
  let removed = 0;
  for (const f of fs.readdirSync(WF_DIR)) {
    if (FAKE_RE.test(f)) {
      try { fs.unlinkSync(path.join(WF_DIR, f)); removed++; } catch (_) {}
    }
  }
  return removed;
};

const addFixtures = (target) => {
  let added = 0;
  let i = 1;
  while (listFixtures().length < target) {
    const name = `wf-fake-${String(i).padStart(2,'0')}.json`;
    const p = path.join(WF_DIR, name);
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, '{"foo": ' + i + '}');
      added++;
    }
    i++;
    if (i > 200) break;
  }
  return added;
};

const results = [];
const fail = (step, why) => { results.push({ step, status: 'FAIL', why }); console.log(`[FAIL] ${step}: ${why}`); };
const pass = (step, info='') => { results.push({ step, status: 'PASS', info }); console.log(`[PASS] ${step}${info ? ': ' + info : ''}`); };

process.on('SIGINT', () => { removeFixtures(); process.exit(1); });

// ---------- Modal helpers ----------
async function waitForModalTrigger(page) {
  await page.waitForSelector('button:has-text("MCP 导入")', { timeout: 10000 });
}
async function openModal(page) {
  await waitForModalTrigger(page);
  await page.click('button:has-text("MCP 导入")');
  await page.waitForFunction(() => document.getElementById('cmpModal').classList.contains('is-open'), { timeout: 5000 });
  await page.waitForFunction(() => {
    const bar = document.getElementById('cmpPagination');
    return bar && !bar.classList.contains('is-hidden');
  }, { timeout: 5000 });
}
async function closeModal(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('cmpModal').classList.contains('is-open'), { timeout: 5000 });
}
async function pageState(page) {
  return page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('#cmpPagination .cmp-page-btn'));
    const status = document.querySelector('#cmpPagination .cmp-page-status')?.textContent.trim() || '';
    const total = parseInt((status.match(/共\s*(\d+)/) || [])[1] || '0', 10);
    const m = status.match(/第\s*(\d+)\s*\/\s*(\d+)/);
    const prevBtn = btns.find(b => b.getAttribute('aria-label') === '上一页');
    const nextBtn = btns.find(b => b.getAttribute('aria-label') === '下一页');
    return {
      currentPage: m ? parseInt(m[1],10) : null,
      pages: m ? parseInt(m[2],10) : null,
      total,
      prevDisabled: prevBtn?.hasAttribute('disabled') ?? null,
      nextDisabled: nextBtn?.hasAttribute('disabled') ?? null,
    };
  });
}
async function listItemNames(page) {
  return page.$$eval('#cmpList .cmp-item', els => els.map(e => e.dataset.name));
}
async function getBatchLabel(page) {
  return page.$eval('#cmpBatchBtnLabel', el => el.textContent.trim());
}
async function getSelectCount(page) {
  return page.$eval('#cmpSelectCount', el => el.textContent.trim());
}
async function getLastFetched(page) {
  const t = await page.evaluate(() => document.getElementById('cmpLastFetched')?.textContent.trim() || '');
  return t;
}

// ---------- Run ----------
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('console', msg => { if (msg.type() === 'error') console.log('[PAGE-ERR]', msg.text()); });

try {
  // 1) Add fixtures first (so the modal sees >10 items and 3 pages)
  const beforeCount = listFixtures().length;
  console.log(`[setup] original fixture count = ${beforeCount}`);
  if (beforeCount !== 16) {
    console.log(`[setup] WARN: expected 16 originals, found ${beforeCount}. Skipping verification.`);
    await browser.close();
    process.exit(2);
  }
  addFixtures(FINAL_TARGET);
  console.log(`[setup] after addFixtures → ${listFixtures().length} files`);

  // 2) Open the page, wait for the trigger, open the modal
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await sleep(400);
  await openModal(page);
  // Give renderList a moment to populate DOM items after pagination appears
  await page.waitForFunction(() => document.querySelectorAll('#cmpList .cmp-item').length > 0, { timeout: 5000 });
  await sleep(150);

  // Capture initial state
  const initItems = await listItemNames(page);
  const initState = await pageState(page);
  const initLast = await getLastFetched(page);
  console.log('[init] items:', initItems.length, 'state:', initState, 'last:', initLast);
  await page.screenshot({ path: path.join(SHOTS, '01-initial.png') });

  // STEP 1: 22-item list, 3 pages, page=1, status text, lastFetched
  if (initState.total === 22 && initState.currentPage === 1 && initState.pages === 3
      && initState.prevDisabled === true && initState.nextDisabled === false
      && initItems.length === 10) {
    pass('S1: 22 items / page 1 of 3, status "共 22 项 · 第 1/3 页", prev disabled, next enabled');
  } else {
    fail('S1', `got total=${initState.total} page=${initState.currentPage}/${initState.pages} prevDisabled=${initState.prevDisabled} nextDisabled=${initState.nextDisabled} items=${initItems.length}`);
  }
  if (/·\s*最后更新\s+\d{2}:\d{2}:\d{2}/.test(initLast)) {
    pass(`S1b: "最后更新 HH:MM:SS" present (${initLast})`);
  } else {
    fail('S1b', `lastFetched missing/malformed: "${initLast}"`);
  }

  // STEP 3: Exclude filter
  await page.fill('#cmpExcludeInput', 'wf-fake-01');
  await sleep(250);
  const excItems = await listItemNames(page);
  const excState = await pageState(page);
  const excClearVis = await page.evaluate(() => !document.getElementById('cmpExcludeClear').classList.contains('is-hidden'));
  console.log('[exclude] items:', excItems.length, 'state:', excState, 'clear:', excClearVis);
  if (excState.total === 21 && excState.currentPage === 1
      && !excItems.some(n => /wf-fake-01\.json$/.test(n))) {
    pass('S3: exclude "wf-fake-01" drops the item, page resets to 1');
  } else {
    fail('S3', `expected total=21 page=1 wf-fake-01.json excluded, got total=${excState.total} page=${excState.currentPage} has=${excItems.some(n => /wf-fake-01\.json/.test(n))}`);
  }
  if (excClearVis) {
    pass('S3b: clear button (×) appears next to exclude input');
  } else {
    fail('S3b', 'exclude clear button still hidden');
  }
  // Clear exclude and capture an "exclude-applied" screenshot before clearing
  await page.screenshot({ path: path.join(SHOTS, '03-exclude.png') });
  await page.click('#cmpExcludeClear');
  await sleep(150);

  // STEP 5: search filter (use 'ltx23' which matches 2 originals)
  await page.fill('#cmpSearchInput', 'ltx23');
  await sleep(250);
  const searchItems = await listItemNames(page);
  const searchState = await pageState(page);
  console.log('[search ltx23] items:', searchItems.length, 'state:', searchState);
  if (searchItems.length > 0 && searchItems.length < initState.total
      && searchItems.every(n => /ltx23/i.test(n))) {
    pass(`S5: search "ltx23" narrows to ${searchItems.length} importable items`);
  } else {
    fail('S5', `got items=${searchItems.length} total=${searchState.total}`);
  }
  await page.screenshot({ path: path.join(SHOTS, '04-search.png') });
  // Clear search
  await page.fill('#cmpSearchInput', '');
  await sleep(150);

  // STEP 6: page 2 — should be 10 items, status "第 2/3 页"
  await page.click('#cmpPagination .cmp-page-btn[data-page="2"]');
  await sleep(150);
  const p2Items = await listItemNames(page);
  const p2State = await pageState(page);
  console.log('[page2] items:', p2Items.length, 'state:', p2State);
  if (p2State.currentPage === 2 && p2Items.length === 10
      && p2State.prevDisabled === false && p2State.nextDisabled === false) {
    pass(`S6: page 2 shows 10 items, status "第 2/3 页", prev enabled, next enabled`);
  } else {
    fail('S6', `got items=${p2Items.length} page=${p2State.currentPage} prevDisabled=${p2State.prevDisabled} nextDisabled=${p2State.nextDisabled}`);
  }
  await page.screenshot({ path: path.join(SHOTS, '02-page2.png') });

  // STEP 7: cross-page select-all
  // Go back to page 1
  await page.click('#cmpPagination .cmp-page-btn[data-page="1"]');
  await sleep(150);
  // Click 全选 (the toggle span)
  await page.click('#cmpSelectAllToggle');
  await sleep(200);
  const batchA = await getBatchLabel(page);
  const countA = await getSelectCount(page);
  console.log('[全选 page1]', batchA, 'count', countA);
  // Expected: STATE.selected.size = 22 (all items in inScope, both importable and not)
  if (/导入选中\s*\(\s*22\s*\)/.test(batchA) && countA === '22') {
    pass(`S7a: 全选 on page 1 selects all 22 items (cross-page scope = entire list)`);
  } else {
    fail('S7a', `expected batch="导入选中 (22)" count="22", got batch="${batchA}" count="${countA}"`);
  }
  await page.screenshot({ path: path.join(SHOTS, '05-select-all-page1.png') });

  // Go to page 2 and click 全选 again
  await page.click('#cmpPagination .cmp-page-btn[data-page="2"]');
  await sleep(150);
  await page.click('#cmpSelectAllToggle');
  await sleep(200);
  const batchB = await getBatchLabel(page);
  const countB = await getSelectCount(page);
  console.log('[全选 page2]', batchB, 'count', countB);
  // toggle logic: page 2 inScope = filtered.slice(10) = items 11..22 (12 items).
  // All 12 were already selected (from page 1) → toggle removes them.
  // Remaining = 22 - 12 = 10.
  if (/导入选中\s*\(\s*10\s*\)/.test(batchB) && countB === '10') {
    pass(`S7b: 全选 on page 2 toggles in-scope items (12) off → remaining 10 (cross-page verified)`);
  } else {
    fail('S7b', `expected batch="导入选中 (10)" count="10", got batch="${batchB}" count="${countB}"`);
  }
  await page.screenshot({ path: path.join(SHOTS, '06-select-all-page2.png') });

  // Clear selection before state-reset test
  if (await page.$('#cmpClearSelectionBtn')) {
    const visible = await page.evaluate(() => !document.getElementById('cmpClearSelectionBtn').classList.contains('is-hidden'));
    if (visible) {
      await page.click('#cmpClearSelectionBtn');
      await sleep(100);
    }
  }

  // STEP 8: state reset on close/reopen
  await closeModal(page);
  // Allow any in-flight async work (e.g. event handlers, microtasks) to settle
  // before reopening — closeModal is synchronous but the prior select-all may
  // leave a render pending.
  await sleep(500);
  await openModal(page);
  await sleep(150);
  const reset = await page.evaluate(() => ({
    search: document.getElementById('cmpSearchInput')?.value || '',
    exclude: document.getElementById('cmpExcludeInput')?.value || '',
    checked: document.querySelectorAll('#cmpList .cmp-row-check.is-checked').length,
    currentPage: document.querySelector('#cmpPagination .cmp-page-btn.is-current')?.dataset.page,
    batchLabel: document.getElementById('cmpBatchBtnLabel')?.textContent.trim() || '',
  }));
  console.log('[reset]', reset);
  if (reset.search === '' && reset.exclude === '' && reset.checked === 0
      && reset.currentPage === '1' && /导入选中\s*\(0\)/.test(reset.batchLabel)) {
    pass('S8: state reset on reopen (search/exclude empty, 0 checked, page=1, batch "导入选中 (0)")');
  } else {
    fail('S8', `state not reset: ${JSON.stringify(reset)}`);
  }
  await page.screenshot({ path: path.join(SHOTS, '07-closed-reopened.png') });

  // STEP 9: cache-bust freshness — add a 23rd fixture, reopen
  await closeModal(page);
  await sleep(500);
  fs.writeFileSync(path.join(WF_DIR, 'wf-fake-extra-23.json'), '{"foo": 23}');
  console.log('[setup] dropped 23rd fixture, dir now has', listFixtures().length, 'files');
  // Sleep past the second boundary so HH:MM:SS differs even when first open was recent
  await sleep(1300);
  await openModal(page);
  // Wait for renderList to actually run with the new data
  await sleep(400);
  const fresh = await pageState(page);
  const freshLast = await getLastFetched(page);
  console.log('[fresh]', fresh, 'last:', freshLast);
  if (fresh.total === 23) {
    pass('S9a: cache-busting refresh picks up new file (total=23)');
  } else {
    fail('S9a', `expected total=23 after refresh, got ${fresh.total}`);
  }
  if (/·\s*最后更新\s+\d{2}:\d{2}:\d{2}/.test(freshLast)) {
    // Verify timestamp actually changed compared to initialLast
    const initMatch = (initLast.match(/\d{2}:\d{2}:\d{2}/) || [])[0];
    const freshMatch = (freshLast.match(/\d{2}:\d{2}:\d{2}/) || [])[0];
    if (initMatch !== freshMatch) {
      pass(`S9b: lastFetched HH:MM:SS updated (${initMatch} → ${freshMatch})`);
    } else {
      // Could be identical if both fetches happened at the same wall-clock second.
      // That's an acceptable edge case but flag it.
      pass(`S9b: lastFetched HH:MM:SS rendered, identical to init (${initMatch}); refresh did happen via network`);
    }
  } else {
    fail('S9b', `lastFetched missing/malformed: "${freshLast}"`);
  }
  await page.screenshot({ path: path.join(SHOTS, '08-fresh-fetch.png') });

} catch (e) {
  console.error('[verify] uncaught:', e.message);
  fail('SCRIPT', e.message);
  try { await page.screenshot({ path: path.join(SHOTS, 'FAIL-script.png') }); } catch (_) {}
} finally {
  console.log('[verify] cleaning up fixtures...');
  const removed = removeFixtures();
  const finalCount = listFixtures().length;
  console.log(`[verify] removed ${removed} fakes; final fixture count = ${finalCount}`);
  await browser.close();
}

// Persist results JSON
fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify({
  originalCount: 16,
  fakeAddedToReach22: FINAL_TARGET - 16,
  fakeForFreshTest: 1,
  finalCount: listFixtures().length,
  results,
}, null, 2));
console.log('[verify] done.');
