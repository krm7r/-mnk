// Popup Script v6.2 — تم إصلاح التوافق الكامل مع background.js (start_job / get_status)

const startBtn = document.getElementById('startBtn');
const openSidePanelBtn = document.getElementById('openSidePanel');
const status = document.getElementById('status');
const statsArea = document.getElementById('statsArea');
const pageCount = document.getElementById('pageCount');
const mediaCount = document.getElementById('mediaCount');
const crawlType = document.getElementById('crawlType');
const filterImages = document.getElementById('filterImages');
const filterText = document.getElementById('filterText');
const filterVideos = document.getElementById('filterVideos');
const filterFiles = document.getElementById('filterFiles');
const filterXML = document.getElementById('filterXML');
const filterAssets = document.getElementById('filterAssets');

let monitoringInterval = null;

// تحميل الإعدادات المشتركة مع اللوحة الجانبية (نفس مفتاح التخزين) عند فتح popup
chrome.storage.local.get('scraper_cfg', (stored) => {
  const saved = stored?.scraper_cfg;
  if (saved && typeof saved.downloadAssets === 'boolean') {
    filterAssets.checked = saved.downloadAssets;
  }
});

startBtn.addEventListener('click', startScraping);
openSidePanelBtn.addEventListener('click', openSidePanel);

// دالة بدء السحب
async function startScraping() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab) {
    status.textContent = '❌ لم يتم العثور على علامة تبويب نشطة';
    return;
  }

  startBtn.disabled = true;
  statsArea.style.display = 'grid';
  status.textContent = '⏳ جاري بدء عملية السحب...';

  const filters = {
    images: filterImages.checked,
    videos: filterVideos.checked,
    files: filterFiles.checked,
    xml: filterXML.checked,
    text: filterText.checked,
    pages: true // صفحات دائماً
  };

  // نوع الوظيفة الحقيقي في background.js هو 'single' أو 'site'
  const jobType = crawlType.value === 'full' ? 'site' : 'single';

  chrome.runtime.sendMessage({
    action: 'start_job',
    type: jobType,
    tabId: tab.id,
    settings: {
      filters,
      waitDelay: 10,
      delayBetweenRequests: 800,
      maxPages: 500,
      downloadAssets: filterAssets.checked
    }
  }, (response) => {
    if (chrome.runtime.lastError) {
      status.textContent = '❌ تعذّر الاتصال بالخلفية: ' + chrome.runtime.lastError.message;
      startBtn.disabled = false;
      return;
    }
    if (response && response.ok) {
      status.textContent = '✅ تم بدء السحب في الخلفية. افتح لوحة المراقبة للمزيد من التحكم.';
      monitorProgress();
    } else {
      status.textContent = '❌ فشل بدء السحب: ' + (response?.err || 'خطأ غير معروف');
      startBtn.disabled = false;
    }
  });
}

// دالة مراقبة التقدم — تقرأ الشكل الحقيقي لرد get_status: { stats, pagesCount, mediaCount, isRunning }
function monitorProgress() {
  if (monitoringInterval) clearInterval(monitoringInterval);

  monitoringInterval = setInterval(() => {
    chrome.runtime.sendMessage({ action: 'get_status' }, (response) => {
      if (chrome.runtime.lastError || !response) return;

      pageCount.textContent = response.pagesCount ?? 0;
      mediaCount.textContent = response.mediaCount ?? 0;

      if (response.stats?.currentUrl) {
        status.textContent = response.stats.currentUrl;
      }

      if (!response.isRunning && response.stats?.phase !== 'idle' && response.stats?.phase !== 'starting') {
        status.textContent = '✅ انتهت العملية! افتح لوحة المراقبة للاستكمال أو التحميل.';
        startBtn.disabled = false;
        clearInterval(monitoringInterval);
        monitoringInterval = null;
      }
    });
  }, 1000);

  // إيقاف المراقبة بعد 10 دقائق تفادياً لتسريب المؤقتات
  setTimeout(() => {
    if (monitoringInterval) { clearInterval(monitoringInterval); monitoringInterval = null; }
  }, 600000);
}

// دالة فتح لوحة المراقبة الجانبية
async function openSidePanel() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    } else {
      status.textContent = '❌ لم يتم العثور على علامة تبويب نشطة';
    }
  } catch (err) {
    console.error('Error opening side panel:', err);
    status.textContent = '❌ حدث خطأ في فتح لوحة المراقبة';
  }
}

// تحديث الحالة عند فتح popup
window.addEventListener('load', () => {
  chrome.runtime.sendMessage({ action: 'get_status' }, (response) => {
    if (chrome.runtime.lastError || !response) return;

    if (response.pagesCount > 0) {
      pageCount.textContent = response.pagesCount;
      mediaCount.textContent = response.mediaCount;
      statsArea.style.display = 'grid';
      status.textContent = '📊 يوجد بيانات محفوظة. افتح لوحة المراقبة لتحميل ZIP.';
    }

    if (response.isRunning) {
      startBtn.disabled = true;
      statsArea.style.display = 'grid';
      monitorProgress();
    }

    if (response.stats?.phase === 'interrupted') {
      status.textContent = response.stats.currentUrl || '⚠️ توقفت جلسة سابقة، بياناتك محفوظة.';
      statsArea.style.display = 'grid';
    }
  });
});
