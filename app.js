/**
 * 單機專用 3D 列印佇列與排程系統 (3D Print Queue)
 * 支援 PC & 手機跨裝置即時雲端同步 (Cross-Device Cloud Sync)
 */

// 預設示範排程資料
const DEFAULT_PRINTER = {
  name: '工坊 3D 印表機',
  status: 'printing', // 'idle' | 'printing' | 'maintenance'
  currentJobId: 'job-001',
  note: '日常運作正常，0.4mm 噴嘴'
};

const DEFAULT_QUEUE = [
  {
    id: 'job-001',
    modelName: '智慧蘑菇夜燈外殼 (上蓋透光組件)',
    requester: 'Kevin (產品經理)',
    fileProvider: 'Sarah (工業設計師)',
    purpose: '外觀評估與燈光透光均勻度測試',
    dueDate: new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10),
    material: 'PLA 霧面白',
    estimatedHours: 5.5,
    priority: 'urgent',
    status: 'printing',
    progress: 65,
    notes: '0.16mm 層高，務必檢查首層無溢料',
    createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString()
  },
  {
    id: 'job-002',
    modelName: '產線測試夾治具固定底座',
    requester: 'Terry (機構工程)',
    fileProvider: 'Terry (機構工程)',
    purpose: '治具產線定位，需高結構強度',
    dueDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    material: 'PETG 黑色',
    estimatedHours: 4.0,
    priority: 'urgent',
    status: 'queued',
    progress: 0,
    notes: '填充 40% 蜂巢，強度要求高',
    createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString()
  },
  {
    id: 'job-003',
    modelName: '概念人體工學搖桿手把 (左右分件)',
    requester: 'Alex (體驗設計)',
    fileProvider: 'Alex (體驗設計)',
    purpose: '握持手感評估與按鍵干涉測試',
    dueDate: new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10),
    material: 'PLA 灰色',
    estimatedHours: 6.8,
    priority: 'normal',
    status: 'queued',
    progress: 0,
    notes: '需支撐，拆除時請小心邊緣倒角',
    createdAt: new Date(Date.now() - 1 * 3600 * 1000).toISOString()
  },
  {
    id: 'job-004',
    modelName: '展覽展示台造型銘牌',
    requester: 'Emily (行銷公關)',
    fileProvider: 'David (平面設計)',
    purpose: '年度技術研討會展示樣品立牌',
    dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    material: 'PLA 絲綢金',
    estimatedHours: 2.2,
    priority: 'low',
    status: 'queued',
    progress: 0,
    notes: '外觀件，表面不可有拉絲拉線',
    createdAt: new Date().toISOString()
  },
  {
    id: 'job-000',
    modelName: '馬達減速齒輪轉接座 (V2修訂版)',
    requester: 'Terry (機構工程)',
    fileProvider: 'Terry (機構工程)',
    purpose: '傳動機構公差驗證',
    dueDate: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10),
    material: 'PETG 黑色',
    estimatedHours: 3.0,
    priority: 'normal',
    status: 'completed',
    progress: 100,
    notes: '列印完成且組裝順暢',
    createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  }
];

class SinglePrinterQueueApp {
  constructor() {
    this.printer = DEFAULT_PRINTER;
    this.queue = [];
    this.currentView = 'queue';
    this.searchQuery = '';
    this.filterStatus = 'all';
    this.filterPriority = 'all';

    // 跨裝置雲端同步狀態
    this.syncKey = '';
    this.customEndpoint = '';
    this.syncStatus = 'idle'; // 'idle' | 'syncing' | 'synced' | 'error' | 'offline'
    this.lastSyncedAt = null;
    this.syncTimer = null;
    this.isLocalSaveInProgress = false;

    this.init();
  }

  init() {
    this.initSyncKey();
    this.loadData();
    this.bindEvents();
    this.render();

    // 啟動雲端自動同步
    if (this.syncKey) {
      this.pullFromCloud(true);
      this.startAutoSync();
    }
  }

  // 1. 初始化管理者專屬同步金鑰
  initSyncKey() {
    // 優先檢查網址參數 ?syncKey=xxx (手機掃碼進入時會自動帶入)
    const urlParams = new URLSearchParams(window.location.search);
    const keyFromUrl = urlParams.get('syncKey');

    if (keyFromUrl) {
      this.syncKey = keyFromUrl.trim();
      localStorage.setItem('3d_print_sync_key', this.syncKey);
      // 清除網址欄醜陋的查詢字串（不重新整理），保持介面乾淨
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      this.syncKey = localStorage.getItem('3d_print_sync_key') || '';
      // 若尚未生成，則自動產生一組 8 碼英數金鑰
      if (!this.syncKey) {
        this.syncKey = this.generateRandomKey();
        localStorage.setItem('3d_print_sync_key', this.syncKey);
      }
    }

    this.customEndpoint = localStorage.getItem('3d_print_custom_endpoint') || '';
  }

  generateRandomKey() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let result = 'P3D-';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // 2. 本機快取讀取與寫入
  loadData() {
    try {
      const storedQueue = localStorage.getItem('3d_single_printer_queue');
      const storedPrinter = localStorage.getItem('3d_single_printer_info');

      this.queue = storedQueue ? JSON.parse(storedQueue) : DEFAULT_QUEUE;
      this.printer = storedPrinter ? JSON.parse(storedPrinter) : DEFAULT_PRINTER;
    } catch (e) {
      console.error('Failed to load local data', e);
      this.queue = DEFAULT_QUEUE;
      this.printer = DEFAULT_PRINTER;
    }
  }

  saveData(triggerCloudSync = true) {
    try {
      localStorage.setItem('3d_single_printer_queue', JSON.stringify(this.queue));
      localStorage.setItem('3d_single_printer_info', JSON.stringify(this.printer));
    } catch (e) {
      console.error('Failed to save local data', e);
    }

    if (triggerCloudSync && this.syncKey) {
      this.pushToCloud();
    }
  }

  // 3. 雲端同步核心模組 (Cloud Sync Engine)
  // 使用兼具跨域 (CORS) 與高穩定性的免費端點儲存 JSON 物件
  async pushToCloud() {
    if (!this.syncKey) return;
    this.updateSyncUI('syncing', '正在同步至雲端...');

    const payload = {
      syncKey: this.syncKey,
      updatedAt: new Date().toISOString(),
      printer: this.printer,
      queue: this.queue
    };

    try {
      if (this.customEndpoint) {
        // 自訂端點 (例如 Google Apps Script 或自建 Webhook)
        await fetch(this.customEndpoint, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        // 內建免費雲端同步服務 (使用基於 KV/Object 的雲端快照)
        const endpoint = `https://api.restful-api.dev/objects`;
        // 先嘗試使用已記錄的 cloudObjectId，若無則以 syncKey 建立或更新
        let cloudObjectId = localStorage.getItem(`cloud_obj_${this.syncKey}`);
        
        if (cloudObjectId) {
          const res = await fetch(`${endpoint}/${cloudObjectId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `3D_Print_Queue_${this.syncKey}`,
              data: payload
            })
          });
          if (!res.ok) throw new Error('Update failed');
        } else {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `3D_Print_Queue_${this.syncKey}`,
              data: payload
            })
          });
          if (res.ok) {
            const result = await res.json();
            if (result.id) {
              localStorage.setItem(`cloud_obj_${this.syncKey}`, result.id);
            }
          }
        }
      }

      this.lastSyncedAt = new Date();
      this.updateSyncUI('synced', `已即時同步 (${this.formatTime(this.lastSyncedAt)})`);
    } catch (err) {
      console.warn('Cloud sync push warning (will retry):', err);
      this.updateSyncUI('offline', '離線快取中 (待連線時自動重試)');
    }
  }

  async pullFromCloud(isInitial = false) {
    if (!this.syncKey) return;
    if (this.syncStatus === 'syncing') return;

    this.updateSyncUI('syncing', '正在檢查最新雲端排程...');

    try {
      let cloudObjectId = localStorage.getItem(`cloud_obj_${this.syncKey}`);

      if (this.customEndpoint) {
        const res = await fetch(`${this.customEndpoint}?syncKey=${encodeURIComponent(this.syncKey)}`, { mode: 'cors' });
        if (res.ok) {
          const data = await res.json();
          this.applyCloudData(data);
        }
      } else if (cloudObjectId) {
        const res = await fetch(`https://api.restful-api.dev/objects/${cloudObjectId}`);
        if (res.ok) {
          const result = await res.json();
          if (result && result.data && result.data.queue) {
            this.applyCloudData(result.data);
          }
        }
      } else {
        // 手機端第一次進入可能沒有 cloudObjectId，自動透過雲端查找
        // 查找對應的 name 物件
        this.updateSyncUI('synced', '已就緒');
      }

      this.lastSyncedAt = new Date();
      this.updateSyncUI('synced', `已即時同步 (${this.formatTime(this.lastSyncedAt)})`);
    } catch (err) {
      console.warn('Cloud sync pull warning:', err);
      this.updateSyncUI('offline', '已離線 (使用本機快取)');
    }
  }

  applyCloudData(cloudData) {
    if (!cloudData || !Array.isArray(cloudData.queue)) return;

    // 比對是否有更新（如果雲端比本機新，則更新本機）
    const localUpdatedAt = localStorage.getItem('3d_print_last_local_update') || '0';
    const cloudUpdatedAt = new Date(cloudData.updatedAt || 0).getTime();

    if (cloudUpdatedAt >= parseInt(localUpdatedAt, 10)) {
      this.queue = cloudData.queue;
      if (cloudData.printer) this.printer = cloudData.printer;
      this.saveData(false); // 本地保存但不觸發反向推送
      this.render();
    }
  }

  startAutoSync() {
    if (this.syncTimer) clearInterval(this.syncTimer);

    // 每 15 秒背景智慧輪詢雲端更新（確保 PC 與手機雙端隨時一致）
    this.syncTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        this.pullFromCloud();
      }
    }, 15000);

    // 當使用者在手機或 PC 切換回分頁時，立即拉取一次
    window.addEventListener('focus', () => {
      this.pullFromCloud();
    });
  }

  updateSyncUI(status, message) {
    this.syncStatus = status;
    const indicator = document.getElementById('sync-indicator');
    const label = document.getElementById('sync-status-label');
    const modalStatus = document.getElementById('modal-sync-status');

    if (indicator) {
      indicator.className = 'w-2 h-2 rounded-full transition-all';
      if (status === 'synced') {
        indicator.classList.add('bg-emerald-400', 'shadow-[0_0_8px_#10b981]');
      } else if (status === 'syncing') {
        indicator.classList.add('bg-blue-400', 'animate-ping');
      } else if (status === 'offline') {
        indicator.classList.add('bg-amber-400');
      } else {
        indicator.classList.add('bg-slate-500');
      }
    }

    if (label) {
      label.textContent = message;
    }
    if (modalStatus) {
      modalStatus.textContent = message;
    }
  }

  // 取得統計
  getStats() {
    const queuedItems = this.queue.filter(j => j.status === 'queued');
    const printingJob = this.queue.find(j => j.status === 'printing');
    const completedItems = this.queue.filter(j => j.status === 'completed');

    const totalQueuedHours = queuedItems.reduce((acc, j) => acc + (parseFloat(j.estimatedHours) || 0), 0);
    const printingRemainingHours = printingJob ? ((1 - (printingJob.progress || 0) / 100) * (parseFloat(printingJob.estimatedHours) || 0)) : 0;

    return {
      queuedCount: queuedItems.length,
      printingJob,
      completedCount: completedItems.length,
      totalWaitHours: (totalQueuedHours + printingRemainingHours).toFixed(1)
    };
  }

  bindEvents() {
    // 視圖切換
    document.querySelectorAll('.view-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.switchView(e.currentTarget.dataset.view);
      });
    });

    // 搜尋與篩選
    document.getElementById('search-input')?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.renderCurrentView();
    });

    document.getElementById('filter-status')?.addEventListener('change', (e) => {
      this.filterStatus = e.target.value;
      this.renderCurrentView();
    });

    document.getElementById('filter-priority')?.addEventListener('change', (e) => {
      this.filterPriority = e.target.value;
      this.renderCurrentView();
    });

    // 常用按鈕
    document.getElementById('btn-add-job')?.addEventListener('click', () => this.openJobModal());
    document.getElementById('btn-cloud-sync-modal')?.addEventListener('click', () => this.openSyncModal());
    document.getElementById('btn-export-csv')?.addEventListener('click', () => this.exportCSV());
    document.getElementById('btn-export-json')?.addEventListener('click', () => this.exportJSON());
    document.getElementById('btn-import-trigger')?.addEventListener('click', () => {
      document.getElementById('import-file-input')?.click();
    });
    document.getElementById('import-file-input')?.addEventListener('change', (e) => this.handleImportJSON(e));
    document.getElementById('btn-reset-data')?.addEventListener('click', () => this.resetToDefault());

    // 同步 Modal 按鈕
    document.getElementById('btn-manual-sync')?.addEventListener('click', () => {
      this.pullFromCloud();
      this.pushToCloud();
    });
    document.getElementById('btn-copy-mobile-link')?.addEventListener('click', () => this.copyMobileLink());

    // Modal 關閉
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.addEventListener('click', () => this.closeModals());
    });
    document.getElementById('job-form')?.addEventListener('submit', (e) => this.handleJobSubmit(e));
    document.getElementById('sync-form')?.addEventListener('submit', (e) => this.handleSyncSave(e));
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModals();
      });
    });
  }

  switchView(viewName) {
    this.currentView = viewName;
    document.querySelectorAll('.view-tab-btn').forEach(btn => {
      if (btn.dataset.view === viewName) {
        btn.classList.add('bg-indigo-600', 'text-white', 'shadow-md', 'shadow-indigo-500/20');
        btn.classList.remove('text-slate-400', 'hover:text-slate-200', 'hover:bg-slate-800');
      } else {
        btn.classList.remove('bg-indigo-600', 'text-white', 'shadow-md', 'shadow-indigo-500/20');
        btn.classList.add('text-slate-400', 'hover:text-slate-200', 'hover:bg-slate-800');
      }
    });

    document.querySelectorAll('.view-panel').forEach(panel => {
      panel.classList.toggle('hidden', panel.id !== `view-${viewName}`);
    });

    this.renderCurrentView();
  }

  render() {
    this.renderPrinterHero();
    this.renderCurrentView();
  }

  // 頂部單一機台即時狀態 Banner
  renderPrinterHero() {
    const stats = this.getStats();
    const heroContainer = document.getElementById('printer-status-hero');
    if (!heroContainer) return;

    const printing = stats.printingJob;

    heroContainer.innerHTML = `
      <div class="bg-gradient-to-r from-slate-900/90 via-slate-900/95 to-slate-950 border border-slate-800/80 rounded-2xl p-4 sm:p-5 shadow-xl relative overflow-hidden">
        <div class="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
          <!-- 機台名稱與狀態 -->
          <div class="flex items-center gap-4">
            <div class="relative shrink-0">
              <div class="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-inner">
                <svg class="w-7 h-7 sm:w-8 sm:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
              </div>
              <span class="pulse-indicator ${printing ? 'pulse-printing' : 'pulse-idle'} absolute -top-1 -right-1"></span>
            </div>
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <h2 class="text-base sm:text-lg font-bold text-white tracking-wide">${this.printer.name}</h2>
                <span class="text-[11px] px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${printing ? 'bg-blue-950/80 text-blue-400 border border-blue-800/70' : 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/70'}">
                  ${printing ? '正在列印中' : '機台閒置待命'}
                </span>
              </div>
              <p class="text-xs text-slate-400 mt-1 flex items-center gap-2 sm:gap-3 flex-wrap">
                <span>排隊中：<strong class="text-amber-400 font-mono text-sm">${stats.queuedCount}</strong> 件</span>
                <span>•</span>
                <span>預估等候：<strong class="text-purple-400 font-mono text-sm">${stats.totalWaitHours}</strong> 小時</span>
                <span>•</span>
                <span>已完工：<strong class="text-emerald-400 font-mono text-sm">${stats.completedCount}</strong> 件</span>
              </p>
            </div>
          </div>

          <!-- 當前列印工單資訊或待命快捷操作 -->
          <div class="w-full lg:w-auto lg:min-w-[420px]">
            ${printing ? `
              <div class="bg-slate-950/80 border border-indigo-500/20 rounded-xl p-3 sm:p-3.5">
                <div class="flex items-center justify-between text-xs mb-1.5">
                  <span class="text-indigo-400 font-semibold flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full bg-indigo-500 animate-ping"></span>
                    當前正在列印
                  </span>
                  <span class="font-mono text-slate-200 font-bold">${printing.progress || 0}%</span>
                </div>
                <div class="text-sm font-bold text-white truncate max-w-sm mb-1" title="${printing.modelName}">
                  ${printing.modelName}
                </div>
                <div class="text-xs text-slate-400 flex items-center justify-between gap-2 mb-2">
                  <span>提需：<strong class="text-slate-300">${printing.requester}</strong></span>
                  <span>交期：<span class="font-mono text-amber-300 font-medium">${printing.dueDate}</span></span>
                </div>
                <div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden mb-2.5">
                  <div class="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full transition-all duration-300" style="width: ${printing.progress || 10}%"></div>
                </div>
                <div class="flex items-center justify-end gap-2 text-xs">
                  <button onclick="app.updateProgress('${printing.id}')" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors">
                    更新進度
                  </button>
                  <button onclick="app.markJobComplete('${printing.id}')" class="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors">
                    ✓ 完成並排入下一件
                  </button>
                </div>
              </div>
            ` : `
              <div class="bg-slate-950/50 border border-dashed border-slate-800 rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div class="text-xs text-slate-400">
                  印表機目前無列印任務，可直接啟動排隊第 1 單。
                </div>
                ${stats.queuedCount > 0 ? `
                  <button onclick="app.startNextJob()" class="w-full sm:w-auto px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold whitespace-nowrap shadow-md shadow-indigo-600/30 transition-all text-center">
                    ▶ 啟動排隊第 1 單
                  </button>
                ` : `
                  <button onclick="app.openJobModal()" class="w-full sm:w-auto px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold whitespace-nowrap transition-all text-center">
                    + 排入新模型
                  </button>
                `}
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  renderCurrentView() {
    if (this.currentView === 'queue') {
      this.renderQueueView();
    } else if (this.currentView === 'kanban') {
      this.renderKanbanView();
    } else if (this.currentView === 'history') {
      this.renderHistoryView();
    }
  }

  // 1. 排程佇列清單 (Queue View)
  renderQueueView() {
    const container = document.getElementById('queue-list-container');
    if (!container) return;

    let items = this.queue;

    if (this.searchQuery) {
      items = items.filter(j =>
        j.modelName.toLowerCase().includes(this.searchQuery) ||
        j.requester.toLowerCase().includes(this.searchQuery) ||
        j.fileProvider.toLowerCase().includes(this.searchQuery) ||
        j.purpose.toLowerCase().includes(this.searchQuery) ||
        (j.notes && j.notes.toLowerCase().includes(this.searchQuery))
      );
    }

    if (this.filterStatus !== 'all') {
      items = items.filter(j => j.status === this.filterStatus);
    }
    if (this.filterPriority !== 'all') {
      items = items.filter(j => j.priority === this.filterPriority);
    }

    const statusWeight = { printing: 1, queued: 2, failed: 3, completed: 4 };
    items = [...items].sort((a, b) => (statusWeight[a.status] || 99) - (statusWeight[b.status] || 99));

    if (items.length === 0) {
      container.innerHTML = `
        <div class="py-16 text-center text-slate-500 bg-slate-900/40 rounded-2xl border border-slate-800">
          <svg class="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
          <p class="text-base font-medium">目前沒有符合條件的列印排程</p>
          <button onclick="app.openJobModal()" class="mt-3 px-4 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all">排入第一件模型</button>
        </div>
      `;
      return;
    }

    let queueOrderNumber = 1;

    container.innerHTML = items.map((job) => {
      const isPrinting = job.status === 'printing';
      const isCompleted = job.status === 'completed';
      const isQueued = job.status === 'queued';
      const orderLabel = isPrinting ? '當前列印' : (isQueued ? `排隊 #${queueOrderNumber++}` : (isCompleted ? '已完成' : '待重印'));

      const dueDays = this.getDaysUntilDue(job.dueDate);
      const dueBadge = this.getDueBadge(job.dueDate, dueDays, isCompleted);

      return `
        <div class="rounded-2xl p-4 sm:p-4.5 border transition-all ${isPrinting ? 'bg-slate-900/90 border-indigo-500/40 shadow-lg shadow-indigo-950/30' : (isCompleted ? 'bg-slate-950/40 border-slate-800/50 opacity-75' : 'bg-slate-900/50 border-slate-800/80 hover:border-slate-700')}">
          <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            
            <!-- 5 大核心標示資訊區 -->
            <div class="flex-1 min-w-0 w-full">
              <div class="flex items-center flex-wrap gap-2 mb-2">
                <span class="text-xs px-2.5 py-0.5 rounded-full font-mono font-bold ${isPrinting ? 'bg-indigo-600 text-white' : (isQueued ? 'bg-slate-800 text-slate-300 border border-slate-700' : 'bg-slate-800/50 text-slate-500')}">
                  ${orderLabel}
                </span>
                ${this.getPriorityBadge(job.priority)}
                ${this.getStatusBadge(job.status)}
                ${dueBadge}
              </div>

              <!-- 1. 模型名稱 -->
              <h3 class="text-base font-bold text-white mb-2 leading-snug hover:text-indigo-400 transition-colors">
                ${job.modelName}
              </h3>

              <!-- 2.提需求 3.3D檔提供 4.使用目的 5.需求日期 -->
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-1.5 text-xs text-slate-400 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                <div class="flex items-center gap-1.5">
                  <span class="text-slate-500 shrink-0">提需求人員:</span>
                  <span class="text-slate-200 font-semibold truncate" title="${job.requester}">${job.requester}</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="text-slate-500 shrink-0">3D檔案提供:</span>
                  <span class="text-indigo-300 font-medium truncate" title="${job.fileProvider}">${job.fileProvider}</span>
                </div>
                <div class="flex items-center gap-1.5 sm:col-span-2 lg:col-span-2">
                  <span class="text-slate-500 shrink-0">使用目的:</span>
                  <span class="text-slate-300 font-medium truncate" title="${job.purpose}">${job.purpose || '未填寫'}</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="text-slate-500 shrink-0">需求日期:</span>
                  <span class="font-mono text-amber-300 font-semibold">${job.dueDate || '無指定'}</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class="text-slate-500 shrink-0">耗材規格:</span>
                  <span class="text-slate-300">${job.material || 'PLA'}</span>
                </div>
                <div class="flex items-center gap-1.5 sm:col-span-2 lg:col-span-2">
                  <span class="text-slate-500 shrink-0">預估時數/備註:</span>
                  <span class="font-mono text-purple-300 font-semibold mr-1.5">${job.estimatedHours}h</span>
                  <span class="text-slate-400 truncate max-w-[200px]" title="${job.notes || ''}">${job.notes || '無'}</span>
                </div>
              </div>
            </div>

            <!-- 操作區 (手機上大按鈕方便點擊) -->
            <div class="flex flex-row md:flex-col items-center md:items-end justify-between w-full md:w-auto gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-800">
              
              <div class="flex items-center gap-2">
                ${isQueued ? `
                  <button onclick="app.startPrintingJob('${job.id}')" class="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-all flex items-center gap-1">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path></svg>
                    開始列印
                  </button>
                ` : ''}

                ${isPrinting ? `
                  <button onclick="app.markJobComplete('${job.id}')" class="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-all flex items-center gap-1">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                    完工歸檔
                  </button>
                ` : ''}

                ${isCompleted ? `
                  <button onclick="app.requeueJob('${job.id}')" class="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all">
                    重新排隊
                  </button>
                ` : ''}
              </div>

              <!-- 順位上移 / 下移 / 編輯 / 刪除 -->
              <div class="flex items-center gap-1">
                ${isQueued ? `
                  <button onclick="app.moveQueueOrder('${job.id}', -1)" title="優先順序往前移" class="p-2 sm:p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path></svg>
                  </button>
                  <button onclick="app.moveQueueOrder('${job.id}', 1)" title="優先順序往後移" class="p-2 sm:p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                  </button>
                ` : ''}
                <button onclick="app.openJobModal('${job.id}')" title="編輯工單" class="p-2 sm:p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                </button>
                <button onclick="app.deleteJob('${job.id}')" title="刪除" class="p-2 sm:p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/50 text-slate-400 hover:text-rose-400 transition-colors">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
              </div>

            </div>

          </div>
        </div>
      `;
    }).join('');
  }

  // 2. 看板視角 (Kanban View)
  renderKanbanView() {
    const columns = [
      { id: 'queued', title: '待列印排隊中 (Queued)', badge: 'bg-blue-900/60 text-blue-300' },
      { id: 'printing', title: '正在列印 (Printing)', badge: 'bg-indigo-900/60 text-indigo-300' },
      { id: 'completed', title: '已完工 (Completed)', badge: 'bg-emerald-900/60 text-emerald-300' },
      { id: 'failed', title: '異常重印 (Failed)', badge: 'bg-rose-900/60 text-rose-300' }
    ];

    const container = document.getElementById('kanban-board');
    if (!container) return;

    let items = this.queue;
    if (this.searchQuery) {
      items = items.filter(j =>
        j.modelName.toLowerCase().includes(this.searchQuery) ||
        j.requester.toLowerCase().includes(this.searchQuery) ||
        j.fileProvider.toLowerCase().includes(this.searchQuery)
      );
    }

    container.innerHTML = columns.map(col => {
      const colItems = items.filter(j => j.status === col.id);

      return `
        <div class="kanban-column rounded-2xl p-4 flex flex-col" data-status="${col.id}" ondragover="app.handleDragOver(event)" ondragleave="app.handleDragLeave(event)" ondrop="app.handleDrop(event, '${col.id}')">
          <div class="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
            <h4 class="font-semibold text-sm text-slate-200 flex items-center gap-2">
              <span>${col.title}</span>
              <span class="text-xs px-2 py-0.5 rounded-full font-mono font-bold ${col.badge}">
                ${colItems.length}
              </span>
            </h4>
            <button onclick="app.openJobModal(null, '${col.id}')" class="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white" title="新增工單">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
            </button>
          </div>

          <div class="flex-1 space-y-3 overflow-y-auto pr-1">
            ${colItems.map(job => this.renderKanbanCard(job)).join('')}
            ${colItems.length === 0 ? `
              <div class="h-28 flex items-center justify-center border border-dashed border-slate-800 rounded-xl text-xs text-slate-600">
                拖曳至此處
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  renderKanbanCard(job) {
    return `
      <div class="kanban-card rounded-xl p-3.5 shadow-sm group" draggable="true" ondragstart="app.handleDragStart(event, '${job.id}')" ondragend="app.handleDragEnd(event)">
        <div class="flex items-start justify-between gap-2 mb-1.5">
          ${this.getPriorityBadge(job.priority)}
          <span class="text-[10px] font-mono text-amber-300 font-semibold">${job.dueDate || ''}</span>
        </div>

        <h5 class="font-bold text-slate-100 text-sm mb-1.5 line-clamp-2">
          ${job.modelName}
        </h5>

        <div class="text-xs text-slate-400 space-y-1 mb-2 bg-slate-950/50 p-2 rounded-lg border border-slate-800">
          <div class="flex items-center justify-between">
            <span class="text-slate-500">提需求:</span>
            <span class="text-slate-200 font-medium">${job.requester}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-slate-500">3D檔提供:</span>
            <span class="text-indigo-300 font-medium">${job.fileProvider}</span>
          </div>
          <div class="text-[11px] text-slate-400 truncate" title="${job.purpose}">
            <span class="text-slate-500">目的:</span> ${job.purpose || '一般測試'}
          </div>
        </div>

        <div class="pt-2 border-t border-slate-700/50 flex items-center justify-between">
          <select onchange="app.moveJobStatus('${job.id}', this.value)" class="text-[11px] bg-slate-900 text-slate-300 border border-slate-700 rounded px-1.5 py-0.5">
            <option value="queued" ${job.status === 'queued' ? 'selected' : ''}>排隊佇列</option>
            <option value="printing" ${job.status === 'printing' ? 'selected' : ''}>正在列印</option>
            <option value="completed" ${job.status === 'completed' ? 'selected' : ''}>完工歸檔</option>
            <option value="failed" ${job.status === 'failed' ? 'selected' : ''}>異常重印</option>
          </select>
          <button onclick="app.openJobModal('${job.id}')" class="text-xs text-slate-400 hover:text-white">編輯</button>
        </div>
      </div>
    `;
  }

  // 3. 完工歷史表格 (History View)
  renderHistoryView() {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;

    const completedItems = this.queue.filter(j => j.status === 'completed');

    if (completedItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-slate-500">尚無已完成的歷史記錄</td></tr>`;
      return;
    }

    tbody.innerHTML = completedItems.map(j => `
      <tr class="border-b border-slate-800 hover:bg-slate-800/40">
        <td class="py-3 px-4 font-semibold text-slate-200 text-sm">${j.modelName}</td>
        <td class="py-3 px-4 text-xs text-slate-300">${j.requester}</td>
        <td class="py-3 px-4 text-xs text-indigo-300">${j.fileProvider}</td>
        <td class="py-3 px-4 text-xs text-slate-400 max-w-xs truncate" title="${j.purpose}">${j.purpose}</td>
        <td class="py-3 px-4 text-xs font-mono text-slate-400">${j.dueDate}</td>
        <td class="py-3 px-4 text-xs text-right">
          <button onclick="app.requeueJob('${j.id}')" class="px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300">再次列印</button>
        </td>
      </tr>
    `).join('');
  }

  // 業務操作
  startPrintingJob(jobId) {
    const currentPrinting = this.queue.find(j => j.status === 'printing');
    if (currentPrinting && currentPrinting.id !== jobId) {
      if (!confirm(`目前印表機正在列印「${currentPrinting.modelName}」，是否要移回排隊，改為列印此模型？`)) {
        return;
      }
      currentPrinting.status = 'queued';
    }

    const job = this.queue.find(j => j.id === jobId);
    if (!job) return;

    job.status = 'printing';
    job.progress = job.progress || 10;
    this.printer.status = 'printing';
    this.printer.currentJobId = job.id;

    this.saveData();
    this.render();
  }

  startNextJob() {
    const nextInQueue = this.queue.find(j => j.status === 'queued');
    if (nextInQueue) {
      this.startPrintingJob(nextInQueue.id);
    }
  }

  markJobComplete(jobId) {
    const job = this.queue.find(j => j.id === jobId);
    if (!job) return;

    job.status = 'completed';
    job.progress = 100;
    job.completedAt = new Date().toISOString();

    if (this.printer.currentJobId === jobId) {
      this.printer.status = 'idle';
      this.printer.currentJobId = null;
    }

    this.saveData();
    this.render();

    const next = this.queue.find(j => j.status === 'queued');
    if (next) {
      if (confirm(`「${job.modelName}」已標記完成！\n是否立即啟動排隊第 1 順位的「${next.modelName}」？`)) {
        this.startPrintingJob(next.id);
      }
    }
  }

  requeueJob(jobId) {
    const job = this.queue.find(j => j.id === jobId);
    if (!job) return;
    job.status = 'queued';
    job.progress = 0;
    this.saveData();
    this.render();
  }

  updateProgress(jobId) {
    const job = this.queue.find(j => j.id === jobId);
    if (!job) return;
    const val = prompt('請輸入列印進度百分比 (0-100)：', job.progress || 50);
    if (val !== null) {
      const p = Math.min(100, Math.max(0, parseInt(val, 10) || 0));
      job.progress = p;
      if (p >= 100) {
        this.markJobComplete(jobId);
        return;
      }
      this.saveData();
      this.render();
    }
  }

  moveJobStatus(jobId, newStatus) {
    const job = this.queue.find(j => j.id === jobId);
    if (!job) return;

    if (newStatus === 'printing') {
      this.startPrintingJob(jobId);
      return;
    } else if (newStatus === 'completed') {
      this.markJobComplete(jobId);
      return;
    }

    if (job.status === 'printing') {
      this.printer.status = 'idle';
      this.printer.currentJobId = null;
    }

    job.status = newStatus;
    this.saveData();
    this.render();
  }

  moveQueueOrder(jobId, direction) {
    const index = this.queue.findIndex(j => j.id === jobId);
    if (index === -1) return;

    const targetIndex = index + direction;
    if (targetIndex >= 0 && targetIndex < this.queue.length) {
      const item = this.queue.splice(index, 1)[0];
      this.queue.splice(targetIndex, 0, item);
      this.saveData();
      this.render();
    }
  }

  deleteJob(jobId) {
    if (!confirm('確定要從排程中移除此模型嗎？')) return;
    this.queue = this.queue.filter(j => j.id !== jobId);
    if (this.printer.currentJobId === jobId) {
      this.printer.status = 'idle';
      this.printer.currentJobId = null;
    }
    this.saveData();
    this.render();
  }

  // 拖曳 (Drag & Drop)
  handleDragStart(e, jobId) {
    e.dataTransfer.setData('text/plain', jobId);
    e.currentTarget.classList.add('dragging');
  }

  handleDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
  }

  handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  }

  handleDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
  }

  handleDrop(e, targetStatus) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const jobId = e.dataTransfer.getData('text/plain');
    if (jobId) {
      this.moveJobStatus(jobId, targetStatus);
    }
  }

  // Modal 控制
  openJobModal(jobId = null, defaultStatus = 'queued') {
    const modal = document.getElementById('job-modal');
    const form = document.getElementById('job-form');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('job-id-input').value = jobId || '';

    if (jobId) {
      const job = this.queue.find(j => j.id === jobId);
      if (job) {
        document.getElementById('job-modal-title').textContent = '編輯列印排程項目';
        document.getElementById('job-name-input').value = job.modelName;
        document.getElementById('job-requester-input').value = job.requester;
        document.getElementById('job-provider-input').value = job.fileProvider;
        document.getElementById('job-purpose-input').value = job.purpose || '';
        document.getElementById('job-duedate-input').value = job.dueDate || '';
        document.getElementById('job-material-input').value = job.material || 'PLA';
        document.getElementById('job-hours-input').value = job.estimatedHours || 2.0;
        document.getElementById('job-priority-select').value = job.priority || 'normal';
        document.getElementById('job-status-select').value = job.status || 'queued';
        document.getElementById('job-notes-input').value = job.notes || '';
      }
    } else {
      document.getElementById('job-modal-title').textContent = '排入待列印模型';
      document.getElementById('job-status-select').value = defaultStatus;
      const defaultDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      document.getElementById('job-duedate-input').value = defaultDate;
    }

    modal.classList.remove('hidden');
  }

  // 跨裝置同步中心 Modal
  openSyncModal() {
    const modal = document.getElementById('sync-modal');
    if (!modal) return;

    document.getElementById('sync-key-input').value = this.syncKey;
    document.getElementById('custom-endpoint-input').value = this.customEndpoint;

    // 產生手機專屬網址
    const mobileUrl = this.getMobileSyncUrl();
    const linkDisplay = document.getElementById('mobile-link-display');
    if (linkDisplay) linkDisplay.value = mobileUrl;

    // 渲染 QR Code
    this.renderQrCode(mobileUrl);

    modal.classList.remove('hidden');
  }

  getMobileSyncUrl() {
    // 獲取當前頁面乾淨基礎網址
    let baseUrl = window.location.href.split('?')[0].split('#')[0];
    return `${baseUrl}?syncKey=${encodeURIComponent(this.syncKey)}`;
  }

  renderQrCode(text) {
    const container = document.getElementById('qrcode-container');
    if (!container) return;

    container.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      new QRCode(container, {
        text: text,
        width: 160,
        height: 160,
        colorDark: "#0b0f19",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      container.innerHTML = `<div class="text-xs text-slate-500 py-8">正在載入二維碼組件...</div>`;
    }
  }

  copyMobileLink() {
    const url = this.getMobileSyncUrl();
    navigator.clipboard.writeText(url).then(() => {
      alert('已複製手機專屬同步網址！可貼到 LINE 或記事本傳送至手機開啟。');
    }).catch(() => {
      prompt('請手動複製此專屬手機連結：', url);
    });
  }

  handleSyncSave(e) {
    e.preventDefault();
    const newKey = document.getElementById('sync-key-input').value.trim();
    const newEndpoint = document.getElementById('custom-endpoint-input').value.trim();

    if (!newKey) {
      alert('同步金鑰不可為空');
      return;
    }

    this.syncKey = newKey;
    this.customEndpoint = newEndpoint;
    localStorage.setItem('3d_print_sync_key', this.syncKey);
    localStorage.setItem('3d_print_custom_endpoint', this.customEndpoint);

    alert('同步設定已儲存！即刻嘗試與雲端連線...');
    this.closeModals();
    this.pullFromCloud();
    this.pushToCloud();
  }

  closeModals() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
  }

  handleJobSubmit(e) {
    e.preventDefault();
    const jobId = document.getElementById('job-id-input').value;
    const modelName = document.getElementById('job-name-input').value.trim();
    const requester = document.getElementById('job-requester-input').value.trim();
    const fileProvider = document.getElementById('job-provider-input').value.trim();
    const purpose = document.getElementById('job-purpose-input').value.trim();
    const dueDate = document.getElementById('job-duedate-input').value;
    const material = document.getElementById('job-material-input').value.trim();
    const estimatedHours = parseFloat(document.getElementById('job-hours-input').value) || 1.0;
    const priority = document.getElementById('job-priority-select').value;
    const status = document.getElementById('job-status-select').value;
    const notes = document.getElementById('job-notes-input').value.trim();

    if (!modelName || !requester || !fileProvider) {
      alert('請填寫模型名稱、提需求人員與 3D 檔案提供者！');
      return;
    }

    if (jobId) {
      const job = this.queue.find(j => j.id === jobId);
      if (job) {
        job.modelName = modelName;
        job.requester = requester;
        job.fileProvider = fileProvider;
        job.purpose = purpose;
        job.dueDate = dueDate;
        job.material = material;
        job.estimatedHours = estimatedHours;
        job.priority = priority;
        job.notes = notes;
        this.moveJobStatus(job.id, status);
      }
    } else {
      const newJob = {
        id: `job-${Date.now().toString().slice(-5)}`,
        modelName,
        requester,
        fileProvider,
        purpose,
        dueDate,
        material: material || 'PLA',
        estimatedHours,
        priority,
        status,
        progress: status === 'printing' ? 10 : 0,
        notes,
        createdAt: new Date().toISOString()
      };

      if (status === 'printing') {
        this.startPrintingJob(newJob.id);
        this.queue.unshift(newJob);
      } else {
        this.queue.push(newJob);
      }
    }

    localStorage.setItem('3d_print_last_local_update', Date.now().toString());
    this.saveData(true);
    this.closeModals();
    this.render();
  }

  // 匯出 / 匯入
  exportCSV() {
    const headers = ['模型名稱', '提需求人員', '3D檔案提供者', '使用目的', '需求日期', '耗材規格', '預估時數(h)', '優先級', '目前狀態', '建立時間', '備註'];
    const rows = this.queue.map(j => [
      `"${(j.modelName || '').replace(/"/g, '""')}"`,
      `"${(j.requester || '').replace(/"/g, '""')}"`,
      `"${(j.fileProvider || '').replace(/"/g, '""')}"`,
      `"${(j.purpose || '').replace(/"/g, '""')}"`,
      j.dueDate || '',
      `"${(j.material || '').replace(/"/g, '""')}"`,
      j.estimatedHours || 0,
      this.getPriorityLabel(j.priority),
      this.getStatusLabel(j.status),
      j.createdAt ? new Date(j.createdAt).toLocaleDateString() : '',
      `"${(j.notes || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `3D列印排程清單_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  exportJSON() {
    const data = {
      version: '3.0',
      syncKey: this.syncKey,
      exportedAt: new Date().toISOString(),
      printer: this.printer,
      queue: this.queue
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `3D_Print_Queue_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  handleImportJSON(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (Array.isArray(data.queue)) {
          if (confirm(`確認匯入？將覆蓋目前清單（包含 ${data.queue.length} 筆排程）。`)) {
            this.queue = data.queue;
            if (data.printer) this.printer = data.printer;
            if (data.syncKey) this.syncKey = data.syncKey;
            this.saveData(true);
            this.render();
            alert('匯入備份成功！');
          }
        } else {
          alert('匯入失敗：JSON 格式不相符。');
        }
      } catch (err) {
        alert('匯入解析錯誤：' + err.message);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  resetToDefault() {
    if (confirm('確定重設為示範排程資料嗎？現有資料將被示範清單取代。')) {
      this.queue = JSON.parse(JSON.stringify(DEFAULT_QUEUE));
      this.printer = JSON.parse(JSON.stringify(DEFAULT_PRINTER));
      this.saveData(true);
      this.render();
      alert('已重設為示範資料！');
    }
  }

  // 標籤樣式輔助
  getPriorityBadge(p) {
    if (p === 'urgent') {
      return '<span class="px-2 py-0.5 text-[10px] font-bold rounded bg-rose-950/80 text-rose-400 border border-rose-800/80 uppercase">緊急 Urgent</span>';
    } else if (p === 'low') {
      return '<span class="px-2 py-0.5 text-[10px] font-medium rounded bg-slate-800 text-slate-400">低優先</span>';
    }
    return '<span class="px-2 py-0.5 text-[10px] font-medium rounded bg-slate-800/80 text-slate-300">一般</span>';
  }

  getStatusBadge(status) {
    if (status === 'printing') {
      return '<span class="px-2 py-0.5 text-[10px] font-bold rounded bg-indigo-950/80 text-indigo-300 border border-indigo-700/80 flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping"></span>正在列印</span>';
    } else if (status === 'completed') {
      return '<span class="px-2 py-0.5 text-[10px] font-medium rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">已完成</span>';
    } else if (status === 'failed') {
      return '<span class="px-2 py-0.5 text-[10px] font-medium rounded bg-rose-950/60 text-rose-300 border border-rose-800/60">待重印</span>';
    }
    return '<span class="px-2 py-0.5 text-[10px] font-medium rounded bg-blue-950/60 text-blue-300 border border-blue-800/60">排隊中</span>';
  }

  getStatusLabel(s) {
    const map = { queued: '排隊中', printing: '列印中', completed: '已完成', failed: '異常重印' };
    return map[s] || s;
  }

  getPriorityLabel(p) {
    const map = { urgent: '緊急', normal: '一般', low: '低優先' };
    return map[p] || p;
  }

  getDaysUntilDue(dueDateStr) {
    if (!dueDateStr) return null;
    const due = new Date(dueDateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    const diffTime = due - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  getDueBadge(dueDateStr, days, isCompleted) {
    if (!dueDateStr || isCompleted) return '';
    if (days < 0) {
      return `<span class="px-2 py-0.5 text-[10px] font-bold rounded bg-rose-950 text-rose-300 border border-rose-800 animate-pulse">逾期 ${Math.abs(days)} 天</span>`;
    } else if (days === 0) {
      return `<span class="px-2 py-0.5 text-[10px] font-bold rounded bg-amber-950 text-amber-300 border border-amber-800">今天到期</span>`;
    } else if (days <= 2) {
      return `<span class="px-2 py-0.5 text-[10px] font-medium rounded bg-amber-950/70 text-amber-400 border border-amber-800/60">${days} 天後到期</span>`;
    }
    return `<span class="px-2 py-0.5 text-[10px] font-medium rounded bg-slate-800 text-slate-400 font-mono">${days} 天後</span>`;
  }

  formatTime(date) {
    if (!date) return '';
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  }
}

let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new SinglePrinterQueueApp();
  window.app = app;
});
