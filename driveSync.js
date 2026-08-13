// ============================================================
// driveSync.js — رفع الملفات لـ Google Drive عبر Apps Script
// أضف هذا الملف لمجلد الإضافة وأضفه في sidepanel.html قبل sidepanel.js
// ============================================================

const DRIVE_CFG_KEY = 'drive_script_url';

// ── جلب الرابط المحفوظ ──
async function getDriveUrl() {
  const s = await chrome.storage.local.get(DRIVE_CFG_KEY);
  return s[DRIVE_CFG_KEY] || '';
}

// ── حفظ الرابط ──
async function saveDriveUrl(url) {
  await chrome.storage.local.set({ [DRIVE_CFG_KEY]: url });
}

// ── اختبار الاتصال ──
async function testDriveConnection(url) {
  try {
    const r = await fetch(url);
    const d = await r.json();
    return d.ok ? { ok: true } : { ok: false, error: d.message };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── رفع ملف ZIP (base64) ──
async function uploadZipToDrive(zipBlob, fileName, domain) {
  const url = await getDriveUrl();
  if (!url) throw new Error('لم يتم ضبط رابط Drive Script في الإعدادات');

  // تحويل Blob → base64
  const base64 = await blobToBase64(zipBlob);

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'zip',
      name: fileName,
      content: base64,
      isBase64: true,
      domain: domain || 'scraper'
    })
  });

  const data = await resp.json();
  if (!data.ok) throw new Error(data.error || 'فشل الرفع');
  return data; // { fileId, fileName, viewUrl, folder }
}

// ── رفع ملف نصي (TXT / XML) ──
async function uploadTextToDrive(text, fileName, domain, type) {
  const url = await getDriveUrl();
  if (!url) throw new Error('لم يتم ضبط رابط Drive Script في الإعدادات');

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: type || 'txt',
      name: fileName,
      content: text,
      isBase64: false,
      domain: domain || 'scraper'
    })
  });

  const data = await resp.json();
  if (!data.ok) throw new Error(data.error || 'فشل الرفع');
  return data;
}

// ── مساعد: Blob → base64 ──
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── عرض نتيجة الرفع في زر ──
function showDriveResult(btn, result) {
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-check"></i> تم الرفع!';
  btn.style.background = '#27ae60';
  setTimeout(() => {
    btn.innerHTML = '<i class="fab fa-google-drive"></i> Drive';
    btn.style.background = '';
    btn.disabled = false;
  }, 4000);

  // فتح الملف في Drive تلقائياً
  if (result.viewUrl) window.open(result.viewUrl, '_blank');
}

// ── عرض خطأ في زر ──
function showDriveError(btn, msg) {
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-times"></i> فشل';
  btn.style.background = '#e74c3c';
  setTimeout(() => {
    btn.innerHTML = '<i class="fab fa-google-drive"></i> Drive';
    btn.style.background = '';
  }, 4000);
  alert('❌ خطأ في رفع Drive:\n' + msg);
}

// ── حالة جاري الرفع ──
function showDriveLoading(btn) {
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
}

window.DriveSync = {
  getUrl:      getDriveUrl,
  saveUrl:     saveDriveUrl,
  test:        testDriveConnection,
  uploadZip:   uploadZipToDrive,
  uploadText:  uploadTextToDrive,
  showResult:  showDriveResult,
  showError:   showDriveError,
  showLoading: showDriveLoading
};
