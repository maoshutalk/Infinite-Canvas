(function () {
    'use strict';
    const VI = (window.STORAGE_SETTINGS || {}).video_index || {};

    const state = window.imagePickerState = {
        open: false,
        nodeId: '',
        scope: 'local',        // 'local' | 'vi:<source_id>'
        activeCategory: 'all', // 'all' | a VI category id | a local category name
        query: '',
        items: [],
        loading: false,
    };

    const modal = window.document.getElementById('imageAssetPickerModal');
    const closeBtn = window.document.getElementById('imageAssetPickerClose');
    if (closeBtn) closeBtn.addEventListener('click', () => window.closeImageAssetPicker());

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[ch]);
    }

    async function loadItems() {
        state.loading = true;
        try {
            if (state.scope === 'local') {
                const r = await fetch('/api/asset-library/items?limit=200', { credentials: 'same-origin' });
                const data = await r.json();
                state.items = (data.items || []);
            } else if (state.scope.startsWith('vi:')) {
                const sourceId = state.scope.slice(3);
                const params = new URLSearchParams();
                if (state.activeCategory && state.activeCategory !== 'all') {
                    params.set('type', viCatToVIMediaType(state.activeCategory));
                }
                params.set('source_id', sourceId);
                const r = await fetch('/api/vi/library?' + params.toString());
                const data = await r.json();
                const items = data.results || data.items || [];
                state.items = items.map(it => ({
                    id: 'vi_' + (it.asset_id || it.id),
                    url: 'video-index://' + (it.asset_id || it.id),
                    name: it.filename || it.name || '',
                    remote: { asset_id: it.asset_id || it.id, source_id: sourceId },
                }));
            }
        } catch (e) {
            state.items = [];
            console.error('picker load failed', e);
        } finally {
            state.loading = false;
            renderGrid();
        }
    }

    function viCatToVIMediaType(cat) {
        if (cat === 'video') return 'video';
        if (cat === 'image') return 'image';
        if (cat === 'music') return 'music';
        return '';
    }

    function renderGrid() {
        if (!modal) return;
        const grid = modal.querySelector('.image-picker-grid');
        if (!grid) return;
        const isVI = state.scope.startsWith('vi:');
        const vi = window.__VI_PLUGIN__;
        grid.innerHTML = state.items
            .filter(it => {
                if (!state.query) return true;
                return (it.name || '').toLowerCase().includes(state.query.toLowerCase());
            })
            .map(it => isVI && vi
                ? vi.renderPickerCard(it.remote || { asset_id: it.url.replace('video-index://', '') })
                : `<div class="image-picker-card" data-asset-item-id="${escapeHtml(it.id)}">
                       <img loading="lazy" src="${escapeHtml(it.url)}" alt="${escapeHtml(it.name || '')}">
                       <div class="image-picker-card-name">${escapeHtml(it.name || '')}</div>
                   </div>`)
            .join('');

        grid.onclick = (ev) => {
            const card = ev.target.closest('.image-picker-card');
            if (!card) return;
            const id = card.dataset.viAssetId || card.dataset.assetItemId;
            const item = state.items.find(it => it.id === id || it.remote?.asset_id === id);
            if (item) window.applyImagePickerToNode(item, state.nodeId);
        };
    }

    window.openImageAssetPicker = async function (nodeId) {
        state.open = true;
        state.nodeId = nodeId || '';
        state.scope = 'local';
        state.activeCategory = 'all';
        modal.classList.remove('hidden');
        await loadItems();
    };

    window.closeImageAssetPicker = function () {
        state.open = false;
        modal.classList.add('hidden');
    };

    window.applyImagePickerToNode = function (item, nodeId) {
        const targetId = nodeId || state.nodeId;
        if (!targetId) return;
        // Defer to the canvas.js' existing node mutator. We assume
        // canvas.js exposes a `setNodeUrl` or `patchNode`. If not, fall
        // back to dispatching a custom event the canvas listens to.
        const event = new CustomEvent('image-picker:apply', {
            detail: { nodeId: targetId, item, url: item.url }
        });
        window.dispatchEvent(event);
        // And try the most common global mutator:
        if (typeof window.setNodeField === 'function' && window.__CANVAS_NODES__) {
            const node = window.__CANVAS_NODES__.find(n => n.id === targetId);
            if (node) {
                node.url = item.url;
                node.name = item.name || node.name;
                window.setNodeField(node, 'url', item.url);
            }
        }
        // Fallback node registry (also used by tests): mutate in place.
        if (Array.isArray(window.__TEST_NODES__)) {
            const node = window.__TEST_NODES__.find(n => n.id === targetId);
            if (node) {
                node.url = item.url;
                node.name = item.name || node.name;
            }
        }
        window.closeImageAssetPicker();
    };
})();
