import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const ROOT = path.resolve(process.env.OUTPUT_DIR || 'output');
const INPUT = {
  site1: process.env.SITE_1 || '',
  site2: process.env.SITE_2 || '',
  maxPages: clampInt(process.env.MAX_PAGES, 5000, 1, 5000),
  concurrency: clampInt(process.env.CONCURRENCY, 10, 1, 10),
  waitMs: clampInt(process.env.WAIT_MS, 1200, 0, 15000),
  retryCount: clampInt(process.env.RETRIES, 2, 0, 5),
  timeoutMs: clampInt(process.env.TIMEOUT_MS, 45000, 5000, 120000),
  downloadImages: envBool('DOWNLOAD_IMAGES', true),
  downloadVideos: envBool('DOWNLOAD_VIDEOS', true),
  downloadFiles: envBool('DOWNLOAD_FILES', true),
  downloadCss: envBool('DOWNLOAD_CSS', true),
  downloadJs: envBool('DOWNLOAD_JS', true),
  downloadFonts: envBool('DOWNLOAD_FONTS', true),
  downloadXml: envBool('DOWNLOAD_XML', true),
  downloadOtherAssets: envBool('DOWNLOAD_OTHER_ASSETS', true),
  maxAssetMB: clampInt(process.env.MAX_ASSET_MB, 100, 1, 500),
  include: splitCsv(process.env.INCLUDE),
  exclude: splitCsv(process.env.EXCLUDE)
};

const sites = [INPUT.site1, INPUT.site2].map(s => normalizeUrl(s)).filter(Boolean);
if (!sites.length) throw new Error('ضع SITE_1 على الأقل.');

await fs.rm(ROOT, { recursive: true, force: true });
await fs.mkdir(ROOT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const globalLimiter = createSemaphore(INPUT.concurrency);
const global = {
  startedAt: new Date().toISOString(),
  pages: 0,
  savedResources: 0,
  failed: 0,
  sites: []
};

try {
  const results = await Promise.all(sites.map(siteUrl => crawlSite(siteUrl)));
  global.sites.push(...results);
} finally {
  await browser.close();
}

global.finishedAt = new Date().toISOString();
await writeJson(path.join(ROOT, 'crawl_report.json'), global);
await fs.writeFile(path.join(ROOT, 'README_OFFLINE.txt'), makeReadme(global), 'utf8');
console.log(JSON.stringify(global, null, 2));

async function crawlSite(startUrl) {
  const origin = new URL(startUrl).origin;
  const siteHost = new URL(startUrl).hostname;
  const siteKey = safeName(siteHost);
  const siteRoot = path.join(ROOT, 'sites', siteKey);
  const dirs = {
    pages: path.join(siteRoot, 'pages'),
    assets: path.join(siteRoot, 'assets'),
    media: path.join(siteRoot, 'media'),
    files: path.join(siteRoot, 'files'),
    metadata: path.join(siteRoot, 'metadata'),
    texts: path.join(siteRoot, 'texts')
  };
  await Promise.all(Object.values(dirs).map(d => fs.mkdir(d, { recursive: true })));

  const urlMap = new Map();
  const resourceMap = new Map();
  const cssFiles = new Map();
  const queue = [];
  const queued = new Set();
  const visited = new Set();
  const failed = [];
  const linksFound = new Set();
  const pageRecords = [];
  let active = 0;
  let stopped = false;

  const inScope = (u) => {
    try {
      const x = new URL(u);
      if (x.hostname !== siteHost) return false;
      const clean = canonicalUrl(x.href);
      if (INPUT.exclude.some(v => clean.toLowerCase().includes(v.toLowerCase()))) return false;
      if (INPUT.include.length && !INPUT.include.some(v => clean.toLowerCase().includes(v.toLowerCase()))) return false;
      return true;
    } catch { return false; }
  };

  const enqueue = (u) => {
    if (!u || visited.has(u) || queued.has(u) || queue.length + visited.size >= INPUT.maxPages) return;
    if (!inScope(u)) return;
    queued.add(u);
    queue.push(u);
  };

  enqueue(startUrl);
  for (const u of await getSitemapUrls(startUrl, INPUT.maxPages)) enqueue(u);

  // If sitemap populated the queue, still crawl each page and discover additional internal links.
  // If it did not, normal BFS discovery takes over.
  while (!stopped) {
    while (active < INPUT.concurrency && queue.length && visited.size + active < INPUT.maxPages) {
      const url = queue.shift();
      queued.delete(url);
      if (visited.has(url)) continue;
      visited.add(url);
      active++;
      processPageWithGlobalLimit(url).finally(() => { active--; }).catch(() => {});
    }

    if (!queue.length && active === 0) break;
    await sleep(80);
  }

  // Final rewrite pass: page HTML and CSS now know the complete URL -> local file mapping.
  for (const record of pageRecords) {
    const html = await fs.readFile(record.absolutePath, 'utf8');
    const rewritten = rewriteHtml(html, record.url, record.siteRel, urlMap, resourceMap);
    await fs.writeFile(record.absolutePath, rewritten, 'utf8');
    if (record.text) {
      const txtName = record.fileName.replace(/\.(html|xhtml|xml)$/i, '') + '.txt';
      await fs.writeFile(path.join(dirs.texts, txtName), record.text, 'utf8');
    }
  }

  for (const [cssPath, meta] of cssFiles) {
    try {
      const css = await fs.readFile(cssPath, 'utf8');
      const cssSiteRel = path.relative(siteRoot, cssPath).replaceAll(path.sep, '/');
      const rewritten = rewriteCss(css, meta.url, cssSiteRel, resourceMap);
      await fs.writeFile(cssPath, rewritten, 'utf8');
    } catch {}
  }

  const report = {
    site: startUrl,
    origin,
    pages: pageRecords.length,
    linksFound: linksFound.size,
    resources: resourceMap.size,
    failed,
    pageMap: Object.fromEntries(urlMap),
    resourceMap: Object.fromEntries(resourceMap),
    generatedAt: new Date().toISOString()
  };
  await writeJson(path.join(dirs.metadata, 'site_report.json'), report);
  await fs.writeFile(path.join(dirs.metadata, 'all_links.txt'), [...linksFound].sort().join('\n'), 'utf8');

  global.pages += pageRecords.length;
  global.savedResources += resourceMap.size;
  global.failed += failed.length;

  return report;

  async function processPageWithGlobalLimit(url) {
    const release = await globalLimiter.acquire();
    try { return await processPage(url); } finally { release(); }
  }

  async function processPage(url) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      serviceWorkers: 'allow',
      viewport: { width: 1365, height: 900 }
    });
    const page = await context.newPage();
    const responsePromises = new Map();
    const pageResourceUrls = new Set();

    const onResponse = async (response) => {
      try {
        const rurl = canonicalUrl(response.url());
        if (!rurl || rurl.startsWith('data:') || rurl.startsWith('blob:')) return;
        const req = response.request();
        const type = req.resourceType();
        const contentType = (response.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
        pageResourceUrls.add(rurl);
        if (!shouldSaveResource(rurl, type, contentType)) return;
        const p = saveResponse(response, rurl, type, contentType);
        responsePromises.set(rurl, p);
      } catch {}
    };
    page.on('response', onResponse);

    try {
      let loaded = false;
      for (let attempt = 0; attempt <= INPUT.retryCount && !loaded; attempt++) {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: INPUT.timeoutMs });
          loaded = true;
        } catch (e) {
          if (attempt === INPUT.retryCount) throw e;
          await sleep(800 * (attempt + 1));
        }
      }

      await sleep(INPUT.waitMs);
      try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
      // Small lazy-load trigger: scroll progressively so lazy images/resources appear in network capture.
      await autoScroll(page);
      await sleep(Math.min(INPUT.waitMs, 1500));

      const extracted = await page.evaluate(() => {
        const abs = (v) => { try { return new URL(v, location.href).href; } catch { return null; } };
        const set = new Set();
        const media = new Set();
        const assets = new Set();
        const push = (v, bucket = set) => { const u = abs(v); if (u) bucket.add(u); };
        document.querySelectorAll('a[href], link[href], script[src], img[src], video[src], source[src], iframe[src], object[data], embed[src], input[src], track[src], image[href], image[xlink\:href]').forEach(el => {
          ['href','src','data','xlink:href','poster'].forEach(a => { if (el.getAttribute(a)) push(el.getAttribute(a), set); });
          if (el.getAttribute('src')) push(el.getAttribute('src'), media);
        });
        document.querySelectorAll('[srcset]').forEach(el => el.getAttribute('srcset').split(',').forEach(x => push(x.trim().split(/\s+/)[0], media)));
        document.querySelectorAll('[style]').forEach(el => { const s = el.getAttribute('style') || ''; for (const m of s.matchAll(/url\((?:"|')?([^"')]+)(?:"|')?\)/gi)) push(m[1], media); });
        for (const el of document.querySelectorAll('a[href]')) push(el.getAttribute('href'));
        for (const el of document.querySelectorAll('link[rel="stylesheet"][href], script[src], link[rel*="icon"][href]')) {
          push(el.getAttribute('href') || el.getAttribute('src'), assets);
        }
        document.querySelectorAll('meta[property="og:image"][content], meta[name="twitter:image"][content]').forEach(el => push(el.getAttribute('content'), media));
        const text = document.body?.innerText || document.body?.textContent || '';
        return { links: [...set], media: [...media], assets: [...assets], html: document.documentElement.outerHTML, text };
      });

      for (const u of extracted.links) if (inScope(u)) { linksFound.add(u); enqueue(u); }
      for (const u of [...extracted.media, ...extracted.assets]) pageResourceUrls.add(canonicalUrl(u));
      for (const u of pageResourceUrls) await waitResource(responsePromises.get(u));

      // Fetch important URLs not requested by the browser (lazy assets, CSS URLs, file links) with the same context cookies.
      const candidates = [...new Set([...extracted.media, ...extracted.assets])];
      for (const u of candidates) {
        if (resourceMap.has(u) || !shouldSaveCandidate(u)) continue;
        await downloadUrl(u, context);
      }

      const fileName = pageFileName(url);
      const absolutePath = path.join(dirs.pages, fileName);
      await fs.writeFile(absolutePath, extracted.html, 'utf8');
      urlMap.set(canonicalUrl(url), path.relative(path.dirname(absolutePath), absolutePath).replaceAll(path.sep, '/'));
      pageRecords.push({ url, fileName, absolutePath, siteRel: path.relative(siteRoot, absolutePath).replaceAll(path.sep, '/'), text: extracted.text });

      // Direct-download links: retain them in the site report and download when configured.
      const direct = extracted.links.filter(isDownloadUrl);
      for (const u of direct) {
        linksFound.add(u);
        if (INPUT.downloadFiles) await downloadUrl(u, context);
      }
      console.log(`[${siteKey}] ${pageRecords.length}/${INPUT.maxPages} ${url}`);
    } catch (e) {
      failed.push({ url, error: String(e?.message || e) });
      console.log(`[${siteKey}] FAILED ${url}: ${e?.message || e}`);
    } finally {
      page.off('response', onResponse);
      await context.close();
    }
  }

  async function saveResponse(response, rurl, resourceType, contentType) {
    if (resourceMap.has(rurl)) return resourceMap.get(rurl);
    const maxBytes = INPUT.maxAssetMB * 1024 * 1024;
    try {
      const body = await response.body();
      if (body.byteLength > maxBytes) return null;
      const local = resourceFilePath(rurl, resourceType, contentType, dirs);
      await fs.mkdir(path.dirname(local.absolutePath), { recursive: true });
      await fs.writeFile(local.absolutePath, body);
      const rel = path.relative(siteRoot, local.absolutePath).replaceAll(path.sep, '/');
      resourceMap.set(rurl, rel);
      if (isCss(rurl, contentType)) cssFiles.set(local.absolutePath, { url: rurl });
      return rel;
    } catch { return null; }
  }

  async function downloadUrl(u, context) {
    const url = canonicalUrl(u);
    if (!url || resourceMap.has(url) || !shouldSaveCandidate(url)) return;
    try {
      const resp = await context.request.get(url, { timeout: INPUT.timeoutMs, failOnStatusCode: false });
      const ct = (resp.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!resp.ok()) return;
      const body = await resp.body();
      if (body.byteLength > INPUT.maxAssetMB * 1024 * 1024) return;
      const local = resourceFilePath(url, 'other', ct, dirs);
      await fs.mkdir(path.dirname(local.absolutePath), { recursive: true });
      await fs.writeFile(local.absolutePath, body);
      const rel = path.relative(siteRoot, local.absolutePath).replaceAll(path.sep, '/');
      resourceMap.set(url, rel);
      if (isCss(url, ct)) cssFiles.set(local.absolutePath, { url });
    } catch {}
  }
}

function shouldSaveResource(url, type, contentType) {
  if (type === 'document') return false;
  if (type === 'stylesheet') return INPUT.downloadCss;
  if (type === 'script') return INPUT.downloadJs;
  if (type === 'font') return INPUT.downloadFonts;
  if (type === 'image') return INPUT.downloadImages;
  if (type === 'media') return INPUT.downloadVideos;
  if (/xml|rss|atom/.test(contentType) || /\.(xml|rss|atom)(?:$|[?#])/i.test(url)) return INPUT.downloadXml;
  if (isDownloadUrl(url)) return INPUT.downloadFiles;
  return INPUT.downloadOtherAssets;
}

function shouldSaveCandidate(url) {
  if (/^(javascript:|mailto:|tel:|data:|blob:)/i.test(url)) return false;
  if (isDownloadUrl(url)) return INPUT.downloadFiles;
  if (/\.(mp4|webm|mov|mkv|avi|m4v|mp3|wav|ogg|flac)(?:$|[?#])/i.test(url)) return INPUT.downloadVideos;
  if (/\.(css)(?:$|[?#])/i.test(url)) return INPUT.downloadCss;
  if (/\.(js|mjs)(?:$|[?#])/i.test(url)) return INPUT.downloadJs;
  if (/\.(woff2?|ttf|otf|eot)(?:$|[?#])/i.test(url)) return INPUT.downloadFonts;
  if (/\.(jpe?g|png|gif|webp|svg|ico|bmp|tiff?|avif|heic)(?:$|[?#])/i.test(url)) return INPUT.downloadImages;
  return INPUT.downloadOtherAssets;
}

function resourceFilePath(url, type, contentType, dirs) {
  const u = new URL(url);
  const ext = extensionFor(u.pathname, contentType, type);
  const raw = u.pathname.split('/').pop() || `resource-${hash(url).slice(0,10)}`;
  let base = safeName(raw.replace(/\.[^.]+$/, '')) || 'resource';
  const name = `${base}-${hash(url).slice(0,8)}${ext}`;
  let folder = 'assets';
  if (type === 'image' || /image\//.test(contentType)) folder = 'media/images';
  else if (type === 'media' || /^(video|audio)\//.test(contentType)) folder = 'media/video';
  else if (isDownloadUrl(url) || /application\/(pdf|zip|x-rar|x-7z|octet-stream)/.test(contentType)) folder = 'files';
  else if (type === 'font' || /font\//.test(contentType)) folder = 'assets/fonts';
  else if (type === 'stylesheet' || /text\/css/.test(contentType) || ext === '.css') folder = 'assets/css';
  else if (type === 'script' || /javascript/.test(contentType) || ext === '.js') folder = 'assets/js';
  return { absolutePath: path.join(dirs[folder.split('/')[0]], ...folder.split('/').slice(1), `${name}`) };
}

function rewriteHtml(html, pageUrl, pageSiteRel, urlMap, resourceMap) {
  let out = html;
  const replaceUrl = (u) => {
    try {
      const abs = canonicalUrl(new URL(u, pageUrl).href);
      const local = resourceMap.get(abs) || urlMap.get(abs);
      if (!local) return u;
      const fromDir = path.posix.dirname(pageSiteRel);
      return path.posix.relative(fromDir, local).replace(/^\.\//, '') || path.posix.basename(local);
    } catch { return u; }
  };
  // Attribute URLs.
  out = out.replace(/(src|href|poster|data|action|xlink:href)=(['"])(.*?)\2/gi, (m, attr, q, value) => `${attr}=${q}${replaceUrl(value)}${q}`);
  // srcset.
  out = out.replace(/(srcset)=(['"])(.*?)\2/gi, (m, attr, q, value) => {
    const v = value.split(',').map(item => {
      const parts = item.trim().split(/\s+/); if (!parts[0]) return item; parts[0] = replaceUrl(parts[0]); return parts.join(' ');
    }).join(', ');
    return `${attr}=${q}${v}${q}`;
  });
  // Inline CSS url().
  out = out.replace(/url\((['"]?)([^'"\)]+)\1\)/gi, (m, q, value) => `url(${q}${replaceUrl(value)}${q})`);
  return out;
}

function rewriteCss(css, cssUrl, cssSiteRel, resourceMap) {
  return css.replace(/url\((['"]?)([^'"\)]+)\1\)/gi, (m, q, value) => {
    try {
      const abs = canonicalUrl(new URL(value, cssUrl).href);
      const local = resourceMap.get(abs);
      const fromDir = path.posix.dirname(cssSiteRel);
      const rel = local ? path.posix.relative(fromDir, local).replace(/^\.\//, '') : value;
      return `url(${q}${rel || path.posix.basename(local || value)}${q})`;
    } catch { return m; }
  }).replace(/@import\s+(?:url\()?(['"])(.*?)\1/gi, (m, q, value) => {
    try {
      const abs = canonicalUrl(new URL(value, cssUrl).href);
      const local = resourceMap.get(abs);
      if (!local) return m;
      const fromDir = path.posix.dirname(cssSiteRel);
      const rel = path.posix.relative(fromDir, local).replace(/^\.\//, '') || path.posix.basename(local);
      return m.replace(value, rel);
    } catch { return m; }
  });
}

async function getSitemapUrls(startUrl, max) {
  const origin = new URL(startUrl).origin;
  const candidates = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const found = new Set();
  const seen = new Set();
  async function visit(sm, depth = 0) {
    if (depth > 3 || seen.has(sm) || found.size >= max) return;
    seen.add(sm);
    try {
      const r = await fetch(sm, { redirect: 'follow' });
      if (!r.ok) return;
      const t = await r.text();
      const locs = [...t.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(m => m[1].trim());
      const isIndex = /<sitemapindex/i.test(t);
      for (const loc of locs) {
        if (isIndex || /\.xml(?:$|[?#])/i.test(loc)) await visit(loc, depth + 1);
        else if (normalizeUrl(loc)) found.add(canonicalUrl(loc));
        if (found.size >= max) break;
      }
    } catch {}
  }
  for (const c of candidates) await visit(c);
  return [...found].slice(0, max);
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let y = 0; const step = Math.max(400, Math.floor(innerHeight * 0.8)); const timer = setInterval(() => {
        y += step; scrollTo(0, y);
        if (y >= document.body.scrollHeight) { clearInterval(timer); scrollTo(0, 0); resolve(); }
      }, 100);
      setTimeout(() => { clearInterval(timer); resolve(); }, 8000);
    });
  }).catch(() => {});
}

function resourceTypeFromContentType(ct) {
  if (/^text\/css/.test(ct)) return 'stylesheet';
  if (/javascript/.test(ct)) return 'script';
  if (/^image\//.test(ct)) return 'image';
  if (/^(video|audio)\//.test(ct)) return 'media';
  if (/font/.test(ct)) return 'font';
  return 'other';
}

function extensionFor(p, ct, type) {
  const ext = path.extname(p).toLowerCase();
  if (ext && ext.length <= 8) return ext;
  if (/css/.test(ct) || type === 'stylesheet') return '.css';
  if (/javascript/.test(ct) || type === 'script') return '.js';
  if (/html/.test(ct)) return '.html';
  if (/json/.test(ct)) return '.json';
  if (/xml/.test(ct)) return '.xml';
  if (/png/.test(ct)) return '.png';
  if (/jpeg/.test(ct)) return '.jpg';
  if (/webp/.test(ct)) return '.webp';
  if (/svg/.test(ct)) return '.svg';
  if (/woff2/.test(ct)) return '.woff2';
  if (/woff/.test(ct)) return '.woff';
  return '.bin';
}

function pageFileName(url) {
  const u = new URL(url);
  let p = decodeURIComponent(u.pathname).replace(/^\/+|\/+$/g, '');
  if (!p) return `index-${hash(url).slice(0,8)}.html`;
  p = p.replace(/\.(html?|php|aspx?|jsp)$/i, '');
  return `${safeName(p.replace(/\//g, '__')) || 'page'}-${hash(url).slice(0,8)}.html`;
}

function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    return u.href;
  } catch { return ''; }
}
function normalizeUrl(raw) { return raw ? canonicalUrl(raw.trim()) : ''; }
function isDownloadUrl(u) { return /\.(zip|rar|7z|tar|gz|bz2|xz|iso|exe|msi|msix|dmg|pkg|deb|rpm|apk|appimage|bin|jar|pdf|docx|xlsx|pptx|csv)(?:$|[?#])/i.test(u); }
function isCss(u, ct='') { return /\.css(?:$|[?#])/i.test(u) || /text\/css/i.test(ct); }
function safeName(s) { return String(s).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'file'; }
function hash(s) { return crypto.createHash('sha1').update(s).digest('hex'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function splitCsv(v) { return String(v || '').split(',').map(x => x.trim()).filter(Boolean); }
function envBool(k, fallback) { const v = process.env[k]; return v == null ? fallback : /^(1|true|yes|on)$/i.test(v); }
function clampInt(v, fallback, min, max) { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; }
function createSemaphore(limit) {
  let active = 0;
  const waiters = [];
  return {
    acquire() {
      return new Promise(resolve => {
        const grant = () => {
          active++;
          resolve(() => {
            active--;
            const next = waiters.shift();
            if (next) next();
          });
        };
        if (active < limit) grant(); else waiters.push(grant);
      });
    }
  };
}
async function waitResource(p) { if (p) try { await p; } catch {} }
async function writeJson(file, data) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8'); }
function makeReadme(report) {
  return `Ultimate Web Scraper Remote v7.2\n\nتم إنشاء نسخة محلية من الصفحات والموارد التي أمكن تنزيلها.\n\nالمحتويات:\n- pages/: صفحات HTML محفوظة بعد التحميل والتنفيذ.\n- assets/: CSS/JS/fonts وغيرها.\n- media/: صور وفيديو وصوت.\n- files/: ملفات وروابط تنزيل مباشرة عندما كانت قابلة للتنزيل.\n- texts/: نص الصفحة لكل صفحة.\n- metadata/: الخرائط والتقارير والروابط.\n\nملاحظة: المواقع التي تعتمد على Backend/API/تسجيل دخول/جلسات/خدمات خارجية قد لا تعمل 100% دون اتصال، حتى لو تم حفظ ملفات الواجهة؛ النسخة المحلية تعيد بناء الموارد التي تم التقاطها وتنزيلها ولا تحول خادم الموقع إلى خادم محلي.\n\nالمواقع: ${report.sites.length}\nالصفحات: ${report.pages}\nالموارد: ${report.savedResources}\n`;
}
