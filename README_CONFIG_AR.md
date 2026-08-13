# التشغيل السهل

إذا كنت تريد تشغيل موقع أو موقعين بدون كتابة JSON في GitHub Actions، عدّل الملف:

`crawler-config.mjs`

ثم غيّر فقط:

- `sites[0].url` = الموقع الأول
- `sites[1].url` = الموقع الثاني
- `maxPagesPerSite` = أقصى صفحات
- `concurrency` = عدد صفحات Chromium المتزامنة، والحد الأقصى 10
- `include` = مسارات مسموحة فقط (اختياري)
- `exclude` = مسارات مستبعدة (اختياري)
- `downloadAssets` = تنزيل CSS/JS

بعد رفع المشروع إلى GitHub وتشغيل Workflow، سيقرأ الـRunner هذا الملف تلقائيًا.

> ملاحظة: رفع Google Drive لم يتم تفعيله في هذه المرحلة. يوجد مكان مخصص له داخل `crawler-config.mjs`، والأفضل لاحقًا وضع رابط الرفع كـGitHub Secret بدل وضع سر حقيقي داخل Git.
