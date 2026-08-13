// ============================================================
// Content Script v5.0 — المحرك المتقدم لاستخراج البيانات
// (يحافظ على كل وظائف v4.0 ويضيف: استخراج أصول CSS/JS + أخطاء أكثر أماناً)
// ============================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrape_advanced') {
    try {
      const results = scrapePageData(request.filters);
      sendResponse(results);
    } catch (err) {
      console.error('Scrape error:', err);
      sendResponse({ error: err.message });
    }
  }
  return true;
});

function scrapePageData(filters = {}) {
  const domain = window.location.hostname;

  // الكشف عن نوع المحتوى (HTML أو XML)
  const isXml = document.contentType.includes('xml') ||
    document.documentElement.tagName.toLowerCase() === 'rss' ||
    document.documentElement.tagName.toLowerCase() === 'feed';

  const results = {
    html: isXml ? new XMLSerializer().serializeToString(document) : document.documentElement.outerHTML,
    title: document.title || 'page_content',
    url: window.location.href,
    domain: domain,
    isXml: isXml,
    links: extractAllLinks(domain),
    directDownloads: extractDirectDownloadLinks(),
    media: {
      images: filterMedia(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff', 'avif', 'heic']),
      videos: filterMedia(['mp4', 'webm', 'ogv', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'mpeg', '3gp']),
      files: filterMedia(['pdf', 'zip', 'rar', 'exe', 'apk', 'docx', 'xlsx', 'pptx', 'iso', 'dmg', '7z', 'tar', 'gz']),
      xml: filterMedia(['xml', 'rss', 'atom'])
    },
    // جديد: أصول الصفحة (CSS/JS) لبناء نسخة تعمل أوفلاين + معلومات هيكلية لمستخرج القالب
    assets: extractAssets(),
    structure: extractStructureHints(),
    // جديد v6.4: نص الصفحة الكامل — يتجاوز "منع النسخ" لأنه يقرأ DOM مباشرة
    // (منع النسخ التقليدي CSS/JS بيمنع تحديد/كليك يمين بس مش بيمنع قراءة برمجية للمحتوى)
    text: extractPageText()
  };

  return results;
}

/**
 * جديد v6.4: استخراج النص الظاهر للمستخدم من الصفحة، متجاوزاً أي قيود CSS/JS لمنع النسخ
 * (user-select:none، onCopy، oncontextmenu، إلخ) لأنها قيود واجهة فقط ولا تمنع قراءة الـ DOM برمجياً
 */
function extractPageText() {
  try {
    // نقرأ من body الحي مباشرة (وليس نسخة منفصلة) لأن innerText يحتاج عنصر
    // متصل بالـ DOM ليحسب ما هو ظاهر فعلياً — وهذا نفسه ما يجعله يتجاوز
    // قيود منع النسخ (user-select/oncopy/oncontextmenu) لأنها قيود على تفاعل
    // المستخدم فقط، ولا تمنع قراءة المحتوى برمجياً
    let text = document.body ? document.body.innerText : '';
    if (!text || !text.trim()) text = document.body ? document.body.textContent : '';
    text = (text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return text;
  } catch (e) {
    return '';
  }
}

/**
 * v6.6 — إعادة كتابة كاملة: كان الكشف قائم على كلمات عامة (download/link/get)
 * موجودة في النص أو الكلاس، وده كان بيقنص صفحات تصنيف عادية غلط (مثال حقيقي:
 * /category/download-computer-games/ بيتقنص بس لأن كلمة download بالرابط).
 * دلوقتي المعيار الوحيد هو امتداد الملف الفعلي بنهاية الرابط — زي ما هو مطلوب.
 */
function extractDirectDownloadLinks() {
  const downloadLinks = new Set();

  // امتدادات أرشيف/تثبيت برامج فقط (الفئة اللي المستخدم طلبها: zip/rar/exe وما شابه)
  const downloadExtensions = [
    'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso',
    'exe', 'msi', 'msix', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'appimage', 'bin', 'jar', 'run'
  ];
  const extPattern = new RegExp('\\.(' + downloadExtensions.join('|') + ')(?:$)', 'i');

  function hasDownloadExtension(url) {
    try {
      const u = new URL(url);
      if (extPattern.test(u.pathname.toLowerCase())) return true;
      // نمط شائع في مواقع الألعاب/البرامج: رابط تحميل ديناميكي مثل do.php?down=file.rar
      // بيمرر اسم الملف الحقيقي كقيمة Query بدل المسار — امتداد حقيقي فعلي رغم كده
      for (const v of u.searchParams.values()) {
        if (extPattern.test(decodeURIComponent(v).toLowerCase())) return true;
      }
      return false;
    } catch (e) {
      const clean = url.split('#')[0].toLowerCase();
      return extPattern.test(clean);
    }
  }

  // بعض المواقع "تحمي" رابط التحميل الحقيقي بحيلة بسيطة: تخبّئه بعد # في الرابط
  // (مثال حقيقي: href="#https://cdn.example.com/file.rar") كطريقة بدائية لتعطيل
  // السحب المباشر البسيط. نكتشف هذه الحيلة ونطلع الرابط الحقيقي منها.
  function unwrapHashHidden(raw) {
    if (!raw) return null;
    const m = raw.match(/#(https?:\/\/[^\s"'#]+)/i);
    return m ? m[1] : null;
  }

  function tryAdd(rawValue) {
    if (!rawValue) return;
    // 1) الرابط المخفي بعد # (لو موجود) له أولوية لأنه الرابط الحقيقي المقصود
    const hidden = unwrapHashHidden(rawValue);
    if (hidden && hasDownloadExtension(hidden)) { downloadLinks.add(hidden); return; }

    // 2) الرابط العادي (بعد تحويله لرابط مطلق)
    try {
      const abs = new URL(rawValue, window.location.href).href;
      if (hasDownloadExtension(abs)) downloadLinks.add(abs);
    } catch (e) {}
  }

  // أ) روابط <a href> عادية — بنقرأ الـ attribute الخام (مش a.href المحسوبة) عشان
  //    نلتقط حيلة الإخفاء بعد # صح قبل ما المتصفح يفسرها كـ fragment عادي
  document.querySelectorAll('a[href]').forEach(a => tryAdd(a.getAttribute('href')));

  // ب) خاصية download الأصلية في HTML — إشارة أكيدة إن العنصر مقصود كرابط تحميل
  document.querySelectorAll('a[download]').forEach(a => tryAdd(a.getAttribute('href')));

  // ج) روابط مخبأة في data-attributes (أسلوب شائع لإخفاء الرابط الحقيقي عن السحب المباشر
  //    وتفعيله بجافاسكريبت عند الضغط فقط) — نقرأها مباشرة متجاوزين هذا الإخفاء
  ['data-url', 'data-href', 'data-download', 'data-file', 'data-link'].forEach(attr => {
    document.querySelectorAll('[' + attr + ']').forEach(el => tryAdd(el.getAttribute(attr)));
  });

  // د) روابط مكتوبة داخل onclick (مثال: onclick="location.href='file.zip'")
  document.querySelectorAll('[onclick]').forEach(el => {
    const code = el.getAttribute('onclick') || '';
    const matches = code.match(/https?:\/\/[^\s"')]+/gi);
    if (matches) matches.forEach(tryAdd);
  });

  return Array.from(downloadLinks);
}

function extractAllLinks(domain) {
  const links = new Set();
  document.querySelectorAll('a[href]').forEach(a => {
    try {
      const url = new URL(a.href, window.location.href);
      if (url.hostname === domain) {
        // إزالة الـ hash فقط (مع الحفاظ على الاستعلامات لأنها قد تمثل صفحات مختلفة)
        url.hash = '';
        links.add(url.href);
      }
    } catch (e) {}
  });
  return Array.from(links);
}

function filterMedia(extensions) {
  const found = new Set();

  const selectors = 'img, video, source, a, link, picture, [style*="background-image"]';
  document.querySelectorAll(selectors).forEach(el => {
    let urls = [];

    if (el.src) urls.push(el.src);
    if (el.href) urls.push(el.href);
    if (el.srcset) {
      el.srcset.split(',').forEach(s => urls.push(s.trim().split(' ')[0]));
    }

    const bgImage = window.getComputedStyle(el).backgroundImage;
    if (bgImage && bgImage !== 'none') {
      const match = bgImage.match(/url\(['"]?([^'"()]+)['"]?\)/);
      if (match) urls.push(match[1]);
    }

    urls.forEach(u => {
      try {
        const absoluteUrl = new URL(u, window.location.href).href;
        const cleanUrl = absoluteUrl.split('?')[0].split('#')[0].toLowerCase();
        if (extensions.some(ext => cleanUrl.endsWith('.' + ext))) {
          found.add(absoluteUrl);
        }
      } catch (e) {}
    });
  });

  return Array.from(found);
}

/**
 * جديد v5.0: استخراج ملفات CSS/JS الخاصة بالصفحة (روابط خارجية فقط)
 * تُستخدم لاحقاً لتحميلها فعلياً وربطها محلياً لنسخة تعمل أوفلاين بالكامل
 */
function extractAssets() {
  const css = new Set();
  const js = new Set();

  document.querySelectorAll('link[rel="stylesheet"][href]').forEach(link => {
    try { css.add(new URL(link.href, window.location.href).href); } catch (e) {}
  });

  document.querySelectorAll('script[src]').forEach(script => {
    try { js.add(new URL(script.src, window.location.href).href); } catch (e) {}
  });

  return { css: Array.from(css), js: Array.from(js) };
}

/**
 * جديد v5.0: تلميحات هيكلية بسيطة تساعد مستخرج القالب (في لوحة التحكم)
 * على التعرف على الأجزاء المتكررة (هيدر/فوتر/شريط جانبي) بدون نقل DOM كامل مرتين
 */
function extractStructureHints() {
  const hint = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.outerHTML : null;
  };
  return {
    header: hint('header') || hint('[role="banner"]') || hint('#header') || hint('.header'),
    footer: hint('footer') || hint('[role="contentinfo"]') || hint('#footer') || hint('.footer'),
    nav: hint('nav') || hint('[role="navigation"]') || hint('#nav') || hint('.nav') || hint('.navbar'),
    isBlogger: !!(document.querySelector('meta[name="generator"][content*="Blogger" i]') ||
      document.documentElement.getAttribute('xmlns:b') ||
      /blogspot\./i.test(window.location.hostname))
  };
}
