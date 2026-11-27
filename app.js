/**
 * 單機專用 3D 列印佇列與排程系統 (3D Print Queue)
 * 解決 Modal 跳掉與同步鎖定問題 (極致穩定版)
 */

const DEFAULT_PRINTER = {
  name: '工坊 3D 印表機',
  status: 'idle',
  currentJobId: null,
  note: '日常運作正常，0.4mm 噴嘴'
};

const DEFAULT_QUEUE = [];

class SinglePrinterQueueApp {
  constructor() {
    this.printer = DEFAULT_PRINTER;
    this.queue = [];
    this.currentView = 'queue';
    this.searchQuery = '';
    this.filterStatus = 'all';
    this.filterPriority = 'all';

    // 狀態鎖定：防止使用者在輸入時被背景同步打斷或關閉
    this.isModalOpen = false;

    // 跨裝置雲端同步狀態
    this.syncKey = '';
    this.customEndpoint = '';
    this.syncStatus = 'idle';
    this.lastSyncedAt = null;
    this.syncTimer = null;

    this.init();
  }

  init() {
    this.initSyncKey();
    this.loadData();
    this.bindEvents();
    this.render();

    if (this.syncKey) {
      this.pullFromCloud(true);
      this.startAutoSync();
    }
  }

  initSyncKey() {
    const urlParams = new URLSearchParams(window.location.search);
    const keyFromUrl = urlParams.get('syncKey');

    if (keyFromUrl) {
      this.syncKey = keyFromUrl.trim();
      localStorage.setItem('3d_print_sync_key', this.syncKey);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      this.syncKey = localStorage.getItem('3d_print_sync_key') || '';
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
      // 標記本地最新更新時間戳
      localStorage.setItem('3d_print_last_local_update', Date.now().toString());
      localStorage.setItem('3d_single_printer_queue', JSON.stringify(this.queue));
      localStorage.setItem('3d_single_printer_info', JSON.stringify(this.printer));
    } catch (e) {
      console.error('Failed to save local data', e);
    }

    if (triggerCloudSync && this.syncKey) {
      this.pushToCloud();
    }
  }

  async pushToCloud() {
    if (!this.syncKey) return;
    this.updateSyncUI('syncing', '正在同步至雲端...');

    const payload = {
      syncKey: this.syncKey,
      updatedAt: new Date().toISOString(),
      timestamp: Date.now(),
      printer: this.printer,
      queue: this.queue
    };

    try {
      if (this.customEndpoint) {
        await fetch(this.customEndpoint, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        const endpoint = `https://api.restful-api.dev/objects`;
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
      console.warn('Cloud sync push warning:', err);
      this.updateSyncUI('offline', '已離線 (本機完整保存)');
    }
  }

  async pullFromCloud(isInitial = false) {
    if (!this.syncKey) return;
    // 若使用者正在開啟 Modal 編輯，絕對不可拉取覆蓋！
    if (this.isModalOpen) return;
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
    if (this.isModalOpen) return; // 編輯中嚴禁覆蓋

    const localUpdatedAt = localStorage.getItem('3d_print_last_local_update') || '0';
    const cloudTimestamp = cloudData.timestamp || new Date(cloudData.updatedAt || 0).getTime();

    // 只有當雲端資料明確比本地新時才覆蓋
    if (cloudTimestamp > parseInt(localUpdatedAt, 10)) {
      this.queue = cloudData.queue;
      if (cloudData.printer) this.printer = cloudData.printer;
      this.saveData(false);
      this.render();
    }
  }

  startAutoSync() {
    if (this.syncTimer) clearInterval(this.syncTimer);

    this.syncTimer = setInterval(() => {
      // 只有在視窗可見且未在編輯時才自動輪詢
      if (document.visibilityState === 'visible' && !this.isModalOpen) {
        this.pullFromCloud();
      }
    }, 20000);

    // 移除 window focus 盲目覆蓋事件，改用手動或背景輪詢，避免點選 input 切換焦點時跳掉
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

    if (label) label.textContent = message;
    if (modalStatus) modalStatus.textContent = message;
  }

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
    document.querySelectorAll('.view-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.switchView(e.currentTarget.dataset.view);
      });
    });

    document.getElementById('btn-add-job')?.addEventListener('click', () => this.openJobModal());
    document.getElementById('btn-cloud-sync-modal')?.addEventListener('click', () => this.openSyncModal());
    document.getElementById('btn-export-csv')?.addEventListener('click', () => this.exportCSV());
    document.getElementById('btn-export-json')?.addEventListener('click', () => this.exportJSON());
    document.getElementById('btn-import-trigger')?.addEventListener('click', () => {
      document.getElementById('import-file-input')?.click();
    });
    document.getElementById('import-file-input')?.addEventListener('change', (e) => this.handleImportJSON(e));
    document.getElementById('btn-clear-all')?.addEventListener('click', () => this.clearAllJobs());

    document.getElementById('btn-manual-sync')?.addEventListener('click', () => {
      this.pullFromCloud();
      this.pushToCloud();
    });
    document.getElementById('btn-copy-mobile-link')?.addEventListener('click', () => this.copyMobileLink());

    // 關閉 Modal 按鈕
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.addEventListener('click', () => this.closeModals());
    });

    // 表單送出
    document.getElementById('job-form')?.addEventListener('submit', (e) => this.handleJobSubmit(e));
    document.getElementById('sync-form')?.addEventListener('submit', (e) => this.handleSyncSave(e));

    // 點擊 Modal 外部遮罩關閉 (加上確認機制，防止打字誤觸跳掉)
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      modal.addEventListener('mousedown', (e) => {
        // 只有點擊最外層黑色遮罩本身時才觸發
        if (e.target === modal) {
          modal.dataset.clickedBackdrop = "true";
        } else {
          modal.dataset.clickedBackdrop = "false";
        }
      });
      modal.addEventListener('mouseup', (e) => {
        if (modal.dataset.clickedBackdrop === "true" && e.target === modal) {
          this.closeModals();
        }
        modal.dataset.clickedBackdrop = "false";
      });
    });

    // 阻止對話框主體點擊冒泡
    document.querySelectorAll('.modal-content-card').forEach(card => {
      card.addEventListener('click', (e) => e.stopPropagation());
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
                  <button onclick="app.openJobModal('${printing.id}')" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors">
                    編輯 / 更新進度
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
    } else if (this.currentView === 'history') {
      this.renderHistoryView();
    }
  }

  renderQueueView() {
    const container = document.getElementById('queue-list-container');
    if (!container) return;

    let items = this.queue;

    const statusWeight = { printing: 1, queued: 2, completed: 3 };
    items = [...items].sort((a, b) => (statusWeight[a.status] || 99) - (statusWeight[b.status] || 99));

    if (items.length === 0) {
      container.innerHTML = `
        <div class="py-16 text-center text-slate-500 bg-slate-900/40 rounded-2xl border border-slate-800">
          <svg class="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
          <p class="text-base font-medium">目前沒有待列印模型排程</p>
          <p class="text-xs text-slate-600 mt-1">點擊上方「+ 排入待印模型」開始建立第一筆排程</p>
          <button onclick="app.openJobModal()" class="mt-4 px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all shadow-md shadow-indigo-600/30">+ 排入第一件模型</button>
        </div>
      `;
      return;
    }

    let queueOrderNumber = 1;

    container.innerHTML = items.map((job) => {
      const isPrinting = job.status === 'printing';
      const isCompleted = job.status === 'completed';
      const isQueued = job.status === 'queued';

      return `
        <div class="rounded-2xl p-4 sm:p-4.5 border transition-all ${isPrinting ? 'bg-slate-900/90 border-indigo-500/40 shadow-lg shadow-indigo-950/30' : (isCompleted ? 'bg-slate-950/40 border-slate-800/50 opacity-75' : 'bg-slate-900/50 border-slate-800/80 hover:border-slate-700')}">
          <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            
            <div class="flex-1 min-w-0 w-full">
              <!-- 模型名稱 (排隊序號以極簡文字呈現，不使用任何標籤) -->
              <h3 class="text-base font-bold text-white mb-2.5 leading-snug hover:text-indigo-400 transition-colors flex items-center gap-2">
                ${isPrinting ? '<span class="text-indigo-400 font-mono text-xs font-semibold shrink-0">[列印中]</span>' : (isQueued ? `<span class="text-slate-400 font-mono text-xs font-semibold shrink-0">#${queueOrderNumber++}</span>` : '')}
                <span class="truncate">${job.modelName}</span>
              </h3>

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

            <!-- 操作區 -->
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
    this.showToast('✓ 已開始列印');
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
    this.showToast('✓ 模型已完工歸檔！');

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
    this.showToast('✓ 已重新排入佇列');
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
    this.showToast('✓ 已刪除排程');
  }

  clearAllJobs() {
    if (confirm('確定要清空目前所有的排程記錄嗎？清空後可完全從零開始填寫。')) {
      this.queue = [];
      this.printer.status = 'idle';
      this.printer.currentJobId = null;
      this.saveData(true);
      this.render();
      this.showToast('✓ 已清空所有排程');
    }
  }

  openJobModal(jobId = null, defaultStatus = 'queued') {
    this.isModalOpen = true; // 鎖定狀態：防止背景輪詢打斷輸入
    const modal = document.getElementById('job-modal');
    const form = document.getElementById('job-form');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('job-id-input').value = jobId || '';

    // 進度輸入群組控制
    const progressGroup = document.getElementById('job-progress-group');

    if (jobId) {
      const job = this.queue.find(j => j.id === jobId);
      if (job) {
        document.getElementById('job-modal-title').textContent = '編輯列印排程項目';
        document.getElementById('job-name-input').value = job.modelName || '';
        document.getElementById('job-requester-input').value = job.requester || '';
        document.getElementById('job-provider-input').value = job.fileProvider || '';
        document.getElementById('job-purpose-input').value = job.purpose || '';
        document.getElementById('job-duedate-input').value = job.dueDate || '';
        document.getElementById('job-material-input').value = job.material || 'PLA';
        document.getElementById('job-hours-input').value = job.estimatedHours || 2.0;
        document.getElementById('job-priority-select').value = job.priority || 'normal';
        document.getElementById('job-status-select').value = job.status || 'queued';
        document.getElementById('job-notes-input').value = job.notes || '';

        if (progressGroup) {
          progressGroup.classList.toggle('hidden', job.status !== 'printing');
          document.getElementById('job-progress-input').value = job.progress || 0;
        }
      }
    } else {
      document.getElementById('job-modal-title').textContent = '排入待列印模型';
      document.getElementById('job-status-select').value = defaultStatus;
      const defaultDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      document.getElementById('job-duedate-input').value = defaultDate;
      if (progressGroup) progressGroup.classList.add('hidden');
    }

    modal.classList.remove('hidden');
  }

  openSyncModal() {
    this.isModalOpen = true;
    const modal = document.getElementById('sync-modal');
    if (!modal) return;

    document.getElementById('sync-key-input').value = this.syncKey;
    document.getElementById('custom-endpoint-input').value = this.customEndpoint;

    const mobileUrl = this.getMobileSyncUrl();
    const linkDisplay = document.getElementById('mobile-link-display');
    if (linkDisplay) linkDisplay.value = mobileUrl;

    this.renderQrCode(mobileUrl);
    modal.classList.remove('hidden');
  }

  getMobileSyncUrl() {
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
      this.showToast('已複製專屬手機同步網址！');
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

    this.closeModals();
    this.showToast('✓ 同步設定已儲存！');
    this.pullFromCloud();
    this.pushToCloud();
  }

  closeModals() {
    this.isModalOpen = false;
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
    const progressVal = parseInt(document.getElementById('job-progress-input')?.value || '0', 10);

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
        
        if (status === 'printing') {
          job.status = 'printing';
          job.progress = Math.min(100, Math.max(0, progressVal || job.progress || 10));
          this.printer.status = 'printing';
          this.printer.currentJobId = job.id;
        } else if (status === 'completed') {
          job.status = 'completed';
          job.progress = 100;
          job.completedAt = new Date().toISOString();
          if (this.printer.currentJobId === job.id) {
            this.printer.status = 'idle';
            this.printer.currentJobId = null;
          }
        } else {
          job.status = status;
          if (this.printer.currentJobId === job.id) {
            this.printer.status = 'idle';
            this.printer.currentJobId = null;
          }
        }
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
        this.queue.unshift(newJob);
        this.printer.status = 'printing';
        this.printer.currentJobId = newJob.id;
      } else {
        this.queue.push(newJob);
      }
    }

    this.saveData(true);
    this.closeModals();
    this.render();
    this.showToast('✓ 排程已成功儲存！');
  }

  showToast(message) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-medium text-xs shadow-2xl transition-all transform translate-y-12 opacity-0 pointer-events-none flex items-center gap-2';
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<svg class="w-4 h-4 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> ${message}`;
    toast.classList.remove('translate-y-12', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');

    setTimeout(() => {
      toast.classList.remove('translate-y-0', 'opacity-100');
      toast.classList.add('translate-y-12', 'opacity-0');
    }, 2500);
  }

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
            this.showToast('✓ 匯入成功！');
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
    }
    return '<span class="px-2 py-0.5 text-[10px] font-medium rounded bg-blue-950/60 text-blue-300 border border-blue-800/60">排隊中</span>';
  }

  getStatusLabel(s) {
    const map = { queued: '排隊中', printing: '列印中', completed: '已完成' };
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
