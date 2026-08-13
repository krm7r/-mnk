import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { URL } from 'node:url';
import archiver from 'archiver';
import { chromium } from 'playwright';

const MAX_CONCURRENCY = Math.min(10, Math.max(1, Number(process.env.CONCURRENCY || 10)));
const MAX_SITES = Math.min(10, Math.max(1, Number(process.env.MAX_SITES || 10)));
const MAX_PAGES = Math.min(5000, Math.max(1, Number(process.env.MAX_PAGES || 5000)));
const WAIT_MS = Math.max(0, Number(process.env.WAIT_MS || 2500));
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.REQUEST_DELAY_MS || 150));
const RETRIES = Math.min(3, Math.max(0, Number(process.env.RETRIES || 2)));
const DOWNLOAD_ASSETS = String(process.env.DOWNLOAD_ASSETS ?? 'true').toLowerCase() === 'true';
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(process.cwd(), 'output');
const SITES_JSON = process.env.SITES_JSON || process.argv[2] || '[]';

function log(...a) { console.log(new Date().toISOString(), ...a); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function normalizeUrl(raw) {
  try { const u = new URL(raw); u.hash = ''; return u.href; } catch { return null; }
}
function sameHost(a, b) { try { return new URL(a).hostname === new URL(b).hostname; } catch { return false; } }
function inScope(url, include = [], exclude = []) {
  const s = url.toLowerCase();
  if (exclude.some(x => x && s.includes(x.toLowerCase().trim()))) return false;
  return include.length ? include.some(x => x && s.includes(x.toLowerCase().trim())) : true;
}
function safeName(url, isXml = false) {
  const u = new URL(url);
  let n = u.pathname === '/' ? 'index' : u.pathname.replace(/\//g, '_').replace(/^_/, '');
  n = n.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180) || 'index';
  const ext = isXml ? '.xml' : '.html';
  if (!n.toLowerCase().endsWith(ext)) n += ext;
  return n;
}
function uniqueFileName(base, used) {
  if (!used.has(base)) { used.add(base); return base; }
  const ext = path.extname(base), stem = base.slice(0, -ext.length);
  let i = 1, n = `${stem}_${i}${ext}`;
  while (used.has(n)) n = `${stem}_${++i}${ext}`;
  used.add(n); return n;
}

async function sitemapUrls(start, max = MAX_PAGES) {
  const origin = new URL(start).origin;
  const roots = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const seen = new Set(), found = new Set();
  async function walk(u, depth = 0) {
    if (depth > 3 || seen.has(u) || found.size >= max) return;
    seen.add(u);
    try {
      const r = await fetch(u, { redirect: 'follow' });
      if (!r.ok) return;
      const t = await r.text();
      const locs = [...t.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map(m => m[1].trim());
      const isIndex = /<sitemap(?:index)?\b/i.test(t) || /<sitemap>/i.test(t);
      for (const loc of locs) {
        if (found.size >= max) break;
        if (isIndex || /sitemap(?:[-_][^/]+)?\.xml(?:\?|$)/i.test(loc)) await walk(loc, depth + 1);
        else { const n = normalizeUrl(loc); if (n && sameHost(n, start)) found.add(n); }
      }
    } catch {}
  }
  for (const r of roots) await walk(r);
  return [...found].slice(0, max);
}

const EXTRACTOR = String.raw`(${function extractPageData() {
  const domain = window.location.hostname;
  const isXml = document.contentType.includes('xml') || ['rss','feed'].includes(document.documentElement.tagName.toLowerCase());
  const abs = (raw) => { try { return new URL(raw, window.location.href).href; } catch { return null; } };
  const links = new Set();
  document.querySelectorAll('a[href]').forEach(a => { const u = abs(a.href); if (u && new URL(u).hostname === domain) { const x = new URL(u); x.hash=''; links.add(x.href); } });
  const filterMedia = (exts) => {
    const found = new Set();
    document.querySelectorAll('img,video,source,a,link,picture,[style*="background-image"]').forEach(el => {
      const urls=[]; if(el.src)urls.push(el.src); if(el.href)urls.push(el.href);
      if(el.srcset)el.srcset.split(',').forEach(s=>urls.push(s.trim().split(/\s+/)[0]));
      const bg=getComputedStyle(el).backgroundImage; const m=bg&&bg.match(/url\(['"]?([^'"()]+)['"]?\)/); if(m)urls.push(m[1]);
      urls.forEach(x=>{const u=abs(x); if(!u)return; const clean=u.split('?')[0].split('#')[0].toLowerCase(); if(exts.some(e=>clean.endsWith('.'+e)))found.add(u);});
    }); return [...found];
  };
  const dlExt=['zip','rar','7z','tar','gz','bz2','xz','iso','exe','msi','msix','dmg','pkg','deb','rpm','apk','appimage','bin','jar','run'];
  const dlPattern=new RegExp('\\.('+dlExt.join('|')+')(?:$)','i');
  const downloads=new Set();
  const tryDl=(raw)=>{if(!raw)return; const hidden=String(raw).match(/#(https?:\/\/[^\s"'#]+)/i); const vals=hidden?[hidden[1]]:[raw]; for(const v of vals){const u=abs(v); if(!u)continue; const x=new URL(u); if(dlPattern.test(x.pathname)||[...x.searchParams.values()].some(q=>dlPattern.test(decodeURIComponent(q))))downloads.add(u);}};
  document.querySelectorAll('a[href],a[download]').forEach(a=>tryDl(a.getAttribute('href')));
  ['data-url','data-href','data-download','data-file','data-link'].forEach(attr=>document.querySelectorAll('['+attr+']').forEach(el=>tryDl(el.getAttribute(attr))));
  document.querySelectorAll('[onclick]').forEach(el=>{const m=(el.getAttribute('onclick')||'').match(/https?:\/\/[^\s"')]+/gi); if(m)m.forEach(tryDl);});
  const css=new Set(), js=new Set();
  document.querySelectorAll('link[rel="stylesheet"][href]').forEach(x=>{const u=abs(x.href);if(u)css.add(u)});
  document.querySelectorAll('script[src]').forEach(x=>{const u=abs(x.src);if(u)js.add(u)});
  const text=(document.body?.innerText||document.body?.textContent||'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  const hint=(sel)=>document.querySelector(sel)?.outerHTML||null;
  const structure={header:hint('header')||hint('[role="banner"]')||hint('#header')||hint('.header'),footer:hint('footer')||hint('[role="contentinfo"]')||hint('#footer')||hint('.footer'),nav:hint('nav')||hint('[role="navigation"]')||hint('#nav')||hint('.nav')||hint('.navbar'),isBlogger:!!(document.querySelector('meta[name="generator"][content*="Blogger" i]')||document.documentElement.getAttribute('xmlns:b')||/blogspot\./i.test(location.hostname))};
  return {html:isXml?new XMLSerializer().serializeToString(document):document.documentElement.outerHTML,title:document.title||'page_content',url:location.href,domain,isXml,links:[...links],directDownloads:[...downloads],media:{images:filterMedia(['jpg','jpeg','png','gif','webp','svg','ico','bmp','tiff','avif','heic']),videos:filterMedia(['mp4','webm','ogv','avi','mov','wmv','flv','mkv','mpeg','3gp']),files:filterMedia(['pdf','zip','rar','exe','apk','docx','xlsx','pptx','iso','dmg','7z','tar','gz']),xml:filterMedia(['xml','rss','atom'])},assets:{css:[...css],js:[...js]},structure,text};
}})()`;

async function extract(page) {
  return page.evaluate(EXTRACTOR);
}

async function fetchAsset(context, url) {
  try {
    const r = await context.request.get(url, { timeout: 30000, failOnStatusCode: false });
    if (!r.ok()) return null;
    return { buffer: await r.body(), contentType: r.headers()['content-type'] || '' };
  } catch { return null; }
}

class Semaphore {
  constructor(n) { this.n=n; this.q=[]; }
  async acquire(){ if(this.n>0){this.n--;return;} await new Promise(r=>this.q.push(r)); }
  release(){ const r=this.q.shift(); if(r)r(); else this.n++; }
  async run(fn){await this.acquire();try{return await fn();}finally{this.release();}}
}

async function crawlSite(browser, spec, siteIndex, globalSem) {
  const start = normalizeUrl(spec.url); if (!start) throw new Error(`Invalid URL: ${spec.url}`);
  const maxPages = Math.min(MAX_PAGES, Number(spec.maxPages || MAX_PAGES));
  const include = Array.isArray(spec.include) ? spec.include : String(spec.include||'').split(',').filter(Boolean);
  const exclude = Array.isArray(spec.exclude) ? spec.exclude : String(spec.exclude||'').split(',').filter(Boolean);
  const concurrency = Math.min(10, Math.max(1, Number(spec.concurrency || MAX_CONCURRENCY)));
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const queue = [], queued = new Set(), visited = new Set(), pages = [], assets = {css:new Set(),js:new Set()};
  const media = {images:new Set(),videos:new Set(),files:new Set(),xml:new Set(),directDownloads:new Set()};
  const urlToFile = {}, usedNames = new Set(), structureSamples=[];
  const sem = { run: fn => globalSem.run(fn) };
  const stats={siteIndex,url:start,pages:0,discovered:0,failed:0};
  const enqueue = u => { const n=normalizeUrl(u); if(!n||visited.has(n)||queued.has(n)||queue.length>=maxPages||!sameHost(n,start)||!inScope(n,include,exclude))return false; queued.add(n); queue.push(n); return true; };
  const sm = await sitemapUrls(start,maxPages); sm.forEach(enqueue); if(!queued.has(start)) enqueue(start);
  log(`[site ${siteIndex}] discovered ${queue.length} URLs`);
  const crawlOne = async url => sem.run(async()=>{
    let ok=false;
    for(let attempt=0;attempt<=RETRIES&&!ok;attempt++){
      const page=await context.newPage();
      try{
        await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
        if(WAIT_MS) await page.waitForTimeout(WAIT_MS);
        const res=await extract(page);
        const finalUrl=normalizeUrl(res.url)||url;
        const fn=uniqueFileName(safeName(finalUrl,res.isXml),usedNames); urlToFile[finalUrl]=fn;
        pages.push({url:finalUrl,fileName:fn,isXml:res.isXml,html:res.html,text:res.text});
        res.links.forEach(enqueue);
        for(const k of Object.keys(media)) (res.media[k]||[]).forEach(x=>media[k].add(x));
        res.directDownloads.forEach(x=>media.directDownloads.add(x));
        res.assets.css.forEach(x=>assets.css.add(x)); res.assets.js.forEach(x=>assets.js.add(x));
        if(structureSamples.length<40)structureSamples.push({url:finalUrl,...res.structure});
        visited.add(url); stats.pages=pages.length; stats.discovered=queue.length; ok=true;
      }catch(e){if(attempt===RETRIES){stats.failed++;log(`[site ${siteIndex}] failed ${url}: ${e.message}`)}}finally{await page.close();}
    }
  });
  while(queue.length && pages.length < maxPages){
    const batch=[];
    while(queue.length && batch.length<concurrency && pages.length+batch.length<maxPages) batch.push(queue.shift());
    await Promise.all(batch.map(crawlOne));
    if(REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
  }
  const assetMap={}; const assetFiles={};
  if(DOWNLOAD_ASSETS && (spec.downloadAssets ?? true)){
    const all=[...assets.css,...assets.js]; let ai=0;
    const assetUsed = new Set();
    await Promise.all(all.map(u=>sem.run(async()=>{const a=await fetchAsset(context,u); if(!a)return; let base=path.basename(new URL(u).pathname).replace(/[^a-zA-Z0-9._-]+/g,'_')||'asset'; if(!/[.]\w+$/.test(base))base += /\.css(?:$|\?)/i.test(u)?'.css':'.js'; const fn=uniqueFileName(base,assetUsed); assetMap[u]=fn; assetFiles[fn]=a.buffer; ai++; if(ai%10===0)log(`[site ${siteIndex}] assets ${ai}/${all.length}`);}))); 
  }
  for(const p of pages){let h=p.html; for(const [u,f] of Object.entries(urlToFile))h=h.split(u).join(f); for(const [u,f] of Object.entries(assetMap))h=h.split(u).join('assets/'+f); p.htmlOffline=h;}
  await context.close();
  return {start,domain:new URL(start).hostname,pages,media:{images:[...media.images],videos:[...media.videos],files:[...media.files],xml:[...media.xml],directDownloads:[...media.directDownloads]},assetFiles,allUrls:[...new Set([...visited,...queued])],structureSamples,stats};
}

async function makeZip(results, outPath){
  await fs.mkdir(path.dirname(outPath),{recursive:true});
  return new Promise((resolve,reject)=>{
    const out=fsSync.createWriteStream(outPath); const archive=archiver('zip',{zlib:{level:6}});
    out.on('close',()=>resolve(archive.pointer())); archive.on('error',reject); archive.pipe(out);
    for(const r of results){const folder=r.domain.replace(/[^a-zA-Z0-9._-]/g,'_'); for(const p of r.pages)archive.append(p.htmlOffline||p.html||'',{name:`${folder}/${p.fileName}`}); for(const [fn,b] of Object.entries(r.assetFiles))archive.append(b,{name:`${folder}/assets/${fn}`}); const combined=r.pages.filter(p=>p.text).map(p=>`\n\n=== ${p.url} ===\n\n${p.text}`).join(''); archive.append(combined,{name:`${folder}/all_text_combined.txt`}); archive.append(`Images:\n${r.media.images.join('\n')}\n\nVideos:\n${r.media.videos.join('\n')}\n\nFiles:\n${r.media.files.join('\n')}\n\nDownloads:\n${r.media.directDownloads.join('\n')}`,{name:`${folder}/media_links.txt`}); }
    archive.append(JSON.stringify(results.map(r=>({domain:r.domain,start:r.start,stats:r.stats,pages:r.pages.length,media:r.media})),null,2),{name:'crawl_report.json'}); archive.finalize();
  });
}

async function main(){
  const parsed=JSON.parse(SITES_JSON); const sites=Array.isArray(parsed)?parsed:parsed.sites; if(!Array.isArray(sites)||!sites.length)throw new Error('SITES_JSON must contain at least one site'); if(sites.length>MAX_SITES)throw new Error(`Maximum ${MAX_SITES} sites per run`);
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  const browser=await chromium.launch({headless:true});
  const globalSem = new Semaphore(MAX_CONCURRENCY);
  const results=[];
  try{
    let next=0; const siteWorkers=Array.from({length:Math.min(MAX_SITES,sites.length)},async()=>{while(true){const i=next++;if(i>=sites.length)return;try{results[i]=await crawlSite(browser,sites[i],i+1,globalSem);}catch(e){results[i]={start:sites[i].url,domain:'unknown',pages:[],assetFiles:{},media:{images:[],videos:[],files:[],xml:[],directDownloads:[]},stats:{error:e.message}};log(`[site ${i+1}] ERROR ${e.message}`);}}});
    await Promise.all(siteWorkers);
  } finally {await browser.close();}
  const zip=path.join(OUTPUT_DIR,`scrape_${Date.now()}.zip`); const bytes=await makeZip(results,zip); await fs.writeFile(path.join(OUTPUT_DIR,'result.json'),JSON.stringify(results,null,2)); log(`DONE ${bytes} bytes -> ${zip}`);
}
main().catch(e=>{console.error(e);process.exit(1)});
