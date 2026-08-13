# Ultimate Web Scraper Remote v7.2

نسخة GitHub Actions من محرك السحب، مبنية على وظائف الإضافة الأصلية v6.6، لكن بدون الاعتماد على Chrome Extension APIs.

## ما الذي يحفظه؟

- HTML للصفحات بعد تنفيذ JavaScript الأساسي في Chromium.
- روابط الموقع الداخلية مع crawling عبر sitemap أو BFS.
- CSS وJavaScript.
- الصور وsrcset وposter وOG images.
- فيديو/صوت عند تفعيل الخيار.
- الخطوط.
- PDF/ZIP/RAR/DOCX/XLSX/PPTX/CSV وغيرها من الملفات المباشرة عند تفعيل الخيار.
- XML/RSS/Atom.
- background-image وموارد CSS url().
- نص الصفحة.
- روابط وتحليل لكل موقع.
- إعادة كتابة روابط HTML وCSS إلى الملفات المحلية التي تم تنزيلها.
- تشغيل موقعين في نفس الـRun.
- حد إجمالي للتزامن من 1 إلى 10 صفحات Chromium.
- حتى 5000 صفحة لكل موقع.
- retries وwait وinclude/exclude.

## التشغيل

GitHub → Actions → Ultimate Web Scraper - Full Offline Site → Run workflow.

بعد انتهاء الـRun، ستجد ZIP في Artifacts.

## ملاحظة مهمة

النسخة المحلية ليست ضمانًا أن كل موقع سيعمل 100% دون إنترنت. المواقع التي تعتمد على Backend/API، تسجيل الدخول، قواعد البيانات، الدفع، WebSockets أو خدمات خارجية تحتاج خادمًا أو محاكاة للخدمات الخلفية. هذه الأداة تحفظ واجهة الصفحة والموارد التي يمكن التقاطها وتنزيلها، وتعيد ربطها محليًا قدر الإمكان.
