# 3D 列印模型排程佇列系統 (PC & 手機即時同步版)

專為單一 3D 印表機管理者打造的**跨裝置模型佇列排程與追蹤系統**。

🌐 **線上公開網址**：[https://lirulai.github.io/3d_printing/](https://lirulai.github.io/3d_printing/)  
📦 **GitHub 儲存庫**：[https://github.com/LiruLai/3d_printing](https://github.com/LiruLai/3d_printing)

---

## 🌟 核心特色

1. **唯一管理者跨裝置即時同步 (PC & 手機)**：
   - 💻 **在 PC 上**：舒適鍵盤輸入模型規格、提需求同仁、交期等排程資訊。
   - 📱 **在印表機旁拿手機**：打開線上網址或手機相機掃描 PC 螢幕上的 **專屬 QR Code**，直接無痛開啟管理介面。
   - ⚡ **雙向即時更新**：在手機點擊「開始列印」、「完工」或「微調順位」，PC 端即時同步刷新；反之亦然！
   - 🛡️ **離線自動保底**：斷網或弱網時自動於本機儲存 (LocalStorage)，網路恢復後自動重試同步。

2. **清楚標示 5 大核心資訊**：
   - 📌 **模型名稱**：零件標題與組件名稱。
   - 👤 **提需求的人員**：需求同仁或專案負責人。
   - 🎨 **3D 檔案提供者**：繪製或提供切片 STL/STEP 檔案的人員。
   - 🎯 **使用目的**：外觀樣品、機構干涉驗證、產線夾治具等。
   - 📅 **需求日期**：期望交付日，系統動態計算「今天到期」、「N天後到期」或紅色「逾期警示」。

3. **靈活的排隊順位調控**：
   - 「排程佇列」清楚標示 `排隊 #1`、`排隊 #2`...
   - 點擊 **⬆ 上移 / ⬇ 下移** 即可隨時依現場緊急狀況插單或延後。

4. **三重視圖切換**：
   - **排程佇列 (Queue)**：依序顯示排隊清單與 5 大資訊。
   - **狀態看板 (Kanban)**：排隊佇列中 ➔ 正在列印 ➔ 已完工 ➔ 異常重印，卡片可拖曳。
   - **完工歷史 (History)**：歷史紀錄留存，可一鍵重新排印。

---

## 🚀 GitHub Pages 啟用方式（只需設定一次）

1. 前往 GitHub 儲存庫設定：[https://github.com/LiruLai/3d_printing/settings/pages](https://github.com/LiruLai/3d_printing/settings/pages)
2. 在 **Build and deployment** 區塊：
   - **Source**：選擇 `Deploy from a branch`
   - **Branch**：選擇 `main`，資料夾保持 `/ (root)`
   - 點擊 **Save**
3. 約 30 秒至 1 分鐘後，即可在手機或 PC 開啟專屬公開網址：  
   👉 **[https://lirulai.github.io/3d_printing/](https://lirulai.github.io/3d_printing/)**
4. 建議在手機瀏覽器點擊「**加入主畫面**」，即可像原生 App 一樣一鍵啟動！
