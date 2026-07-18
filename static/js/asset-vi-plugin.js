(function () {
    'use strict';
    const settings = window.STORAGE_SETTINGS || {};
    const vi = (settings.video_index || {});
    if (!vi.enabled) return; // silent no-op when disabled

    const NS = window.__VI_PLUGIN__ = {
        version: '0.1.0',
        PLUGIN_TAG: 'vi',
        VI_LIBRARY_TYPE: 'remote_video_index',

        isViItem(item) {
            return !!(item && (item.source === 'remote_video_index'
                || (typeof item.url === 'string' && item.url.startsWith('video-index://'))));
        },

        isViLibrary(lib) {
            return !!(lib && lib.type === 'remote_video_index');
        },

        thumbnailUrlForAsset(assetId, width) {
            const target = 'video-index://' + assetId;
            return '/api/media-preview?w=' + (width || 320)
                + '&url=' + encodeURIComponent(target);
        },

        // Card used in the asset-manager image-assets grid.
        renderCard(item) {
            const remote = item.remote || {};
            const assetId = remote.asset_id || (item.url || '').replace(/^video-index:\/\//, '');
            const sourceName = remote.source_name || 'Video Index';
            const thumb = this.thumbnailUrlForAsset(assetId, 320);
            const safeName = escapeHtml(item.name || assetId);
            return (
                '<div class="vi-asset-card" data-vi-asset-id="' + assetId + '">'
                + '<img loading="lazy" src="' + thumb + '" alt="' + safeName + '">'
                + '<span class="vi-badge" title="来自 ' + escapeAttr(sourceName) + '">📡</span>'
                + '<div class="vi-asset-name">' + safeName + '</div>'
                + '</div>'
            );
        },

        // Card used in the canvas image picker (slightly different markup).
        renderPickerCard(asset) {
            const id = asset.asset_id || asset.id;
            const thumb = this.thumbnailUrlForAsset(id, 320);
            const name = escapeHtml(asset.filename || asset.name || id);
            return (
                '<div class="image-picker-card vi" data-vi-asset-id="' + id + '">'
                + '<img loading="lazy" src="' + thumb + '" alt="' + name + '">'
                + '<span class="vi-badge">📡</span>'
                + '<div class="image-picker-card-name">' + name + '</div>'
                + '</div>'
            );
        },
    };

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[ch]);
    }
    function escapeAttr(s) { return escapeHtml(s); }
})();
