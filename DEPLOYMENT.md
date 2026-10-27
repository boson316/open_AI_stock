# 免費部署與自動更新

## GitHub Pages

1. 將本機專案檔案（含 `package-lock.json`、`requirements.lock`、`public/data/`）提交並推送至 `boson316/open_AI_stock` 的 `main`。本次實作尚未自動推送或建立遠端分支。
2. Repository Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。
3. Settings → Actions → General，允許 Actions 執行；財報更新須允許 workflow 建立 PR（不授予無關權限）。
4. Settings → Secrets and variables → Actions → Variables，設定 `SEC_USER_AGENT` 為專案名稱與可公開聯絡信箱。不需要付費 API key。
5. `GitHub Pages` workflow 可從 Actions 手動執行，或由 main 的 push 觸發。核對 build / deploy jobs 結果及 GitHub 提供的部署 URL。

Pages workflow 權限為 contents read、pages write、id-token write；使用 github-pages environment 和 concurrency。部署前執行 pytest、catalog schema 驗證、TypeScript、ESLint、Vitest、Chromium E2E 與 Vite build，才 upload artifact / deploy。

`VITE_BASE_PATH=/<repository-name>/` 由 workflow 注入。預設 `/open_AI_stock/` 適合此 repository；若部署至自訂網域根目錄或 owner.github.io 根 repository，使用 `/`。所有 JSON 與 assets 都經 `import.meta.env.BASE_URL` 存取。

## 財報更新

`Financial Update` 週二至週六 UTC 06:30 執行（台北 14:30），也可手動選白名單 ticker。預設 SoFi 同時抓 Company Facts 和最近四份官方 earnings release。流程執行財務測試、完整生成與 schema 驗證後，建立或更新 `automation/financial-data` PR。資料 PR 合併後才觸發 Pages workflow。

使用 PR 是因為 workflow 的 GITHUB_TOKEN 自動 push 通常不會觸發下一個 push workflow。這裡不依賴 token 連鎖部署，也未替使用者合併 PR。排程本身只由預設分支載入；帳戶額度與平台免費政策以 GitHub 當時規定為準。

更新失敗會在 Actions logs 顯示錯誤，不修改已發布快照。前端繼續顯示上一有效版本的會計期間與生成時間。若資料本身無變更，PR action 可不建立新的差異。

## Codex 雲端環境

安裝與啟動指令會另存至 environment configuration draft。review / save 與 **publish environment** 是不同步驟；工具儲存草稿不代表已發布，也不代表已部署 GitHub Pages。SEC 必要網域：`data.sec.gov`、`www.sec.gov`；套件 registry 依既有 package-manager preset。

使用既有 `/workspace/open_AI_stock` checkout，每個 task 已隔離，不要建立額外 Git worktree。快照可以保留依賴及檔案，不能假設 Vite process 在新 task 還活著；依 startup instructions 重啟並驗證 HTTP 和實際介面。
