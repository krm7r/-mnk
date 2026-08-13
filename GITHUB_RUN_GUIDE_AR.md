# تشغيل الـCrawler من GitHub فقط

لا تحتاج إلى تشغيل Chrome Extension ولا تعديل `crawler-config.mjs` لتشغيل هذه النسخة.

## الخطوات

1. ارفع المشروع كاملًا إلى GitHub Repository.
2. افتح تبويب **Actions**.
3. اختر **Ultimate Web Scraper - Remote Crawler**.
4. اضغط **Run workflow**.
5. اكتب رابط الموقع الأول في `site_1`.
6. اكتب رابط الموقع الثاني في `site_2` إذا أردت تشغيل موقعين في نفس العملية.
7. اترك `max_pages` على `5000` أو غيّره.
8. اترك `concurrency` على `10` أو قلله.
9. اضغط **Run workflow**.
10. بعد انتهاء العملية افتح الـRun نفسه وانزل إلى قسم **Artifacts**.
11. ستجد ZIP باسم `website-scrape-...` وتستطيع تنزيله.

## ماذا يفعل التشغيل؟

- موقع واحد أو موقعان في نفس الـRun.
- حتى 5,000 صفحة لكل موقع.
- حد أقصى إجمالي 10 صفحات Chromium تعمل في نفس الوقت.
- استخراج HTML والنصوص والروابط والوسائط وCSS وJS.
- إنشاء ZIP في `output/`.
- رفع ZIP تلقائيًا كـGitHub Actions Artifact تحت نفس العملية.
- رفع `result.json` كتقرير منفصل.

> لا تضع GitHub Token أو Google Drive credentials داخل ملفات المشروع. سيتم إضافة Google Drive لاحقًا باستخدام GitHub Secrets إذا احتجناه.
