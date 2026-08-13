// ============================================================
// لا تعدل هذا الملف عادةً.
// GitHub Actions يضع روابط المواقع والإعدادات في متغيرات البيئة
// ثم هذا الملف يشغل نفس محرك الـCrawler.
// ============================================================

const sites = [];

const addSite = (url) => {
  const value = String(url || '').trim();
  if (value) sites.push({ url: value });
};

addSite(process.env.SITE_1);
addSite(process.env.SITE_2);

if (!sites.length) {
  throw new Error('ضع رابط موقع واحد على الأقل في SITE_1.');
}

process.env.SITES_JSON = JSON.stringify(sites.slice(0, 2));
process.env.MAX_SITES = '2';
process.env.MAX_PAGES = String(Math.min(5000, Math.max(1, Number(process.env.MAX_PAGES || 5000))));
process.env.CONCURRENCY = String(Math.min(10, Math.max(1, Number(process.env.CONCURRENCY || 10))));
process.env.WAIT_MS = String(Math.max(0, Number(process.env.WAIT_MS || 2500)));
process.env.DOWNLOAD_ASSETS = String(process.env.DOWNLOAD_ASSETS ?? 'true');

await import('./index.mjs');
