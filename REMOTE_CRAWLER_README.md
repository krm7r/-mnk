# Remote Crawler for Ultimate Web Scraper Pro

هذه إضافة Remote Worker إلى المشروع الحالي وليست إعادة كتابة للإضافة.

## الحدود المقصودة
- حتى 10 مواقع في تشغيل واحد.
- حتى 10 صفحات Chromium متزامنة كحد أقصى.
- حتى 5000 صفحة لكل موقع.
- Playwright + Chromium.
- Sitemap أولًا، ثم crawling للروابط الداخلية.
- HTML + النصوص + الصور/الفيديو/الملفات كروابط + CSS/JS assets.
- إعادة كتابة الروابط الداخلية إلى الملفات المحلية.
- ZIP + result.json كـGitHub Actions Artifacts.

## التشغيل
1. ارفع المشروع إلى GitHub.
2. افتح Actions → Ultimate Web Scraper - Remote Crawler.
3. اختر Run workflow.
4. ضع `sites_json` مثل:

```json
[{"url":"https://example.com","maxPages":5000,"concurrency":10},{"url":"https://example.org","maxPages":1000,"concurrency":5}]
```

لا يتم تشغيل أكثر من 10 صفحات Chromium متزامنة، ولا أكثر من 10 مواقع في التشغيل الواحد.

## ملاحظة Google Drive
الإضافة الحالية تستخدم Google Apps Script لرفع ZIP من المتصفح. هذا الـworker لا يرسل ZIP كبيرًا إلى Apps Script تلقائيًا لأن حجم طلب HTTP/base64 قد يصبح عنق زجاجة للمواقع الكبيرة. النتيجة الحالية تُحفظ كـGitHub Artifact. يمكن إضافة رفع Drive على شكل ملفات/أجزاء أو باستخدام Google Drive API resumable upload في مرحلة لاحقة دون تغيير محرك الـcrawler.
