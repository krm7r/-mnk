// ============================================================
// Ultimate Web Scraper Pro v6.7 — Sidepanel Script
// ============================================================

let cfg = {
  waitDelay: 5,
  maxPages: 1000,
  delayBetweenRequests: 500,
  retryCount: 2,
  downloadAssets: true,
  filters: { pages: true, text: true, images: true, videos: false, files: true }
};

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  initNav();
  initSinglePage();
  initSitePage();
  initMediaPage();
  initCustomPage();
  initExtractPage();
  initManualPage();
  initXMLPage();
  initSettingsPage();
  syncStatusFromBackground();
});

function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const page = document.getElementById(btn.dataset.page);
      if (page) page.classList.add('active');
    });
  });
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get('scraper_cfg');
    if (stored.scraper_cfg) cfg = { ...cfg, ...stored.scraper_cfg };
  } catch (_) {}
}

async function saveSettings() {
  await chrome.storage.local.set({ scraper_cfg: cfg });
}

function initSettingsPage() {
  const el = id => document.getElementById(id);
  el('cfg-waitDelay').value = cfg.waitDelay;
  el('cfg-maxPages').value = cfg.maxPages;
  el('cfg-reqDelay').value = cfg.delayBetweenRequests;
  el('cfg-retryCount').value = cfg.retryCount;
  el('cfg-downloadAssets').checked = cfg.downloadAssets;
  el('cfg-defPages').checked = cfg.filters.pages;
  el('cfg-defText').checked = cfg.filters.text;
  el('cfg-defImages').checked = cfg.filters.images;
  el('cfg-defVideos').checked = cfg.filters.videos;
  el('cfg-defFiles').checked = cfg.filters.files;

  // تحميل رابط Drive المحفوظ
  if (window.DriveSync) {
    window.DriveSync.getUrl().then(url => {
      if (url) el('cfg-driveUrl').value = url;
    });
  }

  // اختبار الاتصال بـ Drive
  el('cfg-driveTestBtn').addEventListener('click', async () => {
    const url = el('cfg-driveUrl').value.trim();
    const msgEl = el('cfg-driveMsg');
    if (!url) { msgEl.style.display='block'; msgEl.style.background='#fef9e7'; msgEl.style.color='#7d6608'; msgEl.textContent='⚠️ أدخل الرابط أولاً'; return; }
    msgEl.style.display='block'; msgEl.style.background='#e8f4fd'; msgEl.style.color='#1a5276'; msgEl.textContent='⏳ جاري الاختبار...';
    const r = await window.DriveSync.test(url);
    if (r.ok) { msgEl.style.background='#d5f5e3'; msgEl.style.color='#1e8449'; msgEl.textContent='✅ الاتصال يعمل!'; }
    else       { msgEl.style.background='#fadbd8'; msgEl.style.color='#922b21'; msgEl.textContent='❌ ' + r.error; }
  });

  el('cfg-saveBtn').addEventListener('click', async () => {
    cfg.waitDelay = parseInt(el('cfg-waitDelay').value) || 5;
    cfg.maxPages = parseInt(el('cfg-maxPages').value) || 1000;
    cfg.delayBetweenRequests = parseInt(el('cfg-reqDelay').value) || 500;
    cfg.retryCount = parseInt(el('cfg-retryCount').value) || 0;
    cfg.downloadAssets = el('cfg-downloadAssets').checked;
    cfg.filters.pages = el('cfg-defPages').checked;
    cfg.filters.text = el('cfg-defText').checked;
    cfg.filters.images = el('cfg-defImages').checked;
    cfg.filters.videos = el('cfg-defVideos').checked;
    cfg.filters.files = el('cfg-defFiles').checked;
    // حفظ رابط Drive
    if (window.DriveSync) {
      await window.DriveSync.saveUrl(el('cfg-driveUrl').value.trim());
    }
    await saveSettings();
    const msg = el('cfg-msg');
    msg.textContent = '✅ تم حفظ الإعدادات!';
    msg.style.display = 'block';
    setTimeout(() => msg.style.display = 'none', 2500);
  });

  el('cfg-resetBtn').addEventListener('click', async () => {
    cfg = {
      waitDelay: 5, maxPages: 1000, delayBetweenRequests: 500, retryCount: 2, downloadAssets: true,
      filters: { pages: true, text: true, images: true, videos: false, files: true }
    };
    el('cfg-waitDelay').value = cfg.waitDelay;
    el('cfg-maxPages').value = cfg.maxPages;
    el('cfg-reqDelay').value = cfg.delayBetweenRequests;
    el('cfg-retryCount').value = cfg.retryCount;
    el('cfg-downloadAssets').checked = cfg.downloadAssets;
    el('cfg-defPages').checked = cfg.filters.pages;
    el('cfg-defText').checked = cfg.filters.text;
    el('cfg-defImages').checked = cfg.filters.images;
    el('cfg-defVideos').checked = cfg.filters.videos;
    el('cfg-defFiles').checked = cfg.filters.files;
    await saveSettings();
  });
}

// PAGE: صفحة واحدة
function initSinglePage() {
  const $ = id => document.getElementById(id);
  $('s-startBtn').addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab) return;
    setRunning('single', true);
    chrome.runtime.sendMessage({
      action: 'start_job',
      type: 'single',
      tabId: tab.id,
      settings: { ...cfg, filters: { pages: $('s-fPages').checked, text: $('s-fText').checked, images: $('s-fImages').checked, videos: $('s-fVideos').checked, files: $('s-fFiles').checked } }
    });
  });
  $('s-stopBtn').addEventListener('click', () => stopJob('single'));
  $('s-downloadBtn').addEventListener('click', async () => {
    try {
      const res = await getMessage('get_data');
      if (!res || !res.pages || res.pages.length === 0) {
        alert('⚠️ لا توجد صفحات للتحميل. جرب البدء أولاً.');
        return;
      }
      await buildAndDownloadZip(res, `Single_Page_${Date.now()}`);
    } catch (err) {
      console.error('خطأ:', err);
      alert('❌ حدث خطأ: ' + err.message);
    }
  });
  $('s-driveBtn').addEventListener('click', async () => {
    const btn = $('s-driveBtn');
    try {
      const res = await getMessage('get_data');
      if (!res || !res.pages || res.pages.length === 0) { alert('⚠️ لا توجد بيانات. جرب البدء أولاً.'); return; }
      window.DriveSync.showLoading(btn);
      const blob = await buildZipBlob(res, `Drive_${Date.now()}`);
      const domain = res.pages[0]?.url ? new URL(res.pages[0].url).hostname : 'scraper';
      const result = await window.DriveSync.uploadZip(blob, `Single_Page_${Date.now()}.zip`, domain);
      window.DriveSync.showResult(btn, result);
    } catch (err) { window.DriveSync.showError(btn, err.message); }
  });
  $('s-clearBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clear_job', jobType: 'single' });
    resetPageUI('single');
  });
}

// PAGE: الموقع كامل
function initSitePage() {
  const $ = id => document.getElementById(id);

  // إظهار/إخفاء بطاقة "أنواع الروابط" حسب حالة خيار "روابط"
  const toggleLinkTypesCard = () => {
    document.getElementById('site-linkTypesCard').classList.toggle('hidden', !$('site-fLinks').checked);
  };
  $('site-fLinks').addEventListener('change', toggleLinkTypesCard);
  toggleLinkTypesCard();

  $('site-startBtn').addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab) return;
    setRunning('site', true);

    const wantLinks = $('site-fLinks').checked;
    const wantLinkDownloads = wantLinks && $('site-linkDownloads').checked;
    const wantLinkImages = wantLinks && $('site-linkImages').checked;
    const customMax = parseInt($('site-maxPages').value, 10);

    // روابط التحميل تعتمد على فلتر "ملفات" وروابط الصور تعتمد على فلتر "صور" في الخلفية،
    // فنفعّلهم تلقائياً لو المستخدم طلب جمع هذا النوع من الروابط حتى لو ما اختارهم فوق
    chrome.runtime.sendMessage({
      action: 'start_job',
      type: 'site',
      tabId: tab.id,
      scope: { include: $('site-include').value, exclude: $('site-exclude').value },
      settings: {
        ...cfg,
        maxPages: Number.isFinite(customMax) && customMax > 0 ? customMax : cfg.maxPages,
        filters: {
          pages: $('site-fPages').checked,
          text: $('site-fText').checked,
          images: $('site-fImages').checked || wantLinkImages,
          videos: $('site-fVideos').checked,
          files: $('site-fFiles').checked || wantLinkDownloads
        }
      }
    });
  });
  $('site-stopBtn').addEventListener('click', () => stopJob('site'));
  $('site-downloadBtn').addEventListener('click', async () => {
    try {
      const res = await getMessage('get_data');
      if (!res || !res.pages || res.pages.length === 0) {
        alert('⚠️ لا توجد صفحات للتحميل. جرب البدء أولاً.');
        return;
      }
      await buildAndDownloadZip(res, `Full_Site_${Date.now()}`);
    } catch (err) {
      console.error('خطأ:', err);
      alert('❌ حدث خطأ: ' + err.message);
    }
  });
  $('site-driveBtn').addEventListener('click', async () => {
    const btn = $('site-driveBtn');
    try {
      const res = await getMessage('get_data');
      if (!res || !res.pages || res.pages.length === 0) { alert('⚠️ لا توجد بيانات. جرب البدء أولاً.'); return; }
      window.DriveSync.showLoading(btn);
      const blob = await buildZipBlob(res, `Drive_${Date.now()}`);
      const domain = res.pages[0]?.url ? new URL(res.pages[0].url).hostname : 'scraper';
      const result = await window.DriveSync.uploadZip(blob, `Full_Site_${Date.now()}.zip`, domain);
      window.DriveSync.showResult(btn, result);
    } catch (err) { window.DriveSync.showError(btn, err.message); }
  });

  // بناء نص الروابط المجمّعة حسب الأنواع المختارة (تحميل / صور / عامة)
  const buildSiteLinksText = (res) => {
    const downloads = Array.from(new Set([...(res.directDownloads || []), ...(res.files || [])]));
    let txt = `=== روابط الموقع ===\n\n`;
    let has = false;
    if ($('site-linkDownloads').checked && downloads.length) {
      txt += `--- روابط تحميل (${downloads.length}) ---\n${downloads.join('\n')}\n\n`;
      has = true;
    }
    if ($('site-linkImages').checked && (res.images || []).length) {
      txt += `--- روابط صور (${res.images.length}) ---\n${res.images.join('\n')}\n\n`;
      has = true;
    }
    if ($('site-linkGeneral').checked && (res.allUrls || []).length) {
      txt += `--- روابط عامة - كل الموقع (${res.allUrls.length}) ---\n${res.allUrls.join('\n')}\n\n`;
      has = true;
    }
    return has ? txt : null;
  };

  $('site-downloadLinksBtn').addEventListener('click', async () => {
    try {
      const res = await getMessage('get_data');
      if (!res) { alert('⚠️ لا توجد روابط. جرب البدء أولاً.'); return; }
      const txt = buildSiteLinksText(res);
      if (!txt) { alert('⚠️ لم يتم العثور على روابط من الأنواع المختارة'); return; }
      downloadText(txt, `Site_Links_${Date.now()}.txt`);
    } catch (err) {
      console.error('خطأ:', err);
      alert('❌ حدث خطأ: ' + err.message);
    }
  });
  $('site-driveLinksBtn').addEventListener('click', async () => {
    const btn = $('site-driveLinksBtn');
    try {
      const res = await getMessage('get_data');
      if (!res) { alert('⚠️ لا توجد روابط. جرب البدء أولاً.'); return; }
      const txt = buildSiteLinksText(res);
      if (!txt) { alert('⚠️ لم يتم العثور على روابط من الأنواع المختارة'); return; }
      window.DriveSync.showLoading(btn);
      const domain = res.allUrls?.[0] ? new URL(res.allUrls[0]).hostname : (res.pages?.[0]?.url ? new URL(res.pages[0].url).hostname : 'scraper');
      const result = await window.DriveSync.uploadText(txt, `Site_Links_${Date.now()}.txt`, domain, 'txt');
      window.DriveSync.showResult(btn, result);
    } catch (err) { window.DriveSync.showError(btn, err.message); }
  });

  $('site-clearBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clear_job', jobType: 'site' });
    resetPageUI('site');
  });
}

// PAGE: وسائط
function initMediaPage() {
  const $ = id => document.getElementById(id);
  $('med-startBtn').addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab) return;
    setRunning('media', true);
    chrome.runtime.sendMessage({
      action: 'start_job',
      type: 'media',
      tabId: tab.id,
      settings: { ...cfg, filters: { pages: false, images: $('med-fImages').checked, videos: $('med-fVideos').checked, files: $('med-fFiles').checked, directDownloads: $('med-fDownloads').checked } }
    });
  });
  $('med-stopBtn').addEventListener('click', () => stopJob('media'));
  $('med-downloadBtn').addEventListener('click', async () => {
    try {
      const res = await getMessage('get_data');
      if (!res) {
        alert('⚠️ لا توجد وسائط للتحميل. جرب البدء أولاً.');
        return;
      }
      let txt = `=== روابط الوسائط ===\n\n`;
      if (res.images.length) txt += `--- صور ---\n${res.images.join('\n')}\n\n`;
      if (res.videos.length) txt += `--- فيديو ---\n${res.videos.join('\n')}\n\n`;
      if (res.files.length) txt += `--- ملفات ---\n${res.files.join('\n')}\n\n`;
      if (res.directDownloads.length) txt += `--- روابط تحميل ---\n${res.directDownloads.join('\n')}\n\n`;
      
      if (txt === `=== روابط الوسائط ===\n\n`) {
        alert('⚠️ لم يتم العثور على وسائط');
        return;
      }
      downloadText(txt, `Media_Links_${Date.now()}.txt`);
    } catch (err) {
      console.error('خطأ:', err);
      alert('❌ حدث خطأ: ' + err.message);
    }
  });
  document.getElementById('med-driveBtn').addEventListener('click', async () => {
    const btn = document.getElementById('med-driveBtn');
    try {
      const res = await getMessage('get_data');
      if (!res) { alert('⚠️ لا توجد بيانات. جرب البدء أولاً.'); return; }
      let txt = `=== روابط الوسائط ===\n\n`;
      if (res.images?.length)        txt += `--- صور ---\n${res.images.join('\n')}\n\n`;
      if (res.videos?.length)        txt += `--- فيديو ---\n${res.videos.join('\n')}\n\n`;
      if (res.files?.length)         txt += `--- ملفات ---\n${res.files.join('\n')}\n\n`;
      if (res.directDownloads?.length) txt += `--- روابط تحميل ---\n${res.directDownloads.join('\n')}\n\n`;
      if (txt.trim() === '=== روابط الوسائط ===') { alert('⚠️ لم يتم العثور على وسائط'); return; }
      window.DriveSync.showLoading(btn);
      const result = await window.DriveSync.uploadText(txt, `Media_Links_${Date.now()}.txt`, 'scraper', 'txt');
      window.DriveSync.showResult(btn, result);
    } catch (err) { window.DriveSync.showError(btn, err.message); }
  });
}

// PAGE: استخراج الروابط
function initExtractPage() {
  const $ = id => document.getElementById(id);
  $('ext-startBtn').addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab) return;
    setRunning('extract', true);
    chrome.runtime.sendMessage({
      action: 'start_job',
      type: 'extract',
      tabId: tab.id,
      scope: { include: $('ext-include').value, exclude: $('ext-exclude').value },
      settings: { ...cfg }
    });
  });
  $('ext-stopBtn').addEventListener('click', () => stopJob('extract'));
  $('ext-downloadBtn').addEventListener('click', async () => {
    try {
      const res = await getMessage('get_data');
      if (!res || !res.allUrls || res.allUrls.length === 0) {
        alert('⚠️ لا توجد روابط للتحميل. جرب البدء أولاً.');
        return;
      }
      downloadText(res.allUrls.join('\n'), `Site_Links_${Date.now()}.txt`);
    } catch (err) {
      console.error('خطأ:', err);
      alert('❌ حدث خطأ: ' + err.message);
    }
  });
  $('ext-driveBtn').addEventListener('click', async () => {
    const btn = $('ext-driveBtn');
    try {
      const res = await getMessage('get_data');
      if (!res || !res.allUrls || res.allUrls.length === 0) { alert('⚠️ لا توجد روابط. جرب البدء أولاً.'); return; }
      window.DriveSync.showLoading(btn);
      const domain = res.allUrls[0] ? new URL(res.allUrls[0]).hostname : 'scraper';
      const result = await window.DriveSync.uploadText(res.allUrls.join('\n'), `Site_Links_${Date.now()}.txt`, domain, 'txt');
      window.DriveSync.showResult(btn, result);
    } catch (err) { window.DriveSync.showError(btn, err.message); }
  });
}

// PAGE: يدوي
function initManualPage() {
  const $ = id => document.getElementById(id);
  $('man-collectBtn').addEventListener('click', async () => {
    try {
      const tab = await getActiveTab();
      if (!tab) {
        alert('❌ لم يتم العثور على علامة تبويب نشطة');
        return;
      }
      
      $('man-collectBtn').disabled = true;
      $('man-collectBtn').textContent = '⏳ جاري الحفظ...';
      
      const res = await getMessage({ action: 'manual_collect', tabId: tab.id });
      
      if (res && res.success) {
        alert(`✅ تم حفظ الصفحة! (${res.count} صفحات مجموعة)`);
        refreshManualList();
      } else {
        alert('❌ فشل في حفظ الصفحة: ' + (res?.error || 'خطأ غير معروف'));
      }
    } catch (err) {
      console.error('خطأ:', err);
      alert('❌ حدث خطأ: ' + err.message);
    } finally {
      $('man-collectBtn').disabled = false;
      $('man-collectBtn').innerHTML = '<i class="fas fa-plus-circle"></i> حفظ الصفحة الحالية';
    }
  });
  $('man-downloadBtn').addEventListener('click', async () => {
    try {
      $('man-downloadBtn').disabled = true;
      $('man-downloadBtn').innerHTML = '<i class="fas fa-spinner"></i> جاري تجهيز النسخة الأوفلاين...';
      if (cfg.downloadAssets) {
        await getMessage('finalize_assets');
      }
      const res = await getMessage('get_data');
      if (!res || !res.manualPages || res.manualPages.length === 0) {
        alert('⚠️ لا توجد صفحات للتحميل. جرب جمع الصفحات أولاً.');
        return;
      }
      await buildAndDownloadZip({ pages: res.manualPages, assetFiles: res.assetFiles }, `Manual_Pages_${Date.now()}`);
    } catch (err) {
      console.error('خطأ:', err);
      alert('❌ حدث خطأ: ' + err.message);
    } finally {
      $('man-downloadBtn').disabled = false;
      $('man-downloadBtn').innerHTML = '<i class="fas fa-file-zipper"></i> تحميل ZIP';
    }
  });
  $('man-driveBtn').addEventListener('click', async () => {
    const btn = $('man-driveBtn');
    try {
      const res = await getMessage('get_data');
      if (!res || !res.manualPages || res.manualPages.length === 0) { alert('⚠️ لا توجد صفحات. جرب الجمع أولاً.'); return; }
      window.DriveSync.showLoading(btn);
      const zip = new JSZip();
      res.manualPages.forEach(p => zip.file(p.fileName || 'page.html', p.htmlOffline || p.html || ''));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const domain = res.manualPages[0]?.url ? new URL(res.manualPages[0].url).hostname : 'scraper';
      const result = await window.DriveSync.uploadZip(blob, `Manual_Pages_${Date.now()}.zip`, domain);
      window.DriveSync.showResult(btn, result);
    } catch (err) { window.DriveSync.showError(btn, err.message); }
  });
  $('man-clearBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clear_job', jobType: 'manual' });
    refreshManualList();
  });
}

// PAGE: قالب XML احترافي
function initXMLPage() {
  const $ = id => document.getElementById(id);
  let currentXmlData = null;
  let bloggerDetected = false;
  const FETCH_TIMEOUT = 9000;

  // ============================================================
  // تعبئة رابط الموقع تلقائياً من التبويب الحالي
  // ============================================================
  async function fillFromActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.url.startsWith('http')) {
        $('xml-targetUrl').value = tab.url;
      }
    } catch (e) {}
  }
  fillFromActiveTab();
  $('xml-useTabBtn').addEventListener('click', fillFromActiveTab);

  function getOrigin(url) {
    try { return new URL(url).origin; } catch (e) { return null; }
  }

  // ============================================================
  // أدوات جلب مباشرة (fetch) — تعمل من سياق الإضافة نفسه بصلاحيات
  // host_permissions لذلك لا تتأثر بـ CORS، وبدون فتح أي تبويب
  // ============================================================
  async function fetchTextSafe(url) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
      const resp = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) return null;
      return await resp.text();
    } catch (e) { return null; }
  }

  function parseDoc(html) {
    try { return new DOMParser().parseFromString(html, 'text/html'); } catch (e) { return null; }
  }

  function detectBlogger(doc, hostname) {
    if (!doc) return false;
    return !!(doc.querySelector('meta[name="generator" i][content*="Blogger" i]') ||
      doc.documentElement.getAttribute('xmlns:b') ||
      /blogspot\./i.test(hostname || ''));
  }

  function getCrawlLimit() {
    const v = parseInt($('xml-crawlLimit')?.value, 10);
    return Number.isFinite(v) && v > 0 ? Math.min(v, 300) : 15;
  }

  function extractTextFromDoc(doc) {
    try {
      if (!doc || !doc.body) return '';
      const clone = doc.body.cloneNode(true);
      clone.querySelectorAll('script, style, noscript, iframe, svg, template').forEach(el => el.remove());
      let text = clone.textContent || '';
      text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/[ \t]*\n[ \t]*/g, '\n').trim();
      return text;
    } catch (e) { return ''; }
  }

  function extractStructureFromDoc(doc) {
    const hint = (sel) => { const el = doc.querySelector(sel); return el ? el.outerHTML : null; };
    return {
      header: hint('header') || hint('[role="banner"]') || hint('#header') || hint('.header'),
      footer: hint('footer') || hint('[role="contentinfo"]') || hint('#footer') || hint('.footer'),
      nav: hint('nav') || hint('[role="navigation"]') || hint('#nav') || hint('.nav') || hint('.navbar')
    };
  }

  function extractSameDomainLinks(doc, origin, hostname) {
    const links = new Set();
    if (!doc) return links;
    doc.querySelectorAll('a[href]').forEach(a => {
      try {
        const u = new URL(a.getAttribute('href'), origin);
        if (u.hostname === hostname) { u.hash = ''; links.add(u.href); }
      } catch (e) {}
    });
    return links;
  }

  // sitemap.xml حقيقي (مع دعم sitemap index المتداخل) — وإلا زحف تلقائي خفيف
  async function fetchSitemapRecursiveLive(url, depth) {
    const found = new Set();
    if (depth > 3) return found;
    const text = await fetchTextSafe(url);
    if (!text) return found;
    const sitemapRefs = text.match(/<sitemap>[\s\S]*?<\/sitemap>/g);
    if (sitemapRefs && sitemapRefs.length > 0) {
      for (const block of sitemapRefs) {
        const locMatch = block.match(/<loc>(.*?)<\/loc>/);
        if (locMatch) {
          const sub = await fetchSitemapRecursiveLive(locMatch[1].trim(), depth + 1);
          sub.forEach(u => found.add(u));
        }
      }
      return found;
    }
    const matches = text.match(/<loc>(.*?)<\/loc>/g);
    if (matches) matches.forEach(m => {
      const u = m.replace(/<\/?loc>/g, '').trim();
      if (u.startsWith('http')) found.add(u);
    });
    return found;
  }

  async function getSitemapUrlsLive(origin, statusCb, limit) {
    statusCb && statusCb('🔍 جاري محاولة جلب sitemap.xml...');
    const fromSitemap = await fetchSitemapRecursiveLive(origin + '/sitemap.xml', 0);
    if (fromSitemap.size > 0) return { urls: Array.from(fromSitemap), source: 'sitemap.xml' };

    statusCb && statusCb('🔍 لا يوجد sitemap.xml، جاري زحف خفيف تلقائي...');
    const hostname = new URL(origin).hostname;
    const homeHtml = await fetchTextSafe(origin);
    const homeDoc = parseDoc(homeHtml || '');
    const links = extractSameDomainLinks(homeDoc, origin, hostname);
    links.add(origin);
    return { urls: Array.from(links).slice(0, limit || getCrawlLimit()), source: 'زحف تلقائي', homeDoc };
  }

  // يجلب فعلياً عدة صفحات (HTML + نص كامل) — يفضّل روابط sitemap كبذرة إن وُجدت
  async function discoverPagesLive(baseUrl, statusCb, opts = {}) {
    const limit = opts.limit || getCrawlLimit();
    const origin = getOrigin(baseUrl);
    if (!origin) throw new Error('رابط غير صالح');
    const hostname = new URL(origin).hostname;

    statusCb && statusCb('🔍 جاري جلب الصفحة الرئيسية...');
    const homeHtml = await fetchTextSafe(baseUrl) || await fetchTextSafe(origin);
    const homeDoc = parseDoc(homeHtml || '');
    bloggerDetected = detectBlogger(homeDoc, hostname);

    let toFetch;
    if (opts.seedUrls && opts.seedUrls.length > 0) {
      toFetch = [baseUrl, ...opts.seedUrls.filter(u => u !== baseUrl)].slice(0, limit);
    } else {
      const links = Array.from(extractSameDomainLinks(homeDoc, origin, hostname));
      toFetch = [baseUrl, ...links.filter(u => u !== baseUrl)].slice(0, limit);
    }

    const pages = [];
    for (let i = 0; i < toFetch.length; i++) {
      const url = toFetch[i];
      statusCb && statusCb(`🔍 جلب الصفحات: (${i + 1}/${toFetch.length})...`);
      const html = url === baseUrl && homeHtml ? homeHtml : await fetchTextSafe(url);
      if (!html) continue;
      const doc = parseDoc(html);
      if (!doc) continue;
      if (!bloggerDetected) bloggerDetected = detectBlogger(doc, hostname);
      pages.push({
        url,
        title: (doc.querySelector('title')?.textContent || 'بدون عنوان').trim(),
        description: doc.querySelector('meta[name="description" i]')?.getAttribute('content') || '',
        html,
        text: extractTextFromDoc(doc),
        structure: extractStructureFromDoc(doc)
      });
    }
    return { pages, origin, hostname, homeDoc };
  }

  // ============================================================
  // مولّدات المخرجات (تأخذ بيانات طازجة تم جلبها الآن، وليس بيانات قديمة)
  // ============================================================
  function generateSitemap(urls) {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    new Set(urls).forEach(url => {
      xml += '  <url>\n';
      xml += `    <loc>${escapeXml(url)}</loc>\n`;
      xml += `    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>\n`;
      xml += '    <changefreq>weekly</changefreq>\n';
      xml += '    <priority>0.8</priority>\n';
      xml += '  </url>\n';
    });
    xml += '</urlset>\n';
    return xml;
  }

  function generateRobots(origin, sitemapUrl) {
    let txt = '# Generated by Ultimate Web Scraper Pro\n';
    txt += `# ${origin}\n\n`;
    txt += 'User-agent: *\n';
    txt += 'Allow: /\n';
    txt += 'Disallow: /admin/\n';
    txt += 'Disallow: /private/\n';
    txt += 'Disallow: /temp/\n\n';
    txt += '# Specific rules\n';
    txt += 'User-agent: Googlebot\n';
    txt += 'Allow: /\n\n';
    txt += `Sitemap: ${sitemapUrl || origin + '/sitemap.xml'}\n\n`;
    txt += '# Crawl delay (seconds)\n';
    txt += 'Crawl-delay: 1\n';
    return txt;
  }

  function generateRSSFeed(origin, siteTitle, items, note) {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<rss version="2.0">\n<channel>\n';
    xml += `<title><![CDATA[${siteTitle || origin}]]></title>\n`;
    xml += `<link>${escapeXml(origin)}</link>\n`;
    xml += `<description><![CDATA[${note || 'أحدث التحديثات والمقالات'}]]></description>\n`;
    xml += `<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n`;
    xml += '<language>ar</language>\n';
    items.forEach(item => {
      xml += '<item>\n';
      xml += `  <title><![CDATA[${item.title}]]></title>\n`;
      xml += `  <link>${escapeXml(item.url)}</link>\n`;
      xml += `  <description><![CDATA[${item.description || ''}]]></description>\n`;
      xml += `  <guid>${escapeXml(item.url)}</guid>\n`;
      xml += `  <pubDate>${new Date().toUTCString()}</pubDate>\n`;
      xml += '</item>\n';
    });
    xml += '</channel>\n</rss>\n';
    return xml;
  }

  function generateSchema(origin, siteTitle, siteDescription, pages) {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      'name': siteTitle || origin,
      'url': origin,
      'description': siteDescription || '',
      'mainEntity': {
        '@type': 'Organization',
        'name': siteTitle || origin,
        'url': origin
      },
      'breadcrumb': {
        '@type': 'BreadcrumbList',
        'itemListElement': (pages || []).slice(0, 10).map((p, i) => ({
          '@type': 'ListItem', 'position': i + 1, 'name': p.title, 'item': p.url
        }))
      }
    };
    return JSON.stringify(schema, null, 2);
  }

  function generateMasterXML(meta) {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<website>\n  <metadata>\n';
    xml += `    <generatedAt>${new Date().toISOString()}</generatedAt>\n`;
    xml += `    <domain>${escapeXml(meta.origin)}</domain>\n`;
    xml += `    <totalPagesFetchedNow>${meta.pages.length}</totalPagesFetchedNow>\n`;
    xml += `    <totalUrlsInSitemap>${meta.sitemapUrls.length}</totalUrlsInSitemap>\n`;
    xml += `    <isBloggerSite>${meta.isBlogger}</isBloggerSite>\n  </metadata>\n\n`;
    xml += '  <pages>\n';
    meta.pages.forEach((page, i) => {
      xml += `    <page id="page_${i}">\n`;
      xml += `      <url><![CDATA[${page.url}]]></url>\n`;
      xml += `      <title><![CDATA[${page.title}]]></title>\n`;
      xml += `      <description><![CDATA[${page.description}]]></description>\n`;
      xml += '    </page>\n';
    });
    xml += '  </pages>\n\n  <sitemapUrls>\n';
    meta.sitemapUrls.forEach(u => { xml += `    <url><![CDATA[${u}]]></url>\n`; });
    xml += '  </sitemapUrls>\n</website>\n';
    return xml;
  }

  // جديد v6.4: نسخة XML كاملة للموقع — محتوى نصي كامل لكل صفحة تم جلبها فعلياً الآن
  function generateFullSiteXML(meta) {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<!--\n';
    xml += `  نسخة XML كاملة من الموقع — تم جلب ${meta.pages.length} صفحة مباشرة الآن (وليس من سحب قديم).\n`;
    if (meta.isBlogger) {
      xml += '  ⚠️ الموقع Blogger: هذه نسخة من المحتوى الظاهر للعامة، وليست ملف Theme XML الرسمي المحمي.\n';
    }
    xml += `  تم الإنشاء في: ${new Date().toISOString()}\n`;
    xml += '-->\n';
    xml += '<siteCopy>\n  <meta>\n';
    xml += `    <domain><![CDATA[${meta.origin}]]></domain>\n`;
    xml += `    <totalPages>${meta.pages.length}</totalPages>\n`;
    xml += `    <isBloggerSite>${!!meta.isBlogger}</isBloggerSite>\n`;
    xml += '  </meta>\n\n  <pages>\n';
    meta.pages.forEach((page, i) => {
      xml += `    <page id="page_${i}">\n`;
      xml += `      <url><![CDATA[${page.url}]]></url>\n`;
      xml += `      <title><![CDATA[${page.title}]]></title>\n`;
      xml += `      <description><![CDATA[${page.description}]]></description>\n`;
      xml += `      <content><![CDATA[${page.text || ''}]]></content>\n`;
      xml += '    </page>\n';
    });
    xml += '  </pages>\n</siteCopy>\n';
    return xml;
  }

  function generateStructuralTemplate(samples, isBlogger) {
    if (!samples || samples.length === 0) {
      return '<!--\n  تعذّر جلب أي صفحة من الموقع (تأكد من الرابط أو من اتصال الإنترنت).\n-->';
    }
    const normalize = (html) => (html || '').replace(/\s+/g, ' ').trim();
    const pickMostCommon = (key) => {
      const freq = new Map();
      samples.forEach(s => {
        const raw = s[key];
        if (!raw) return;
        const norm = normalize(raw);
        if (!freq.has(norm)) freq.set(norm, { count: 0, original: raw });
        freq.get(norm).count++;
      });
      let best = null;
      freq.forEach(v => { if (!best || v.count > best.count) best = v; });
      return best ? { html: best.original, occurrences: best.count } : null;
    };

    const header = pickMostCommon('header');
    const footer = pickMostCommon('footer');
    const nav = pickMostCommon('nav');
    const total = samples.length;

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<!--\n';
    xml += `  قالب هيكلي مُستخرج تلقائياً الآن من ${total} صفحة تم جلبها مباشرة من الموقع.\n`;
    if (isBlogger) {
      xml += '  ⚠️ تم رصد أن الموقع Blogger — هذا ليس ملف Blogger XML الرسمي (المحمي بتسجيل الدخول)،\n';
      xml += '  بل قالب مبني من التحليل الهيكلي للصفحات الظاهرة للعامة، بديل عملي لإعادة بناء نفس الشكل.\n';
    }
    xml += `  تم الإنشاء في: ${new Date().toISOString()}\n-->\n<template>\n  <meta>\n`;
    xml += `    <sourcePagesAnalyzed>${total}</sourcePagesAnalyzed>\n    <isBloggerSite>${!!isBlogger}</isBloggerSite>\n  </meta>\n\n`;

    xml += '  <header>\n';
    xml += header ? `    <!-- ظهر بنفس الشكل في ${header.occurrences} من ${total} صفحة -->\n    <![CDATA[${header.html}]]>\n` : '    <!-- لم يتم العثور على عنصر header ثابت -->\n';
    xml += '  </header>\n\n  <navigation>\n';
    xml += nav ? `    <!-- ظهر بنفس الشكل في ${nav.occurrences} من ${total} صفحة -->\n    <![CDATA[${nav.html}]]>\n` : '    <!-- لم يتم العثور على عنصر nav ثابت -->\n';
    xml += '  </navigation>\n\n  <contentPlaceholder>\n    <![CDATA[{{PAGE_CONTENT}}]]>\n  </contentPlaceholder>\n\n  <footer>\n';
    xml += footer ? `    <!-- ظهر بنفس الشكل في ${footer.occurrences} من ${total} صفحة -->\n    <![CDATA[${footer.html}]]>\n` : '    <!-- لم يتم العثور على عنصر footer ثابت -->\n';
    xml += '  </footer>\n</template>\n';
    return xml;
  }

  function escapeXml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  // ============================================================
  // زر "سحب وتوليد" الموحّد — كل نوع يجيب بياناته بنفسه الآن
  // ============================================================
  $('xml-previewBtn').addEventListener('click', async () => {
    const btn = $('xml-previewBtn');
    const statusEl = $('xml-status');
    const setStatus = (t) => { statusEl.textContent = t; };

    try {
      const rawUrl = $('xml-targetUrl').value.trim();
      if (!rawUrl || !rawUrl.startsWith('http')) {
        alert('⚠️ اكتب رابط الموقع أولاً (أو اضغط "التبويب الحالي")');
        return;
      }
      const origin = getOrigin(rawUrl);
      if (!origin) { alert('⚠️ رابط غير صالح'); return; }

      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner"></i> جاري الجلب...';
      bloggerDetected = false;

      const type = document.querySelector('input[name="xml-type"]:checked').value;
      let xmlData;

      if (type === 'sitemap') {
        const { urls, source, homeDoc } = await getSitemapUrlsLive(origin, setStatus);
        if (homeDoc) bloggerDetected = detectBlogger(homeDoc, new URL(origin).hostname);
        xmlData = generateSitemap(urls);
        setStatus(`✅ تم الجلب عبر: ${source} — ${urls.length} رابط`);
      }
      else if (type === 'robots') {
        setStatus('🔍 جاري جلب robots.txt...');
        const existing = await fetchTextSafe(origin + '/robots.txt');
        xmlData = existing && existing.trim().length > 0
          ? `# تم جلب هذا الملف مباشرة من الموقع (موجود فعلاً)\n\n${existing}`
          : generateRobots(origin, origin + '/sitemap.xml');
        setStatus(existing ? '✅ تم جلب robots.txt الحقيقي من الموقع' : '✅ لا يوجد robots.txt حالياً — تم توليد نسخة مقترحة');
      }
      else if (type === 'rss') {
        setStatus('🔍 جاري فحص روابط RSS المعروفة...');
        const knownPaths = ['/feed', '/feed/', '/rss.xml', '/atom.xml', '/rss', '/feeds/posts/default', '/feeds/posts/default?alt=rss'];
        let found = null, foundPath = null;
        for (const p of knownPaths) {
          const text = await fetchTextSafe(origin + p);
          if (text && /<rss|<feed/i.test(text)) { found = text; foundPath = p; break; }
        }
        if (found) {
          xmlData = `<!-- تم جلب هذا الفيد مباشرة من: ${origin}${foundPath} -->\n${found}`;
          setStatus(`✅ تم العثور على فيد حقيقي: ${foundPath}`);
        } else {
          setStatus('🔍 لا يوجد فيد معروف، جاري بناء واحد من الصفحات مباشرة...');
          const { pages, homeDoc } = await discoverPagesLive(rawUrl, setStatus);
          const linkTag = homeDoc?.querySelector('link[rel="alternate"][type*="rss" i], link[rel="alternate"][type*="atom" i]');
          if (linkTag) {
            const altUrl = new URL(linkTag.getAttribute('href'), origin).href;
            const altText = await fetchTextSafe(altUrl);
            if (altText) {
              xmlData = `<!-- تم جلبه عبر <link rel="alternate"> من الصفحة الرئيسية: ${altUrl} -->\n${altText}`;
              setStatus('✅ تم العثور على الفيد عبر وسم alternate بالصفحة الرئيسية');
            }
          }
          if (!xmlData) {
            xmlData = generateRSSFeed(origin, pages[0]?.title || origin,
              pages.map(p => ({ title: p.title, url: p.url, description: p.description })),
              'تم توليده تلقائياً من صفحات الموقع (لا يوجد فيد RSS منشور حالياً)');
            setStatus(`✅ تم توليد RSS من ${pages.length} صفحة تم جلبها فعلياً الآن`);
          }
        }
      }
      else if (type === 'schema') {
        setStatus('🔍 جاري جلب الصفحة الرئيسية...');
        const html = await fetchTextSafe(rawUrl) || await fetchTextSafe(origin);
        const doc = parseDoc(html || '');
        bloggerDetected = detectBlogger(doc, new URL(origin).hostname);
        const ldScripts = doc ? Array.from(doc.querySelectorAll('script[type="application/ld+json"]')) : [];
        if (ldScripts.length > 0) {
          xmlData = ldScripts.map(s => s.textContent.trim()).join('\n\n---\n\n');
          setStatus(`✅ تم العثور على ${ldScripts.length} كتلة Schema حقيقية في الصفحة`);
        } else {
          const title = doc?.querySelector('title')?.textContent?.trim() || origin;
          const desc = doc?.querySelector('meta[name="description" i]')?.getAttribute('content') || '';
          xmlData = generateSchema(origin, title, desc, []);
          setStatus('✅ لا يوجد Schema منشور — تم توليد نسخة مقترحة من بيانات الصفحة الحقيقية');
        }
      }
      else if (type === 'master') {
        const limit = getCrawlLimit();
        const { urls: sitemapUrls } = await getSitemapUrlsLive(origin, setStatus, limit);
        const { pages, hostname } = await discoverPagesLive(rawUrl, setStatus, { limit, seedUrls: sitemapUrls });
        xmlData = generateMasterXML({ origin, sitemapUrls, pages, isBlogger: bloggerDetected });
        setStatus(`✅ تم جلب ${pages.length} صفحة و ${sitemapUrls.length} رابط sitemap مباشرة`);
      }
      else if (type === 'template') {
        const limit = getCrawlLimit();
        const { urls: sitemapUrls } = await getSitemapUrlsLive(origin, setStatus, limit);
        const { pages } = await discoverPagesLive(rawUrl, setStatus, { limit, seedUrls: sitemapUrls });
        const samples = pages.map(p => ({ url: p.url, header: p.structure.header, footer: p.structure.footer, nav: p.structure.nav }));
        xmlData = generateStructuralTemplate(samples, bloggerDetected);
        setStatus(`✅ تم تحليل ${pages.length} صفحة تم جلبها الآن مباشرة`);
      }
      else if (type === 'fullcopy') {
        const limit = getCrawlLimit();
        setStatus('🔍 جاري اكتشاف صفحات الموقع (Sitemap أو زحف تلقائي)...');
        const { urls: sitemapUrls } = await getSitemapUrlsLive(origin, setStatus, limit);
        const { pages } = await discoverPagesLive(rawUrl, setStatus, { limit, seedUrls: sitemapUrls });
        xmlData = generateFullSiteXML({ origin, pages, isBlogger: bloggerDetected });
        setStatus(`✅ تم إنشاء نسخة XML كاملة من ${pages.length} صفحة (محتوى نصي كامل لكل صفحة)`);
      }

      $('xml-blogger-note').style.display = bloggerDetected ? 'block' : 'none';
      currentXmlData = xmlData;
      $('xml-driveBtn').disabled = false;
      const preview = $('xml-preview');
      const lines = xmlData.split('\n');
      const maxLines = 40;
      preview.textContent = lines.length > maxLines
        ? lines.slice(0, maxLines).join('\n') + `\n\n... (${lines.length - maxLines} سطر آخر)`
        : xmlData;
      preview.style.display = 'block';
    } catch (err) {
      console.error('خطأ:', err);
      setStatus('❌ خطأ: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-bolt"></i> سحب وتوليد';
    }
  });

  // تحميل
  $('xml-downloadBtn').addEventListener('click', async () => {
    try {
      if (!currentXmlData) {
        alert('⚠️ اضغط "سحب وتوليد" أولاً');
        return;
      }

      const type = document.querySelector('input[name="xml-type"]:checked').value;
      let filename;
      switch (type) {
        case 'sitemap': filename = 'sitemap.xml'; break;
        case 'robots': filename = 'robots.txt'; break;
        case 'rss': filename = 'feed.xml'; break;
        case 'schema': filename = 'schema.json-ld'; break;
        case 'master': filename = `master_${Date.now()}.xml`; break;
        case 'template': filename = 'site_template.xml'; break;
        case 'fullcopy': filename = `full_site_copy_${Date.now()}.xml`; break;
        default: filename = `file_${Date.now()}.xml`;
      }

      downloadText(currentXmlData, filename);
      $('xml-status').textContent = `✅ تم التحميل: ${filename}`;
      setTimeout(() => { $('xml-status').textContent = ''; }, 3000);
    } catch (err) {
      alert('❌ خطأ: ' + err.message);
    }
  });

  // رفع لـ Drive
  $('xml-driveBtn').addEventListener('click', async () => {
    const btn = $('xml-driveBtn');
    try {
      if (!currentXmlData) { alert('⚠️ اضغط "سحب وتوليد" أولاً'); return; }
      const type = document.querySelector('input[name="xml-type"]:checked').value;
      const ext  = (type === 'robots') ? 'txt' : 'xml';
      const name = type === 'sitemap' ? 'sitemap.xml' : type === 'robots' ? 'robots.txt' : `${type}_${Date.now()}.xml`;
      const rawUrl = $('xml-targetUrl').value.trim();
      const domain = rawUrl ? new URL(rawUrl).hostname : 'scraper';
      window.DriveSync.showLoading(btn);
      const result = await window.DriveSync.uploadText(currentXmlData, name, domain, ext);
      window.DriveSync.showResult(btn, result);
    } catch (err) { window.DriveSync.showError(btn, err.message); }
  });

  // نسخ
  $('xml-copyBtn').addEventListener('click', async () => {
    try {
      if (!currentXmlData) {
        alert('⚠️ اضغط معاينة أولاً');
        return;
      }

      await navigator.clipboard.writeText(currentXmlData);
      $('xml-status').textContent = '✅ تم النسخ إلى الحافظة!';
      setTimeout(() => { $('xml-status').textContent = ''; }, 3000);
    } catch (err) {
      alert('❌ فشل النسخ: ' + err.message);
    }
  });
}

// PAGE: روابط محددة
function initCustomPage() {
  const $ = id => document.getElementById(id);
  const container = $('custom-urlInputs');
  const addBtn = $('custom-addBtn');
  const uploadBtn = $('custom-uploadBtn');
  const fileInput = $('custom-fileInput');
  const uploadStatus = $('custom-uploadStatus');

  const addRow = (val = '') => {
    const div = document.createElement('div');
    div.className = 'url-input-row';
    div.innerHTML = `<input type="text" class="url-input" placeholder="https://..." value="${val}">
                     <button class="remove-url-btn"><i class="fas fa-times"></i></button>`;
    div.querySelector('.remove-url-btn').onclick = () => { div.remove(); updateCounter(); };
    div.querySelector('.url-input').oninput = updateCounter;
    container.appendChild(div);
    updateCounter();
  };

  const updateCounter = () => {
    const count = Array.from(container.querySelectorAll('.url-input')).filter(i => i.value.trim()).length;
    $('custom-counter').textContent = `${count} رابط`;
    $('cust-total').textContent = count;
  };

  // معالج رفع الملف
  uploadBtn.onclick = () => fileInput.click();

  fileInput.onchange = async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;

      if (!file.name.endsWith('.txt')) {
        alert('❌ الرجاء رفع ملف txt فقط');
        return;
      }

      uploadStatus.textContent = '⏳ جاري قراءة الملف...';

      const text = await file.text();
      const urls = text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && line.startsWith('http'));

      if (urls.length === 0) {
        uploadStatus.textContent = '❌ لم يتم العثور على روابط صحيحة';
        alert('⚠️ الملف لا يحتوي على روابط صحيحة (يجب أن تبدأ برابط http)');
        return;
      }

      // مسح الروابط القديمة
      container.innerHTML = '';

      // إضافة الروابط الجديدة
      urls.forEach(url => addRow(url));

      uploadStatus.textContent = `✅ تم إضافة ${urls.length} رابط`;
      fileInput.value = '';
      
      setTimeout(() => { uploadStatus.textContent = ''; }, 3000);
    } catch (err) {
      console.error('خطأ:', err);
      uploadStatus.textContent = '❌ خطأ في قراءة الملف';
      alert('❌ خطأ: ' + err.message);
    }
  };

  addBtn.onclick = () => addRow();
  addRow();

  $('cust-startBtn').onclick = async () => {
    const urls = Array.from(container.querySelectorAll('.url-input')).map(i => i.value.trim()).filter(u => u.startsWith('http'));
    if (urls.length === 0) {
      alert('⚠️ أضف روابط أولاً');
      return;
    }
    const tab = await getActiveTab();
    if (!tab) {
      alert('❌ لم يتم العثور على علامة تبويب نشطة');
      return;
    }
    setRunning('custom', true);
    chrome.runtime.sendMessage({
      action: 'start_job',
      type: 'custom',
      tabId: tab.id,
      customUrls: urls,
      settings: { ...cfg, filters: { pages: $('cust-fPages').checked, text: $('cust-fText').checked, images: $('cust-fImages').checked, videos: $('cust-fVideos').checked, files: $('cust-fFiles').checked } }
    });
  };
  $('cust-stopBtn').onclick = () => stopJob('custom');
  $('cust-downloadBtn').onclick = async () => {
    try {
      const res = await getMessage('get_data');
      if (!res || !res.pages || res.pages.length === 0) {
        alert('⚠️ لا توجد صفحات للتحميل. جرب البدء أولاً.');
        return;
      }
      await buildAndDownloadZip(res, `Custom_Links_${Date.now()}`);
    } catch (err) {
      console.error('خطأ:', err);
      alert('❌ حدث خطأ: ' + err.message);
    }
  };
  $('cust-driveBtn').onclick = async () => {
    const btn = $('cust-driveBtn');
    try {
      const res = await getMessage('get_data');
      if (!res || !res.pages || res.pages.length === 0) { alert('⚠️ لا توجد بيانات. جرب البدء أولاً.'); return; }
      window.DriveSync.showLoading(btn);
      const blob = await buildZipBlob(res, `Drive_${Date.now()}`);
      const domain = res.pages[0]?.url ? new URL(res.pages[0].url).hostname : 'scraper';
      const result = await window.DriveSync.uploadZip(blob, `Custom_Links_${Date.now()}.zip`, domain);
      window.DriveSync.showResult(btn, result);
    } catch (err) { window.DriveSync.showError(btn, err.message); }
  };
}

// BACKGROUND MESSAGE HANDLER
chrome.runtime.onMessage.addListener(msg => {
  if (msg.action === 'job_update') {
    updateUIFromStatus(msg.status);
  }
});

function updateUIFromStatus(s) {
  if (!s) return;
  const t = s.type;
  const ph = s.stats.phase;
  const isRunning = s.isRunning;

  const updateCommon = (prefix) => {
    const statusEl = document.getElementById(`${prefix}-status`);
    if (statusEl) statusEl.textContent = s.stats.currentUrl;
    const barEl = document.getElementById(`${prefix}-bar`);
    if (barEl) barEl.style.width = s.stats.progress + '%';
    const phaseEl = document.getElementById(`${prefix}-phase`);
    if (phaseEl) phaseEl.textContent = phaseLabel(ph);
    
    if (!isRunning && ph !== 'idle') {
      setRunning(t, false);
      const hasData = s.pagesCount > 0 || s.stats.linksFound > 0 || s.mediaCount > 0;
      const dlBtn = document.getElementById(`${prefix}-downloadBtn`);
      if (dlBtn && hasData) dlBtn.disabled = false;
      // تفعيل زر Drive بنفس الوقت
      const driveBtn = document.getElementById(`${prefix}-driveBtn`);
      if (driveBtn && hasData) driveBtn.disabled = false;
    }
  };

  if (t === 'single') {
    updateCommon('s');
    document.getElementById('s-pages').textContent = s.pagesCount;
    document.getElementById('s-media').textContent = s.mediaCount;
  } else if (t === 'site') {
    updateCommon('site');
    document.getElementById('site-pages').textContent = s.pagesCount;
    document.getElementById('site-links').textContent = s.stats.linksFound;
    if (!isRunning && ph !== 'idle') {
      const hasLinks = s.stats.linksFound > 0 || s.mediaCount > 0;
      const dlLinksBtn = document.getElementById('site-downloadLinksBtn');
      const driveLinksBtn = document.getElementById('site-driveLinksBtn');
      if (dlLinksBtn && hasLinks) dlLinksBtn.disabled = false;
      if (driveLinksBtn && hasLinks) driveLinksBtn.disabled = false;
    }
  } else if (t === 'media') {
    updateCommon('med');
    document.getElementById('med-images').textContent = s.mediaCount;
  } else if (t === 'custom') {
    updateCommon('cust');
    document.getElementById('cust-done').textContent = s.pagesCount;
  } else if (t === 'extract') {
    updateCommon('ext');
    document.getElementById('ext-links').textContent = s.stats.linksFound;
    document.getElementById('ext-pct').textContent = s.stats.progress + '%';
  }
}

async function buildZipBlob(res, name) {
  if (typeof JSZip === 'undefined') throw new Error('مكتبة JSZip لم تحمل بشكل صحيح');
  const zip = new JSZip();
  const pages = res.pages || [];
  if (pages.length === 0) throw new Error('لا توجد صفحات للتحميل');

  pages.forEach(page => {
    zip.file(page.fileName || 'page.html', page.htmlOffline || page.html || '');
  });

  const textPages = pages.filter(p => p.text && p.text.trim().length > 0);
  if (textPages.length > 0) {
    const textFolder = zip.folder('texts');
    let combined = `=== نصوص كل صفحات ${name} ===\n\n`;
    textPages.forEach(page => {
      const txtName = (page.fileName || 'page').replace(/\.(html|xml)$/i, '') + '.txt';
      textFolder.file(txtName, page.text);
      combined += `\n\n========================================\nالصفحة: ${page.url}\n========================================\n\n${page.text}\n`;
    });
    zip.file('all_text_combined.txt', combined);
  }

  const assetFiles = res.assetFiles || {};
  if (Object.keys(assetFiles).length > 0) {
    const assetsFolder = zip.folder('assets');
    Object.entries(assetFiles).forEach(([fileName, content]) => assetsFolder.file(fileName, content));
  }

  let report = `=== تقرير الوسائط ===\n\n`;
  if (res.images?.length) report += `--- صور ---\n${res.images.join('\n')}\n\n`;
  if (res.videos?.length) report += `--- فيديو ---\n${res.videos.join('\n')}\n\n`;
  if (res.files?.length) report += `--- ملفات ---\n${res.files.join('\n')}\n\n`;
  zip.file('media_links.txt', report);

  if (Object.keys(assetFiles).length > 0 || textPages.length > 0) {
    zip.file('README_offline.txt', 'تم تضمين الصفحات والأصول والنصوص المتاحة. تم ربط الروابط الداخلية التي أمكن تحويلها إلى ملفات محلية.\n');
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

async function buildAndDownloadZip(res, name) {
  try {
    if (typeof JSZip === 'undefined') {
      alert('❌ خطأ: مكتبة JSZip لم تحمل بشكل صحيح. حاول أعادة تحميل الصفحة.');
      return;
    }
    
    const zip = new JSZip();
    const pages = res.pages || [];
    
    if (pages.length === 0) {
      alert('⚠️ لا توجد صفحات للتحميل');
      return;
    }
    
    // نستخدم النسخة المرتبطة محلياً (htmlOffline) إن وُجدت لتعمل الصفحات بدون إنترنت،
    // وإلا نرجع للـ HTML الأصلي كما كان (لا نفقد أي بيانات)
    pages.forEach(page => {
      zip.file(page.fileName || 'page.html', page.htmlOffline || page.html || '');
    });

    // جديد v6.4: نصوص الصفحات المستخرجة (تتجاوز منع النسخ) — ملف .txt مقابل كل صفحة + ملف مجمّع
    const textPages = pages.filter(p => p.text && p.text.trim().length > 0);
    if (textPages.length > 0) {
      const textFolder = zip.folder('texts');
      let combined = `=== نصوص كل صفحات ${name} ===\n\n`;
      textPages.forEach(page => {
        const txtName = (page.fileName || 'page').replace(/\.(html|xml)$/i, '') + '.txt';
        textFolder.file(txtName, page.text);
        combined += `\n\n========================================\n`;
        combined += `الصفحة: ${page.url}\n`;
        combined += `========================================\n\n`;
        combined += page.text + '\n';
      });
      zip.file('all_text_combined.txt', combined);
    }

    // مجلد الأصول (CSS/JS) الحقيقية إن تم تحميلها
    const assetFiles = res.assetFiles || {};
    const assetNames = Object.keys(assetFiles);
    if (assetNames.length > 0) {
      const assetsFolder = zip.folder('assets');
      assetNames.forEach(name => assetsFolder.file(name, assetFiles[name]));
    }
    
    let report = `=== تقرير الوسائط ===\n\n`;
    if (res.images?.length) report += `--- صور ---\n${res.images.join('\n')}\n\n`;
    if (res.videos?.length) report += `--- فيديو ---\n${res.videos.join('\n')}\n\n`;
    if (res.files?.length) report += `--- ملفات ---\n${res.files.join('\n')}\n\n`;
    zip.file('media_links.txt', report);

    if (assetNames.length > 0 || textPages.length > 0) {
      let readme = '';
      if (assetNames.length > 0) {
        readme += `تم تضمين ${assetNames.length} ملف CSS/JS في مجلد assets/، وتم ربط الروابط الداخلية بين الصفحات محلياً.\n`;
        readme += `افتح أي ملف .html من داخل الـ ZIP مباشرة لتصفح نسخة تعمل بدون إنترنت.\n\n`;
      }
      if (textPages.length > 0) {
        readme += `مجلد texts/ يحتوي نص كل صفحة مستخرج مباشرة (يتجاوز أي منع نسخ بالموقع الأصلي).\n`;
        readme += `ملف all_text_combined.txt فيه كل النصوص مجمّعة في ملف واحد.\n`;
      }
      zip.file('README_offline.txt', readme);
    }

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; 
    a.download = name + '.zip'; 
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // تنظيف الـ URL بعد ثانية
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.error('❌ خطأ في التحميل:', err);
    alert('❌ حدث خطأ أثناء إنشاء ملف ZIP: ' + err.message);
  }
}

function downloadText(text, filename) {
  try {
    if (!text || text.length === 0) {
      alert('⚠️ لا توجد بيانات للتحميل');
      return;
    }
    
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // تنظيف الـ URL بعد ثانية
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.error('❌ خطأ في التحميل:', err);
    alert('❌ حدث خطأ أثناء تحميل الملف: ' + err.message);
  }
}

function setRunning(type, running) {
  const map = {
    single: ['s-startBtn', 's-stopBtn'],
    site: ['site-startBtn', 'site-stopBtn'],
    media: ['med-startBtn', 'med-stopBtn'],
    custom: ['cust-startBtn', 'cust-stopBtn'],
    extract: ['ext-startBtn', 'ext-stopBtn']
  };
  const ids = map[type];
  if (!ids) return;
  document.getElementById(ids[0]).disabled = running;
  document.getElementById(ids[1]).disabled = !running;
}

function resetPageUI(type) {
  setRunning(type, false);
}

function phaseLabel(ph) {
  const labels = {
    idle: '—', starting: '⏳', extracting: '🔍', scraping: '📥',
    packaging: '📦', interrupted: '⚠️', done: '✅', error: '❌'
  };
  return labels[ph] || ph;
}

function stopJob(type) {
  chrome.runtime.sendMessage({ action: 'stop_job' });
  setRunning(type, false);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function getMessage(action) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        typeof action === 'string' ? { action } : action,
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('Chrome API Error:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        }
      );
    } catch (err) {
      console.error('Error sending message:', err);
      reject(err);
    }
  });
}

async function syncStatusFromBackground() {
  const s = await getMessage('get_status');
  if (s) updateUIFromStatus(s);
}

async function refreshManualList() {
  const res = await getMessage('get_data');
  if (!res) return;
  const list = document.getElementById('man-list');
  list.innerHTML = '';
  res.manualPages.forEach((page, i) => {
    const item = document.createElement('div');
    item.className = 'manual-item';
    item.innerHTML = `<span style="color:#4a90e2;font-weight:700;flex-shrink:0">${i+1}</span><span class="url-text">${page.url}</span>`;
    list.appendChild(item);
  });
  document.getElementById('man-counter').textContent = res.manualPages.length;
  document.getElementById('man-downloadBtn').disabled = res.manualPages.length === 0;
}
