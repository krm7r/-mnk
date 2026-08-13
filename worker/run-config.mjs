// ============================================================
// لا تعدّل هذا الملف عادةً.
// هذا الملف يأخذ الإعدادات من crawler-config.mjs ويشغل الـWorker.
// ============================================================
import { CONFIG } from '../crawler-config.mjs';

process.env.SITES_JSON = JSON.stringify(CONFIG.sites.slice(0, CONFIG.maxSites));
process.env.MAX_SITES = String(Math.min(10, Math.max(1, CONFIG.maxSites)));
process.env.MAX_PAGES = String(Math.min(5000, Math.max(1, CONFIG.maxPagesPerSite)));
process.env.CONCURRENCY = String(Math.min(10, Math.max(1, CONFIG.concurrency)));
process.env.WAIT_MS = String(Math.max(0, CONFIG.waitMs));
process.env.DOWNLOAD_ASSETS = String(CONFIG.downloadAssets);

// متغيرات Google Drive متاحة للمرحلة التالية.
if (CONFIG.drive?.enabled) {
  process.env.DRIVE_UPLOAD_URL = CONFIG.drive.uploadUrl || process.env.DRIVE_UPLOAD_URL || '';
}

await import('./index.mjs');
