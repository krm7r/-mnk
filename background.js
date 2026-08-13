// ============================================================
// Ultimate Web Scraper Pro v6.7 — Background Service Worker
// تحسينات هذا الإصدار (بدون حذف أي ميزة سابقة):
//  - حفظ حالة الجلسة في chrome.storage.local بشكل دوري (تنجو من إغلاق الـ Service Worker)
//  - استعادة البيانات المجمّعة تلقائياً عند إعادة تشغيل الإضافة
//  - إعادة محاولة تلقائية للصفحات الفاشلة (بدل تجاهلها فوراً)
//  - تحميل حقيقي لملفات CSS/JS (الأصول) لبناء نسخة تعمل أوفلاين
//  - ربط الروابط الداخلية محلياً (بعد اكتمال السحب) لتصفح الملفات بدون إنترنت
//  - جمع "تلميحات هيكلية" (هيدر/فوتر/نav) من كل صفحة لدعم مستخرج القالب في اللوحة
// ============================================================

const STORAGE_KEY = 'scraper_job_snapshot';
const SAVE_THROTTLE_MS = 3000;

const DEFAULT_SETTINGS = {
  waitDelay: 5,
  maxPages: 1000,
  delayBetweenRequests: 500,
  retryCount: 2,
  retryDelay: 1200,
  downloadAssets: true,
  filters: { pages: true, images: true, videos: false, files: true, xml: false, text: true }
};

// حالة الجلسة الحالية
let job = {
  type: null,
  isRunning: false,
  tabId: null,
  domain: null,
  settings: { ...DEFAULT_SETTINGS },
  scope: { include: [], exclude: [] },

  allUrls: new Set(),
  visitedUrls: new Set(),
  queue: [],

  data: {
    pages: [],
    images: new Set(),
    videos: new Set(),
    files: new Set(),
    xml: new Set(),
    directDownloads: new Set(),
    assets: { css: new Set(), js: new Set() }
  },
  urlToFileName: {},
  assetUrlToFileName: {},
  assetFiles: {}, // fileName -> محتوى نصي (بعد التحميل الفعلي)
  structureSamples: [], // عينات هيدر/فوتر/nav من الصفحات لمستخرج القالب
  manualPages: [],
  isBloggerDetected: false,

  stats: {
    currentUrl: 'جاهز...',
    pagesScraped: 0,
    mediaFound: 0,
    linksFound: 0,
    progress: 0,
    phase: 'idle'
  }
};

let lastSaveTs = 0;

// ============================================================
// استعادة الحالة عند بدء تشغيل الـ Service Worker
// ============================================================
const restoreReady = restoreFromStorage();

async function restoreFromStorage() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const snap = stored[STORAGE_KEY];
    if (!snap) return;

    job.type = snap.type;
    job.tabId = snap.tabId;
    job.domain = snap.domain;
    job.settings = { ...DEFAULT_SETTINGS, ...(snap.settings || {}) };
    job.scope = snap.scope || { include: [], exclude: [] };
    job.allUrls = new Set(snap.allUrls || []);
    job.visitedUrls = new Set(snap.visitedUrls || []);
    job.queue = snap.queue || [];
    job.data = {
      pages: snap.data?.pages || [],
      images: new Set(snap.data?.images || []),
      videos: new Set(snap.data?.videos || []),
      files: new Set(snap.data?.files || []),
      xml: new Set(snap.data?.xml || []),
      directDownloads: new Set(snap.data?.directDownloads || []),
      assets: {
        css: new Set(snap.data?.assets?.css || []),
        js: new Set(snap.data?.assets?.js || [])
      }
    };
    job.urlToFileName = snap.urlToFileName || {};
    job.assetUrlToFileName = snap.assetUrlToFileName || {};
    job.assetFiles = snap.assetFiles || {};
    job.structureSamples = snap.structureSamples || [];
    job.manualPages = snap.manualPages || [];
    job.isBloggerDetected = !!snap.isBloggerDetected;

    // أي جلسة كانت "شغالة" وقت إغلاق الـ worker تعتبر متوقفة، لكن بياناتها محفوظة
    const wasRunning = !!snap.isRunning;
    job.isRunning = false;
    job.stats = snap.stats || job.stats;
    if (wasRunning) {
      job.stats.phase = 'interrupted';
      job.stats.currentUrl = `⚠️ توقفت الإضافة مؤقتاً وتم استرجاع ${job.data.pages.length} صفحة محفوظة. اضغط بدء للمتابعة أو حمّل ما هو موجود.`;
    }
  } catch (e) {
    console.warn('restoreFromStorage failed:', e);
  }
}

function persistState(force = false) {
  const now = Date.now();
  if (!force && now - lastSaveTs < SAVE_THROTTLE_MS) return;
  lastSaveTs = now;

  const snap = {
    type: job.type,
    isRunning: job.isRunning,
    tabId: job.tabId,
    domain: job.domain,
    settings: job.settings,
    scope: job.scope,
    allUrls: Array.from(job.allUrls),
    visitedUrls: Array.from(job.visitedUrls),
    queue: job.queue,
    data: {
      pages: job.data.pages,
      images: Array.from(job.data.images),
      videos: Array.from(job.data.videos),
      files: Array.from(job.data.files),
      xml: Array.from(job.data.xml),
      directDownloads: Array.from(job.data.directDownloads),
      assets: { css: Array.from(job.data.assets.css), js: Array.from(job.data.assets.js) }
    },
    urlToFileName: job.urlToFileName,
    assetUrlToFileName: job.assetUrlToFileName,
    assetFiles: job.assetFiles,
    structureSamples: job.structureSamples,
    manualPages: job.manualPages,
    isBloggerDetected: job.isBloggerDetected,
    stats: job.stats
  };

  chrome.storage.local.set({ [STORAGE_KEY]: snap }).catch(() => {});
}

// ============================================================
// Message Router
// ============================================================
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  switch (req.action) {
    case 'start_job':
      restoreReady.then(() => startJob(req)).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, err: e.message }));
      return true;

    // متوافق مع popup.js القديم/الجديد
    case 'start_scraping':
      startJob({
        type: req.crawlType === 'full' ? 'site' : 'single',
        tabId: req.tabId,
        settings: { ...DEFAULT_SETTINGS, filters: req.filters, waitDelay: req.waitDelay || DEFAULT_SETTINGS.waitDelay }
      }).then(() => sendResponse({ status: 'started' })).catch(e => sendResponse({ status: 'error', err: e.message }));
      return true;

    case 'stop_job':
      job.isRunning = false;
      job.stats.phase = 'idle';
      job.stats.currentUrl = '⏹️ تم الإيقاف';
      persistState(true);
      broadcast();
      sendResponse({ ok: true });
      break;

    case 'manual_collect':
      manualCollect(req.tabId).then(r => sendResponse(r)).catch(() => sendResponse(null));
      return true;

    case 'finalize_assets':
      finalizePackaging().then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, err: e.message }));
      return true;

    case 'get_status':
      restoreReady.then(() => sendResponse(getStatus()));
      return true;
      break;

    case 'get_data':
      restoreReady.then(() => sendResponse(getExportData()));
      return true;
      break;

    case 'clear_job':
      clearJob(req.jobType);
      sendResponse({ ok: true });
      break;
  }
});

// ============================================================
// Main Job Starter
// ============================================================
async function startJob(req) {
  const { type, tabId, settings, customUrls, scope } = req;

  resetJobState(type, settings, scope);
  job.tabId = tabId;
  job.isRunning = true;

  const tab = await chrome.tabs.get(tabId);
  job.domain = new URL(tab.url).hostname;

  try {
    if (type === 'single') {
      await runSinglePage(tab.url);
    }
    else if (type === 'media') {
      await runMediaOnly(tab.url);
    }
    else if (type === 'extract') {
      await runExtractLinks(tab.url);
    }
    else if (type === 'site') {
      await runFullSite(tab.url);
    }
    else if (type === 'custom') {
      job.queue = (customUrls || []).filter(u => u.startsWith('http'));
      await runContinuousQueue();
    }

    // بعد أي وظيفة تجمع صفحات: نزّل الأصول واربط الروابط محلياً لنسخة تعمل أوفلاين
    if (job.isRunning !== false || job.data.pages.length > 0) {
      if (job.settings.downloadAssets && job.data.pages.length > 0) {
        await finalizePackaging();
      }
    }
  } catch (err) {
    job.stats.phase = 'error';
    job.stats.currentUrl = `❌ خطأ: ${err.message}`;
  }

  job.isRunning = false;
  persistState(true);
  broadcast();
}

// ============================================================
// Job Types
// ============================================================

async function runSinglePage(url) {
  job.stats.phase = 'scraping';
  job.stats.currentUrl = `⏳ جاري سحب: ${url.substring(0, 60)}`;
  broadcast();
  await scrapePageWithRetry(url);
  job.stats.phase = 'done';
  job.stats.currentUrl = `✅ تم سحب الصفحة بنجاح!`;
  job.stats.progress = 100;
  broadcast();
}

async function runMediaOnly(url) {
  job.stats.phase = 'scraping';
  job.stats.currentUrl = `⏳ جاري استخراج الوسائط...`;
  broadcast();
  await chrome.tabs.update(job.tabId, { url });
  await waitTabComplete(job.tabId);
  const res = await runContentScript(job.tabId);
  if (res && !res.error) {
    updateMediaData(res);
    job.stats.mediaFound = countMedia();
  }
  job.stats.phase = 'done';
  job.stats.currentUrl = `✅ تم! وجد ${job.stats.mediaFound} عنصر وسائط`;
  job.stats.progress = 100;
  broadcast();
}

async function runExtractLinks(startUrl) {
  job.stats.phase = 'extracting';
  job.stats.currentUrl = '🔍 جاري محاولة جلب الروابط من Sitemap...';
  broadcast();

  const sitemapUrls = await tryFetchSitemap(startUrl);
  if (sitemapUrls.length > 0) {
    sitemapUrls.forEach(u => {
      if (isUrlInScope(u)) job.allUrls.add(u);
    });
    job.stats.currentUrl = `⚡ تم جلب ${job.allUrls.size} رابط من Sitemap!`;
  } else {
    job.stats.currentUrl = '🔍 لم يتم العثور على Sitemap، جاري الزحف اليدوي...';
    broadcast();
    await crawlLinks(startUrl);
  }

  job.stats.linksFound = job.allUrls.size;
  job.stats.phase = 'done';
  job.stats.progress = 100;
  job.stats.currentUrl = `✅ تم استخراج ${job.stats.linksFound} رابط`;
  broadcast();
}

async function runFullSite(startUrl) {
  job.stats.phase = 'extracting';
  job.stats.currentUrl = '🔍 جاري جلب روابط الموقع...';
  broadcast();

  const sitemapUrls = await tryFetchSitemap(startUrl);
  if (sitemapUrls.length > 0) {
    sitemapUrls.forEach(u => {
      if (isUrlInScope(u)) job.allUrls.add(u);
    });
  } else {
    await crawlLinks(startUrl);
  }

  job.queue = Array.from(job.allUrls).slice(0, job.settings.maxPages);
  job.stats.linksFound = job.queue.length;
  job.stats.phase = 'scraping';
  broadcast();

  await runContinuousQueue();
}

async function runContinuousQueue() {
  let done = 0;
  const total = job.queue.length;

  for (const url of job.queue) {
    if (!job.isRunning) break;
    if (job.visitedUrls.has(url)) { done++; continue; }

    job.stats.currentUrl = `⏳ (${done + 1}/${total}) ${url.substring(0, 55)}...`;
    job.stats.progress = Math.round(((done + 1) / total) * 100);
    broadcast();
    persistState();

    await scrapePageWithRetry(url);
    job.visitedUrls.add(url);
    done++;
    await delay(job.settings.delayBetweenRequests);
  }

  job.stats.phase = 'done';
  job.stats.currentUrl = `✅ اكتمل! تم سحب ${job.stats.pagesScraped} صفحة`;
  job.stats.progress = 100;
  broadcast();
}

// ============================================================
// Core Scraping & Crawling (مع إعادة محاولة)
// ============================================================
async function scrapePageWithRetry(url) {
  const attempts = Math.max(1, (job.settings.retryCount || 0) + 1);
  for (let i = 0; i < attempts; i++) {
    const ok = await scrapePage(url);
    if (ok) return true;
    if (i < attempts - 1) {
      job.stats.currentUrl = `🔁 إعادة محاولة (${i + 2}/${attempts}): ${url.substring(0, 50)}...`;
      broadcast();
      await delay(job.settings.retryDelay || 1000);
    }
  }
  return false;
}

async function scrapePage(url) {
  try {
    await chrome.tabs.update(job.tabId, { url });
    await waitTabComplete(job.tabId);
    const res = await runContentScript(job.tabId);

    if (res && !res.error) {
      const fileName = makeFileName(url, res.isXml);
      job.urlToFileName[url] = fileName;

      if (job.settings.filters.pages) {
        job.data.pages.push({
          url: res.url, html: res.html, fileName, isXml: res.isXml,
          text: job.settings.filters.text ? (res.text || '') : undefined
        });
      }
      updateMediaData(res);
      collectAssets(res);
      collectStructureHints(res);

      job.stats.pagesScraped = job.data.pages.length;
      job.stats.mediaFound = countMedia();
      return true;
    }
    return false;
  } catch (err) {
    console.warn('scrapePage error:', url, err.message);
    return false;
  }
}

async function crawlLinks(startUrl) {
  const toVisit = [startUrl];
  const visited = new Set();
  let count = 0;
  const max = job.settings.maxPages;

  while (toVisit.length > 0 && count < max && job.isRunning) {
    const url = toVisit.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    count++;

    job.stats.currentUrl = `🔍 فحص الروابط: (${count}/${max}) ${url.substring(0, 50)}...`;
    job.stats.progress = Math.round((count / max) * 100);
    job.stats.linksFound = job.allUrls.size;
    broadcast();
    persistState();

    try {
      await chrome.tabs.update(job.tabId, { url });
      await waitTabComplete(job.tabId);
      const res = await runContentScript(job.tabId);

      if (res && res.links) {
        res.links.forEach(link => {
          try {
            const u = new URL(link);
            if (u.hostname === job.domain && !job.allUrls.has(link) && isUrlInScope(link)) {
              job.allUrls.add(link);
              if (toVisit.length < 1000) toVisit.push(link);
            }
          } catch (_) {}
        });
      }
      if (res && res.structure && res.structure.isBlogger) job.isBloggerDetected = true;
    } catch (e) {}
    await delay(200);
  }
  if (!job.allUrls.has(startUrl)) job.allUrls.add(startUrl);
}

// ============================================================
// Sitemap Logic (يدعم أيضاً sitemap index المتداخل)
// ============================================================
async function tryFetchSitemap(baseUrl) {
  const urls = new Set();
  try {
    const urlObj = new URL(baseUrl);
    const rootSitemap = `${urlObj.origin}/sitemap.xml`;
    const collected = await fetchSitemapRecursive(rootSitemap, 0);
    collected.forEach(u => urls.add(u));
  } catch (e) { console.warn('Sitemap fetch failed:', e); }
  return Array.from(urls);
}

async function fetchSitemapRecursive(sitemapUrl, depth) {
  const found = new Set();
  if (depth > 3) return Array.from(found); // حماية من الحلقات اللانهائية
  try {
    const response = await fetch(sitemapUrl);
    if (!response.ok) return Array.from(found);
    const text = await response.text();

    // sitemap index (يحتوي روابط لخرائط فرعية)
    const sitemapRefs = text.match(/<sitemap>[\s\S]*?<\/sitemap>/g);
    if (sitemapRefs && sitemapRefs.length > 0) {
      for (const block of sitemapRefs) {
        const locMatch = block.match(/<loc>(.*?)<\/loc>/);
        if (locMatch) {
          const subUrls = await fetchSitemapRecursive(locMatch[1].trim(), depth + 1);
          subUrls.forEach(u => found.add(u));
        }
      }
      return Array.from(found);
    }

    // urlset عادي
    const matches = text.match(/<loc>(.*?)<\/loc>/g);
    if (matches) {
      matches.forEach(m => {
        const u = m.replace(/<\/?loc>/g, '').trim();
        if (u.startsWith('http')) found.add(u);
      });
    }
  } catch (e) { /* تجاهل خرائط فرعية فاشلة */ }
  return Array.from(found);
}

// ============================================================
// Manual Collection
// ============================================================
async function manualCollect(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url) return null;

    const res = await new Promise(resolve => {
      chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, () => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        chrome.tabs.sendMessage(tabId, { action: 'scrape_advanced' }, res => {
          resolve(res || null);
        });
      });
    });

    if (!res || res.error) {
      console.error('Failed to scrape page:', res?.error);
      return { success: false, error: 'فشل في جلب الصفحة' };
    }

    const fileName = makeFileName(tab.url, res.isXml);
    job.manualPages.push({
      url: res.url || tab.url,
      html: res.html || '',
      fileName: fileName,
      isXml: res.isXml || false,
      text: res.text || '',
      timestamp: new Date().toISOString()
    });

    job.urlToFileName[tab.url] = fileName;
    collectAssets(res);
    collectStructureHints(res);
    persistState(true);
    broadcast();

    return { success: true, count: job.manualPages.length };
  } catch (err) {
    console.error('manualCollect error:', err);
    return { success: false, error: err.message };
  }
}

// ============================================================
// الأصول (CSS/JS) — تحميل حقيقي + ربط محلي للروابط
// ============================================================
function collectAssets(res) {
  if (!res.assets) return;
  (res.assets.css || []).forEach(u => job.data.assets.css.add(u));
  (res.assets.js || []).forEach(u => job.data.assets.js.add(u));
}

function collectStructureHints(res) {
  if (!res.structure) return;
  if (res.structure.isBlogger) job.isBloggerDetected = true;
  if (job.structureSamples.length < 40) { // حد أقصى لتفادي استهلاك ذاكرة كبير
    job.structureSamples.push({
      url: res.url,
      header: res.structure.header,
      footer: res.structure.footer,
      nav: res.structure.nav
    });
  }
}

async function finalizePackaging() {
  job.stats.phase = 'packaging';
  job.stats.currentUrl = '📦 جاري تحميل ملفات CSS/JS لبناء نسخة تعمل أوفلاين...';
  broadcast();

  const allAssetUrls = [...job.data.assets.css, ...job.data.assets.js];
  let done = 0;
  for (const url of allAssetUrls) {
    if (job.assetFiles[job.assetUrlToFileName[url]] !== undefined) { done++; continue; }
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const text = await resp.text();
        const fname = makeAssetFileName(url);
        job.assetUrlToFileName[url] = fname;
        job.assetFiles[fname] = text;
      }
    } catch (e) { /* أصل فشل تحميله يُتجاهل بأمان */ }
    done++;
    job.stats.currentUrl = `📦 تحميل الأصول: (${done}/${allAssetUrls.length})`;
    job.stats.progress = allAssetUrls.length ? Math.round((done / allAssetUrls.length) * 100) : 100;
    if (done % 5 === 0) broadcast();
  }

  // ربط الروابط الداخلية (صفحات + أصول) محلياً داخل كل صفحة مسحوبة
  job.stats.currentUrl = '🔗 جاري ربط الروابط محلياً...';
  broadcast();
  job.data.pages.forEach(page => {
    page.htmlOffline = rewriteHtmlForOffline(page.html);
  });
  job.manualPages.forEach(page => {
    page.htmlOffline = rewriteHtmlForOffline(page.html);
  });

  persistState(true);
}

function rewriteHtmlForOffline(html) {
  if (!html) return html;
  let out = html;
  // روابط صفحات أخرى تم سحبها -> اسم ملف محلي
  for (const [origUrl, fileName] of Object.entries(job.urlToFileName)) {
    if (!origUrl) continue;
    out = out.split(origUrl).join(fileName);
  }
  // أصول CSS/JS -> assets/filename
  for (const [origUrl, fileName] of Object.entries(job.assetUrlToFileName)) {
    if (!origUrl) continue;
    out = out.split(origUrl).join('assets/' + fileName);
  }
  return out;
}

function makeAssetFileName(url) {
  try {
    const u = new URL(url);
    let name = (u.pathname.split('/').pop() || 'file').split('?')[0];
    const isCss = /\.css/i.test(url) || name.toLowerCase().endsWith('.css');
    const ext = isCss ? '.css' : '.js';
    if (!name.toLowerCase().endsWith(ext)) name = name.replace(/\.[a-z0-9]+$/i, '') + ext;
    if (!name || name === ext) name = 'file' + ext;

    const base = name.slice(0, -ext.length);
    let unique = name;
    let i = 1;
    const used = new Set(Object.values(job.assetUrlToFileName));
    while (used.has(unique)) {
      unique = `${base}_${i++}${ext}`;
    }
    return unique;
  } catch (e) {
    return 'asset_' + Date.now() + (url.includes('.css') ? '.css' : '.js');
  }
}

// ============================================================
// Helpers
// ============================================================
function isUrlInScope(url) {
  const u = url.toLowerCase();
  if (job.scope.exclude.length > 0) {
    if (job.scope.exclude.some(ex => u.includes(ex.toLowerCase().trim()))) return false;
  }
  if (job.scope.include.length > 0) {
    return job.scope.include.some(inc => u.includes(inc.toLowerCase().trim()));
  }
  return true;
}

function updateMediaData(res) {
  if (job.settings.filters.images) (res.media.images || []).forEach(u => job.data.images.add(u));
  if (job.settings.filters.videos) (res.media.videos || []).forEach(u => job.data.videos.add(u));
  if (job.settings.filters.files) (res.media.files || []).forEach(u => job.data.files.add(u));
  if (job.settings.filters.xml) (res.media.xml || []).forEach(u => job.data.xml.add(u));
  (res.directDownloads || []).forEach(u => job.data.directDownloads.add(u));
}

function getStatus() {
  return {
    type: job.type,
    isRunning: job.isRunning,
    stats: { ...job.stats },
    pagesCount: job.data.pages.length,
    mediaCount: countMedia()
  };
}

function getExportData() {
  return {
    type: job.type,
    pages: job.data.pages,
    images: Array.from(job.data.images),
    videos: Array.from(job.data.videos),
    files: Array.from(job.data.files),
    xml: Array.from(job.data.xml),
    directDownloads: Array.from(job.data.directDownloads),
    urlToFileName: job.urlToFileName,
    manualPages: job.manualPages,
    allUrls: Array.from(job.allUrls),
    assetFiles: job.assetFiles,
    assetUrls: { css: Array.from(job.data.assets.css), js: Array.from(job.data.assets.js) },
    structureSamples: job.structureSamples,
    isBloggerDetected: job.isBloggerDetected
  };
}

function resetJobState(type, settings, scope) {
  job.type = type;
  job.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  job.scope = {
    include: scope?.include ? scope.include.split(',').filter(x => x.trim()) : [],
    exclude: scope?.exclude ? scope.exclude.split(',').filter(x => x.trim()) : []
  };
  job.allUrls = new Set();
  job.visitedUrls = new Set();
  job.queue = [];
  job.data = {
    pages: [], images: new Set(), videos: new Set(), files: new Set(), xml: new Set(),
    directDownloads: new Set(), assets: { css: new Set(), js: new Set() }
  };
  job.urlToFileName = {};
  job.assetUrlToFileName = {};
  job.assetFiles = {};
  job.structureSamples = [];
  job.isBloggerDetected = false;
  job.stats = { currentUrl: '⏳ جاري البدء...', pagesScraped: 0, mediaFound: 0, linksFound: 0, progress: 0, phase: 'starting' };
}

function clearJob(jobType) {
  if (jobType === 'manual') {
    job.manualPages = [];
  } else {
    job.data = {
      pages: [], images: new Set(), videos: new Set(), files: new Set(), xml: new Set(),
      directDownloads: new Set(), assets: { css: new Set(), js: new Set() }
    };
    job.urlToFileName = {};
    job.assetUrlToFileName = {};
    job.assetFiles = {};
    job.structureSamples = [];
    job.isBloggerDetected = false;
    job.allUrls = new Set();
    job.visitedUrls = new Set();
    job.queue = [];
    job.stats = { currentUrl: 'جاهز...', pagesScraped: 0, mediaFound: 0, linksFound: 0, progress: 0, phase: 'idle' };
  }
  persistState(true);
  broadcast();
}

function countMedia() {
  return job.data.images.size + job.data.videos.size + job.data.files.size + job.data.xml.size + job.data.directDownloads.size;
}

function makeFileName(url, isXml) {
  const u = new URL(url);
  let name = u.pathname === '/' ? 'index' : u.pathname.replace(/\//g, '_').replace(/^_/, '');
  if (!name) name = 'index';
  const ext = isXml ? '.xml' : '.html';
  if (!name.toLowerCase().endsWith(ext)) name += ext;
  let unique = name;
  let i = 1;
  while (Object.values(job.urlToFileName).includes(unique)) {
    unique = name.replace(ext, '') + `_${i++}` + ext;
  }
  return unique;
}

async function runContentScript(tabId) {
  // content.js is already registered in manifest.json. Avoid injecting it on every
  // page because duplicate listeners can cause duplicate work and unstable responses.
  const send = () => new Promise(resolve => {
    try {
      chrome.tabs.sendMessage(tabId, { action: 'scrape_advanced' }, res => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(res || null);
      });
    } catch (_) { resolve(null); }
  });

  let result = await send();
  if (result) return result;

  // Fallback for pages where the manifest content script could not run.
  return new Promise(resolve => {
    chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, () => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      send().then(resolve);
    });
  });
}

async function waitTabComplete(tabId) {
  const ms = (job.settings.waitDelay || 5) * 1000;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') {
      await delay(ms);
      return;
    }
  } catch (_) {}

  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timeout);
      setTimeout(resolve, ms);
    };
    const timeout = setTimeout(finish, ms + 10000);
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function broadcast() {
  chrome.runtime.sendMessage({ action: 'job_update', status: getStatus() }).catch(() => {});
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// فتح لوحة التحكم الجانبية تلقائياً عند توفر الحالة (يعمل مع الـ popup الحالي أيضاً)
// ============================================================
chrome.action.onClicked.addListener(async (tab) => {
  // يُستخدم فقط كخط دفاع احتياطي في حال عدم عمل default_popup لأي سبب
  try {
    if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id });
  } catch (e) { /* متجاهل: الـ popup هو السلوك الافتراضي */ }
});
