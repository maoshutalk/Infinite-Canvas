/*
 * comfyui-mcp-plugin.js — ComfyUI MCP import feature as a loadable plugin.
 *
 * Scans the host page for these anchor points and mounts itself:
 *   - [data-comfyui-mcp-mount]   → compact sidebar card (status badge + workflow count)
 *   - [data-comfyui-mcp-trigger] → "MCP 导入" button next to "上传工作流"
 *   - The trigger button is the only clickable entry point.
 *   - First form opens an import modal appended to <body>.
 *
 * Host integration (graceful, no-op if missing):
 *   - window.loadList()  : refresh main workflow list after import
 *   - window.showToast() : success/error notifications
 *
 * Public API: window.ComfyuiMcpPlugin = { openModal, closeModal, refresh }.
 */
(function () {
    'use strict';

    // ---------- State ----------
    const STATE = {
        items: [],                  // latest list from /api/mcp/workflows
        selected: new Set(),        // checked workflow names (cross-page)
        filter: '',                 // search filter (lowercased)
        exclude: [],                // exclude keywords (lowercased, deduped)
        page: 1,                    // current page (1-based)
        pageSize: 10,               // items per page
        modalOpen: false,
        prevFocus: null,
        refreshInflight: null,
        lastFetchedAt: null,        // Date of last successful refresh
    };

    const MCP_STATE_LABELS = {
        loading:        { text: '检测中…',            cls: 'cmp-state-loading' },
        connected:      { text: '已连接',              cls: 'cmp-state-connected' },
        mismatch:       { text: '地址不匹配',          cls: 'cmp-state-mismatch' },
        not_configured: { text: '未配置',              cls: 'cmp-state-unset' },
        dir_missing:    { text: '工作流目录不存在',     cls: 'cmp-state-unset' },
    };

    const API = {
        status: '/api/mcp/status',
        list:   '/api/mcp/workflows',
        importOne:  (name) => `/api/mcp/workflows/${encodeURIComponent(name)}/import`,
        importBatch:'/api/mcp/workflows/import-batch',
    };

    function parseExclude(input) {
        const raw = String(input || '').trim();
        if (!raw) return [];
        const seen = new Set();
        raw.split(/\s+/).forEach(t => {
            const lower = t.toLowerCase();
            if (lower && !seen.has(lower)) seen.add(lower);
        });
        return Array.from(seen);
    }

    function pageCount(total, size) {
        return Math.max(1, Math.ceil((total || 0) / size));
    }
    function pageSlice(total, page, size) {
        const pages = pageCount(total, size);
        const p = Math.max(1, Math.min(page || 1, pages));
        const start = (p - 1) * size;
        return { start, end: Math.min(start + size, total), page: p, pages };
    }
    function windowedPages(current, total) {
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
    }

    // ---------- Helpers ----------
    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }
    function escapeJs(s) {
        return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }
    function refreshIcons() {
        if (window.lucide) window.lucide.createIcons();
    }
    function toast(text, isError) {
        if (typeof window.showToast === 'function') {
            window.showToast(text, isError);
        } else if (isError) {
            console.error('[mcp-plugin]', text);
        }
    }
    async function refreshHostList() {
        if (typeof window.loadList === 'function') {
            try { await window.loadList(); } catch (_) { /* host-side error ignored */ }
        }
    }
    function el(tag, attrs, children) {
        const node = document.createElement(tag);
        if (attrs) {
            for (const [k, v] of Object.entries(attrs)) {
                if (v == null || v === false) continue;
                if (k === 'class') node.className = v;
                else if (k === 'dataset') Object.assign(node.dataset, v);
                else if (k.startsWith('on') && typeof v === 'function') {
                    node.addEventListener(k.slice(2).toLowerCase(), v);
                } else if (k === 'html') node.innerHTML = v;
                else if (k in node) node[k] = v;
                else node.setAttribute(k, v);
            }
        }
        if (children != null) {
            const arr = Array.isArray(children) ? children : [children];
            arr.forEach(c => {
                if (c == null) return;
                if (typeof c === 'string') node.appendChild(document.createTextNode(c));
                else node.appendChild(c);
            });
        }
        return node;
    }

    // ---------- DOM construction ----------
    // Each mounted piece is wrapped in a `display:contents` div with class
    // `comfyui-mcp-root` so its scoped CSS rules apply, but layout is
    // unaffected. The compact card lives next to its sidebar slot; the
    // trigger button lives inside the 工作流列表 footer; the modal lives
    // on <body>. All three carry the same root class — descendants match.
    function wrapRoot(child) {
        const wrap = document.createElement('div');
        wrap.className = 'comfyui-mcp-root';
        wrap.appendChild(child);
        return wrap;
    }

    function buildCompactCard() {
        // Compact card is status-only — the clickable entry point lives
        // in the 工作流列表 card footer (data-comfyui-mcp-trigger) so
        // there's exactly one way to open the modal.
        return el('div', { class: 'side-card cmp-card' }, [
            el('div', { class: 'cmp-title-row' }, [
                el('div', { class: 'cmp-title', textContent: 'ComfyUI MCP 源' }),
                el('div', { id: 'cmpCount', class: 'cmp-count', textContent: '—', title: '工作流数量' }),
            ]),
            el('div', { class: 'cmp-status-row' }, [
                el('div', { id: 'cmpBadgeCompact', class: 'cmp-badge cmp-state-loading', textContent: '检测中…' }),
            ]),
            el('div', { id: 'cmpHintCompact', class: 'cmp-hint' }),
        ]);
    }

    function buildTriggerButton() {
        // Stand-alone button styled like the host's "上传工作流" button.
        return el('button', {
            class: 'upload-btn',
            type: 'button',
            style: 'flex:1',
            title: '从 ComfyUI MCP 源导入',
            onclick: openModal,
        }, [
            el('i', { dataset: { lucide: 'cloud-download' }, class: 'w-3.5 h-3.5' }),
            el('span', { textContent: 'MCP 导入' }),
        ]);
    }

    function buildModal() {
        const modal = el('div', {
            id: 'cmpModal',
            class: 'cmp-modal',
            ariaHidden: 'true',
            role: 'dialog',
            ariaModal: 'true',
            ariaLabelledby: 'cmpModalTitle',
        });
        const backdrop = el('div', { class: 'cmp-modal-backdrop', onclick: closeModal });
        backdrop.addEventListener('click', closeModal);

        const panel = el('div', { class: 'cmp-modal-panel', role: 'document' });

        const header = el('header', { class: 'cmp-modal-header' }, [
            el('div', { class: 'cmp-modal-title-row' }, [
                el('i', { dataset: { lucide: 'cloud-download' }, class: 'w-4 h-4', style: 'color:var(--muted)' }),
                el('h2', { id: 'cmpModalTitle', class: 'cmp-modal-title', textContent: '从 ComfyUI MCP 源导入' }),
                el('button', {
                    type: 'button',
                    class: 'cmp-modal-icon-btn',
                    title: '刷新',
                    ariaLabel: '刷新',
                    onclick: () => loadStatusAndList(),
                }, [el('i', { dataset: { lucide: 'refresh-cw' }, class: 'w-3.5 h-3.5' })]),
                el('button', {
                    type: 'button',
                    class: 'cmp-modal-icon-btn',
                    title: '关闭 (Esc)',
                    ariaLabel: '关闭',
                    onclick: closeModal,
                }, [el('i', { dataset: { lucide: 'x' }, class: 'w-4 h-4' })]),
            ]),
            el('div', { class: 'cmp-modal-status-row' }, [
                el('div', { id: 'cmpBadgeModal', class: 'cmp-badge cmp-state-loading', textContent: '检测中…' }),
                el('span', { id: 'cmpHintModal', class: 'cmp-hint' }),
            ]),
        ]);

        const searchRow = el('div', { class: 'cmp-search' }, [
            el('i', { dataset: { lucide: 'search' }, class: 'w-3 h-3 cmp-search-icon' }),
            el('input', {
                id: 'cmpSearchInput',
                type: 'search',
                placeholder: '搜索工作流',
                autocomplete: 'off',
                spellcheck: false,
                oninput: (e) => onSearchInput(e.target.value),
            }),
            el('button', {
                id: 'cmpSearchClear',
                type: 'button',
                class: 'cmp-search-clear is-hidden',
                ariaLabel: '清空搜索',
                title: '清空搜索',
                onclick: clearSearch,
            }, [el('i', { dataset: { lucide: 'x' }, class: 'w-3 h-3' })]),
        ]);

        const excludeRow = el('div', { class: 'cmp-search cmp-exclude' }, [
            el('i', { dataset: { lucide: 'filter-x' }, class: 'w-3 h-3 cmp-search-icon' }),
            el('input', {
                id: 'cmpExcludeInput',
                type: 'search',
                placeholder: '排除关键词（空格分隔，如 archived test）',
                autocomplete: 'off',
                spellcheck: false,
                oninput: (e) => onExcludeInput(e.target.value),
            }),
            el('button', {
                id: 'cmpExcludeClear',
                type: 'button',
                class: 'cmp-search-clear is-hidden',
                ariaLabel: '清空排除',
                title: '清空排除',
                onclick: clearExclude,
            }, [el('i', { dataset: { lucide: 'x' }, class: 'w-3 h-3' })]),
        ]);

        const selectAllRow = el('div', { id: 'cmpSelectAllRow', class: 'cmp-select-all is-hidden' }, [
            el('span', {
                id: 'cmpSelectAllToggle',
                class: 'cmp-row-check',
                tabIndex: 0,
                role: 'checkbox',
                ariaChecked: 'false',
                ariaLabel: '全选',
                onclick: toggleSelectAll,
                onkeydown: (e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        toggleSelectAll();
                    }
                },
            }),
            el('span', { class: 'cmp-select-all-label', onclick: toggleSelectAll, textContent: '全选' }),
            el('button', {
                type: 'button',
                id: 'cmpClearSelectionBtn',
                class: 'cmp-clear-selection is-hidden',
                title: '清空选择',
                onclick: clearSelection,
                textContent: '清空',
            }),
            el('span', { id: 'cmpSelectCount', class: 'cmp-select-count', textContent: '0' }),
        ]);

        const toolbar = el('div', { class: 'cmp-modal-toolbar' }, [selectAllRow, searchRow, excludeRow]);
        const list = el('div', { id: 'cmpList', class: 'cmp-list' });

        const pagination = el('div', { id: 'cmpPagination', class: 'cmp-pagination is-hidden' });
        const body = el('div', { class: 'cmp-modal-body' }, [toolbar, list, pagination]);

        const footer = el('footer', { class: 'cmp-modal-footer' }, [
            el('div', { class: 'cmp-modal-footer-info' }, [
                el('i', { dataset: { lucide: 'info' }, class: 'w-3 h-3' }),
                el('span', { textContent: '勾选要导入的工作流，支持批量' }),
            ]),
            el('div', { class: 'cmp-modal-footer-actions' }, [
                el('button', { type: 'button', class: 'cmp-action-btn', onclick: closeModal, textContent: '取消' }),
                el('button', {
                    id: 'cmpBatchImportBtn',
                    type: 'button',
                    class: 'cmp-action-btn is-primary',
                    'aria-label': '批量导入选中工作流',
                    onclick: importMany,
                    disabled: true,
                }, [
                    el('span', { class: 'btn-label' }, [
                        el('i', { dataset: { lucide: 'download' }, class: 'w-3.5 h-3.5' }),
                        el('span', { id: 'cmpBatchBtnLabel', textContent: '导入选中 (0)' }),
                    ]),
                ]),
            ]),
        ]);

        panel.append(header, body, footer);
        modal.append(backdrop, panel);
        return modal;
    }

    // ---------- Badge / hint (writes to compact card AND modal) ----------
    // All element IDs are unique within the page, so document.getElementById
    // (rather than querySelector(root)) works regardless of which subtree
    // each piece ended up in.
    function getRefs() {
        return {
            badgeCompact: document.getElementById('cmpBadgeCompact'),
            badgeModal: document.getElementById('cmpBadgeModal'),
            hintCompact: document.getElementById('cmpHintCompact'),
            hintModal: document.getElementById('cmpHintModal'),
            count: document.getElementById('cmpCount'),
            list: document.getElementById('cmpList'),
            batch: document.getElementById('cmpBatchImportBtn'),
            batchLabel: document.getElementById('cmpBatchBtnLabel'),
            selectAllRow: document.getElementById('cmpSelectAllRow'),
            selectAllToggle: document.getElementById('cmpSelectAllToggle'),
            selectCount: document.getElementById('cmpSelectCount'),
            clearSelectionBtn: document.getElementById('cmpClearSelectionBtn'),
            searchClearBtn: document.getElementById('cmpSearchClear'),
            excludeInput: document.getElementById('cmpExcludeInput'),
            excludeClearBtn: document.getElementById('cmpExcludeClear'),
            lastFetched: document.getElementById('cmpLastFetched'),
        };
    }
    function setBadge(state, customText) {
        const r = getRefs();
        const meta = MCP_STATE_LABELS[state] || MCP_STATE_LABELS.loading;
        const text = (customText ? customText + ' · ' : '') + meta.text;
        const cls = 'cmp-badge ' + meta.cls;
        [r.badgeCompact, r.badgeModal].forEach(node => {
            if (!node) return;
            node.textContent = text;
            node.className = cls;
        });
    }
    function setHint(text) {
        const r = getRefs();
        const payload = text || '';
        [r.hintCompact, r.hintModal].forEach(node => {
            if (node) node.textContent = payload;
        });
    }
    function setCount(n) {
        const r = getRefs();
        if (!r.count) return;
        r.count.textContent = (typeof n === 'number' && n > 0) ? String(n) : '—';
    }

    // ---------- Filter / selection / list render ----------
    // Filtering is handled inside renderList via computeFiltered + pageSlice.

    function computeFiltered(items, filter, exclude) {
        const term = (filter || '').trim().toLowerCase();
        const excl = (exclude || []).map(x => String(x || '').toLowerCase()).filter(Boolean);
        return (items || []).filter(it => {
            const hay = `${it.name || ''} ${it.title || ''}`.toLowerCase();
            if (term && !hay.includes(term)) return false;
            if (excl.length && excl.some(x => hay.includes(x))) return false;
            return true;
        });
    }

    function updateSelectionUi() {
        const r = getRefs();
        if (!r.list) return;
        const filtered = computeFiltered(STATE.items, STATE.filter, STATE.exclude);
        const importableNames = new Set(
            filtered.filter(it => it.format === 'ui' || it.format === 'api').map(it => it.name)
        );
        const items = Array.from(r.list.querySelectorAll('.cmp-item'));
        const visibleImportable = items.filter(el =>
            el.dataset.canImport === 'true' && !el.classList.contains('is-hidden'));
        const selectedInScope = visibleImportable.filter(el => STATE.selected.has(el.dataset.name)).length;

        // Per-row visual
        items.forEach(row => {
            const name = row.dataset.name;
            const isSel = STATE.selected.has(name);
            const chk = row.querySelector('.cmp-row-check');
            if (chk) {
                chk.classList.toggle('is-checked', isSel);
                chk.setAttribute('aria-checked', isSel ? 'true' : 'false');
            }
        });

        if (r.selectAllRow) {
            r.selectAllRow.classList.toggle('is-hidden', importableNames.size === 0);
        }
        if (r.selectAllToggle) {
            const hasAny = visibleImportable.length > 0;
            const allChecked = hasAny && selectedInScope === visibleImportable.length && visibleImportable.length > 0;
            const someChecked = selectedInScope > 0 && selectedInScope < visibleImportable.length;
            r.selectAllToggle.classList.toggle('is-checked', allChecked);
            r.selectAllToggle.classList.toggle('is-indeterminate', someChecked);
            r.selectAllToggle.setAttribute('aria-checked', allChecked ? 'true' : (someChecked ? 'mixed' : 'false'));
        }
        const totalSelected = STATE.selected.size;
        if (r.selectCount) {
            r.selectCount.textContent = String(totalSelected);
            r.selectCount.classList.toggle('is-active', totalSelected > 0);
        }
        if (r.clearSelectionBtn) {
            r.clearSelectionBtn.classList.toggle('is-hidden', totalSelected === 0);
        }
        if (r.batch) {
            const has = totalSelected > 0;
            r.batch.disabled = !has;
            r.batch.setAttribute('aria-disabled', has ? 'false' : 'true');
        }
        if (r.batchLabel) {
            r.batchLabel.textContent = totalSelected > 0 ? `导入选中 (${totalSelected})` : '导入选中 (0)';
        }
    }

    function toggleRow(name, selected) {
        if (!name) return;
        if (selected) STATE.selected.add(name);
        else STATE.selected.delete(name);
        updateSelectionUi();
    }
    function toggleSelectAll() {
        const filtered = computeFiltered(STATE.items, STATE.filter, STATE.exclude);
        const startIdx = (STATE.page - 1) * STATE.pageSize;
        const inScope = filtered.slice(startIdx);
        if (!inScope.length) return;
        const allSelected = inScope.every(it => STATE.selected.has(it.name));
        if (allSelected) inScope.forEach(it => STATE.selected.delete(it.name));
        else inScope.forEach(it => STATE.selected.add(it.name));
        updateSelectionUi();
    }
    function clearSelection() {
        if (!STATE.selected.size) return;
        STATE.selected.clear();
        updateSelectionUi();
    }
    function onSearchInput(value) {
        STATE.filter = String(value || '').trim().toLowerCase();
        const r = getRefs();
        if (r.searchClearBtn) r.searchClearBtn.classList.toggle('is-hidden', STATE.filter.length === 0);
        renderList(STATE.items);
    }
    function clearSearch() {
        const r = getRefs();
        const input = r.list?.parentElement?.querySelector('#cmpSearchInput');
        if (input) input.value = '';
        STATE.filter = '';
        if (r.searchClearBtn) r.searchClearBtn.classList.add('is-hidden');
        renderList(STATE.items);
    }

    function onExcludeInput(value) {
        STATE.exclude = parseExclude(value);
        const r = getRefs();
        if (r.excludeClearBtn) r.excludeClearBtn.classList.toggle('is-hidden', STATE.exclude.length === 0);
        STATE.page = 1;  // reset to first page on filter change
        renderList();
    }
    function clearExclude() {
        const r = getRefs();
        const input = document.getElementById('cmpExcludeInput');
        if (input) input.value = '';
        STATE.exclude = [];
        if (r.excludeClearBtn) r.excludeClearBtn.classList.add('is-hidden');
        STATE.page = 1;
        renderList();
    }

    function renderList(items) {
        const r = getRefs();
        if (!r.list) return;
        if (!items || !items.length) {
            STATE.items = [];
            STATE.page = 1;
            r.list.innerHTML = '<div class="cmp-empty">暂无工作流</div>';
            renderPagination(0, 1);
            setCount(0);
            updateSelectionUi();
            return;
        }
        STATE.items = items;

        // Drop selections that no longer exist.
        const existing = new Set(items.map(i => i.name));
        if (!existing.size) STATE.selected.clear();
        else Array.from(STATE.selected).forEach(n => { if (!existing.has(n)) STATE.selected.delete(n); });

        const filtered = computeFiltered(items, STATE.filter, STATE.exclude);
        const total = filtered.length;
        const slice = pageSlice(total, STATE.page, STATE.pageSize);
        STATE.page = slice.page;  // auto-clamp
        const pageItems = filtered.slice(slice.start, slice.end);

        if (total === 0) {
            const reason = STATE.filter ? `没有匹配 “${STATE.filter}” 的工作流` :
                           STATE.exclude.length ? '所有工作流都被排除词隐藏' :
                           '暂无工作流';
            r.list.innerHTML = `<div class="cmp-empty">${escapeHtml(reason)}</div>`;
            renderPagination(0, 1);
            updateSelectionUi();
            return;
        }

        r.list.innerHTML = pageItems.map(item => {
            const fmt = item.format || 'unknown';
            const canImport = fmt === 'ui' || fmt === 'api';
            const title = item.title || item.name;
            const sizeKb = (item.size / 1024).toFixed(1);
            const date = item.mtime ? new Date(item.mtime).toLocaleString() : '';
            const errorTag = item.error
                ? `<span class="cmp-error-tag" title="${escapeHtml(item.error)}">⚠ 解析失败</span>`
                : '';
            const safeName = String(item.name);
            const dataAttrs =
                `data-name="${escapeHtml(safeName)}" ` +
                `data-title="${escapeHtml(title)}" ` +
                `data-can-import="${canImport}" `;
            const toggleAttr = `tabindex="0" role="checkbox" aria-checked="${STATE.selected.has(safeName)}" aria-label="${escapeHtml(safeName)}"` +
                (canImport ? '' : ' aria-disabled="true"');
            const checkCls = STATE.selected.has(safeName) ? 'is-checked' : '';
            const checkDisabledCls = canImport ? '' : 'is-disabled';
            const importOnclick = canImport
                ? `onclick="window.ComfyuiMcpPlugin._importOne('${escapeJs(safeName)}', this)"`
                : 'disabled';
            return `
            <div class="cmp-item" ${dataAttrs}>
                <span class="cmp-row-check ${checkCls} ${checkDisabledCls}" ${toggleAttr}></span>
                <div class="cmp-item-meta">
                    <div class="cmp-item-title" title="${escapeHtml(safeName)}">${escapeHtml(title)}</div>
                    <div class="cmp-item-sub">[${fmt}] · ${sizeKb}KB · ${date}${errorTag ? ' · ' + errorTag : ''}</div>
                </div>
                <button class="upload-btn cmp-import-btn" type="button"
                        ${importOnclick}
                        title="${canImport ? '导入到工作流列表' : '格式无法识别，无法导入'}">
                    <i data-lucide="download" class="w-3 h-3"></i><span>导入</span>
                </button>
            </div>`;
        }).join('');
        refreshIcons();
        renderPagination(total, slice.page);
        updateSelectionUi();
    }

    function renderPagination(filteredTotal, pageInfo) {
        const bar = document.getElementById('cmpPagination');
        if (!bar) return;
        if (filteredTotal === 0) {
            bar.innerHTML = '';
            bar.classList.add('is-hidden');
            return;
        }
        bar.classList.remove('is-hidden');
        const { page, pages } = pageSlice(filteredTotal, STATE.page, STATE.pageSize);
        const labels = windowedPages(page, pages);
        const btn = (label, target, opts = {}) => {
            const cls = ['cmp-page-btn'];
            if (opts.current) cls.push('is-current');
            if (opts.disabled) cls.push('is-disabled');
            if (opts.edge) cls.push('cmp-page-edge');
            return `<button type="button" class="${cls.join(' ')}" data-page="${target}" ${opts.disabled ? 'disabled aria-disabled="true"' : ''} aria-label="${escapeHtml(opts.aria || String(label))}">${escapeHtml(String(label))}</button>`;
        };
        const parts = [];
        parts.push(btn('«', 1, { edge: true, disabled: page === 1, aria: '首页' }));
        parts.push(btn('‹', page - 1, { edge: true, disabled: page === 1, aria: '上一页' }));
        labels.forEach(l => {
            if (l === '…') parts.push('<span class="cmp-page-ellipsis" aria-hidden="true">…</span>');
            else parts.push(btn(l, l, { current: l === page, aria: `第 ${l} 页` }));
        });
        parts.push(btn('›', page + 1, { edge: true, disabled: page === pages, aria: '下一页' }));
        parts.push(btn('»', pages, { edge: true, disabled: page === pages, aria: '末页' }));
        parts.push(`<span class="cmp-page-status">共 ${filteredTotal} 项 · 第 ${page}/${pages} 页</span>`);
        bar.innerHTML = parts.join('');
    }

    // ---------- Data fetches ----------
    async function loadStatusAndList() {
        // Avoid concurrent refresh storms from multiple Escape-clicked buttons.
        if (STATE.refreshInflight) {
            try { await STATE.refreshInflight; } catch (_) {}
        }
        setBadge('loading');
        setHint('');
        const r = getRefs();
        if (r.list) r.list.innerHTML = '<div class="cmp-empty">加载中…</div>';
        STATE.refreshInflight = (async () => {
            try {
                const [statusRes, listRes] = await Promise.all([
                    fetch(API.status).then(x => x.json()),
                    fetch(API.list).then(x => x.json()),
                ]);
                const matched = statusRes.matched_instance || '';
                const fileCount = statusRes.file_count || 0;
                setBadge(statusRes.state);
                setCount(fileCount);
                if (matched) {
                    setHint(`${matched} · ${fileCount} 个工作流`);
                } else {
                    setHint('');
                }
                if (statusRes.state === 'mismatch') {
                    const url = statusRes.comfyui_url || '?';
                    const norm = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
                    setHint(`MCP 指向 ${norm}，但当前未配置为 ComfyUI 后端`);
                } else if (statusRes.state === 'not_configured') {
                    setHint(`未找到 MCP 配置文件：${statusRes.config_path || ''}`);
                } else if (statusRes.state === 'dir_missing') {
                    setHint(`工作流目录不存在：${statusRes.workflows_dir || ''}`);
                } else if (statusRes.error) {
                    setHint(`配置错误：${statusRes.error}`);
                }
                renderList(listRes.workflows || []);
            } catch (_) {
                setBadge('not_configured');
                setHint('无法连接到本地服务');
                const rr = getRefs();
                if (rr.list) rr.list.innerHTML = '';
                STATE.items = [];
                updateSelectionUi();
            }
        })();
        try { await STATE.refreshInflight; } finally { STATE.refreshInflight = null; }
    }

    async function importOne(name, btnEl) {
        if (!name) return;
        const originalHtml = btnEl.innerHTML;
        btnEl.disabled = true;
        btnEl.innerHTML = '<i data-lucide="loader" class="w-3 h-3"></i><span>导入中</span>';
        refreshIcons();
        try {
            const res = await fetch(API.importOne(name), { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
            toast(`已导入 ${data.name}`);
            STATE.selected.delete(name);
            await Promise.all([refreshHostList(), loadStatusAndList()]);
        } catch (err) {
            toast(`导入失败: ${err.message}`, true);
            btnEl.disabled = false;
            btnEl.innerHTML = originalHtml;
            refreshIcons();
        }
    }

    async function importMany() {
        const names = STATE.items
            .filter(it => (it.format === 'ui' || it.format === 'api') && STATE.selected.has(it.name))
            .map(it => it.name);
        if (!names.length) return;
        const r = getRefs();
        if (r.batch) r.batch.classList.add('is-running');
        if (r.batchLabel) r.batchLabel.textContent = '导入中…';
        if (r.batch) r.batch.disabled = true;
        try {
            const res = await fetch(API.importBatch, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ names }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
            const imported = data.imported ?? 0;
            const results = data.results || [];
            const failed = data.failed ?? results.filter(x => !x.ok).length;
            const failedNames = results.filter(x => !x.ok).map(x => x.name);
            if (imported && !failed) toast(`已导入 ${imported} 个工作流`);
            else if (imported && failed) toast(`导入成功 ${imported} 个，失败 ${failed} 个`, true);
            else if (failed) toast(
                `导入失败：${failedNames.slice(0, 2).join('、')}${failedNames.length > 2 ? '…' : ''}`,
                true
            );
            names.forEach(n => STATE.selected.delete(n));
            await Promise.all([refreshHostList(), loadStatusAndList()]);
        } catch (err) {
            toast(`批量导入失败: ${err.message}`, true);
            if (r.batchLabel) r.batchLabel.textContent = `导入选中 (${names.length})`;
        } finally {
            if (r.batch) {
                r.batch.classList.remove('is-running');
                r.batch.disabled = false;
            }
            updateSelectionUi();
        }
    }

    // ---------- Modal lifecycle ----------
    async function openModal() {
        const modal = document.getElementById('cmpModal');
        if (!modal || STATE.modalOpen) return;
        STATE.prevFocus = document.activeElement;
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
        STATE.modalOpen = true;
        document.body.classList.add('cmp-modal-open');
        const title = document.getElementById('cmpModalTitle');
        if (title) {
            title.setAttribute('tabindex', '-1');
            title.focus({ preventScroll: true });
        }
        try {
            await Promise.all([refreshHostList(), loadStatusAndList()]);
        } catch (_) { /* errors already surfaced */ }
    }
    function closeModal() {
        const modal = document.getElementById('cmpModal');
        if (!modal || !STATE.modalOpen) return;
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
        STATE.modalOpen = false;
        document.body.classList.remove('cmp-modal-open');
        // Clear filter/page/selection state on close (per spec: no persistence)
        STATE.filter = '';
        STATE.exclude = [];
        STATE.page = 1;
        STATE.selected.clear();
        const searchInput = document.getElementById('cmpSearchInput');
        if (searchInput) searchInput.value = '';
        const excludeInput = document.getElementById('cmpExcludeInput');
        if (excludeInput) excludeInput.value = '';
        if (STATE.prevFocus && typeof STATE.prevFocus.focus === 'function') {
            STATE.prevFocus.focus({ preventScroll: true });
        }
        STATE.prevFocus = null;
    }
    function onGlobalKeydown(e) {
        if (e.key === 'Escape' && STATE.modalOpen) {
            e.preventDefault();
            closeModal();
        }
    }

    // ---------- Mount ----------
    function mount() {
        const mounts = document.querySelectorAll('[data-comfyui-mcp-mount]');
        const triggers = document.querySelectorAll('[data-comfyui-mcp-trigger]');
        if (!mounts.length && !triggers.length) return; // not on this page

        // Each piece is wrapped in its own `.comfyui-mcp-root` so the
        // scoped CSS rules apply without affecting host layout.
        // The compact sidebar card is intentionally NOT rendered — the
        // 工作流列表 footer button is the only entry point to the modal.
        triggers.forEach(slot => slot.appendChild(wrapRoot(buildTriggerButton())));
        // Modal is the only piece that goes to <body> directly — overlay
        // positioning needs to escape any transformed/scrolled ancestors.
        document.body.appendChild(wrapRoot(buildModal()));

        refreshIcons();
        document.addEventListener('keydown', onGlobalKeydown);

        // Event delegation for checkbox toggle — bound once on the list container.
        const listEl = document.getElementById('cmpList');
        if (listEl) {
            listEl.addEventListener('click', (e) => {
                const chk = e.target.closest('.cmp-row-check');
                if (!chk || chk.classList.contains('is-disabled')) return;
                const row = chk.closest('.cmp-item');
                const name = row ? row.dataset.name : null;
                if (!name) return;
                toggleRow(name, !STATE.selected.has(name));
            });
            listEl.addEventListener('keydown', (e) => {
                if (e.key !== ' ' && e.key !== 'Enter') return;
                const chk = e.target.closest('.cmp-row-check');
                if (!chk || chk.classList.contains('is-disabled')) return;
                e.preventDefault();
                const row = chk.closest('.cmp-item');
                const name = row ? row.dataset.name : null;
                if (!name) return;
                toggleRow(name, !STATE.selected.has(name));
            });
        }

        // Pagination click delegation
        const paginationEl = document.getElementById('cmpPagination');
        if (paginationEl) {
            paginationEl.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-page]');
                if (!btn || btn.disabled) return;
                const target = btn.dataset.page;
                const cur = STATE.page;
                let next = cur;
                if (target === 'first') next = 1;
                else if (target === 'last') next = pageCount(computeFiltered(STATE.items, STATE.filter, STATE.exclude).length, STATE.pageSize);
                else next = Number(target);
                if (!Number.isFinite(next) || next < 1) return;
                if (next !== cur) {
                    STATE.page = next;
                    renderList();
                    const listEl = document.getElementById('cmpList');
                    if (listEl) listEl.scrollTop = 0;
                }
            });
        }

        loadStatusAndList();
    }

    // ---------- Generic confirm modal (shared with host) ----------
    // Promise-based replacement for window.confirm. Resolves true (OK) or false (Cancel/ESC/backdrop).
    //   { title, message, confirmText, cancelText, danger, icon, okLabel }
    // `danger: true` → red confirm button. `icon` is a Lucide icon name (default 'alert-triangle').
    function confirmAction(opts = {}) {
        return new Promise((resolve) => {
            const cfg = {
                title: opts.title || '确认操作',
                message: opts.message || '',
                confirmText: opts.confirmText || '确认',
                cancelText: opts.cancelText || '取消',
                danger: !!opts.danger,
                icon: opts.icon || 'alert-triangle',
            };
            const prevFocus = document.activeElement;

            // Build DOM
            const root = document.createElement('div');
            root.className = 'comfyui-mcp-root';
            const wrap = document.createElement('div');
            wrap.className = 'cmp-confirm';
            wrap.setAttribute('role', 'dialog');
            wrap.setAttribute('aria-modal', 'true');
            wrap.setAttribute('aria-labelledby', 'cmpConfirmTitle');
            const panel = document.createElement('div');
            panel.className = 'cmp-confirm-panel';
            panel.setAttribute('role', 'document');
            const backdrop = document.createElement('div');
            backdrop.className = 'cmp-confirm-backdrop';
            const body = document.createElement('div');
            body.className = 'cmp-confirm-body';
            const icon = document.createElement('div');
            icon.className = 'cmp-confirm-icon' + (cfg.danger ? '' : ' is-neutral');
            const iconI = document.createElement('i');
            iconI.setAttribute('data-lucide', cfg.icon);
            iconI.className = 'w-4 h-4';
            icon.appendChild(iconI);
            const title = document.createElement('div');
            title.id = 'cmpConfirmTitle';
            title.className = 'cmp-confirm-title';
            title.textContent = cfg.title;
            const msg = document.createElement('div');
            msg.className = 'cmp-confirm-msg';
            // message is HTML (host can pass `<b>...</b>` for emphasis)
            msg.innerHTML = cfg.message;
            body.append(icon, title, msg);

            const footer = document.createElement('div');
            footer.className = 'cmp-confirm-footer';
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'cmp-confirm-btn';
            cancelBtn.dataset.confirmAct = 'cancel';
            cancelBtn.textContent = cfg.cancelText;
            const okBtn = document.createElement('button');
            okBtn.type = 'button';
            okBtn.className = 'cmp-confirm-btn ' + (cfg.danger ? 'is-danger' : 'is-primary');
            okBtn.dataset.confirmAct = 'ok';
            okBtn.textContent = cfg.confirmText;
            footer.append(cancelBtn, okBtn);

            panel.append(body, footer);
            wrap.append(backdrop, panel);
            root.appendChild(wrap);
            document.body.appendChild(root);
            document.body.classList.add('cmp-confirm-open');
            if (window.lucide) window.lucide.createIcons();

            // open on next frame so transition runs
            requestAnimationFrame(() => wrap.classList.add('is-open'));

            let closing = false;
            const onKey = (e) => {
                if (e.key === 'Escape') { e.preventDefault(); finish(false); return; }
                if (e.key === 'Enter' && document.activeElement === okBtn) {
                    e.preventDefault(); finish(true);
                }
            };
            document.addEventListener('keydown', onKey);

            const finish = (val) => {
                if (closing) return;
                closing = true;
                document.removeEventListener('keydown', onKey);
                wrap.classList.remove('is-open');
                setTimeout(() => {
                    root.remove();
                    document.body.classList.remove('cmp-confirm-open');
                    if (prevFocus && typeof prevFocus.focus === 'function') {
                        try { prevFocus.focus(); } catch (_) {}
                    }
                    resolve(val);
                }, 180);
            };

            wrap.addEventListener('click', (e) => {
                const act = e.target.closest('[data-confirm-act]');
                if (!act) {
                    // click on backdrop area outside panel → cancel
                    if (e.target === backdrop) finish(false);
                    return;
                }
                finish(act.dataset.confirmAct === 'ok');
            });

            // Focus the OK button (Enter activates it via keydown handler).
            setTimeout(() => { okBtn.focus(); }, 30);
        });
    }

    // ---------- Public API (used by inline onclick handlers and host code) ----------
    window.ComfyuiMcpPlugin = {
        openModal,
        closeModal,
        refresh: () => loadStatusAndList(),
        // Replaces window.confirm — Promise-based, non-blocking custom modal.
        confirm: confirmAction,
        // Internal helpers used by the inline onclick handlers we generate.
        _toggleRow: toggleRow,
        _importOne: importOne,
    };

    // ---------- Auto-mount ----------
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount, { once: true });
    } else {
        mount();
    }
})();
