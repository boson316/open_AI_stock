# 交付與驗證狀態

本紀錄區分可用功能、已執行測試、未完成需求與尚未進行的外部發布。不是宣稱 master prompt 全部功能已完成。

| Phase | 狀態與證據 |
|---|---|
| 1：檢查與架構 | 遠端初始為空儲存庫、main 不存在；在既有 checkout 建立專案，未建立 worktree。架構見 ARCHITECTURE.md。 |
| 2：前端與設計系統 | React / TS / Tailwind / ECharts / Lucide；繁中、深色、響應式、搜尋、匯入、匯出及缺值狀態已實作。 |
| 3：SEC 管線 | 已實際下載 Company Facts、Submissions、官方 10-Q Inline XBRL 與四份 earnings release；schema、同版本季度推算、tag 映射、快取及原子輸出已驗證。 |
| 4：SoFi | 淨營收口徑已核對；官方 Q4 EPS 直接披露、TTM、NIM、母公司 CET1、會員與產品數可用。其他信用、放款與分部指標未完整解析，明示 N/A。 |
| 5：圖表與表格 | 損益、EPS、成長、現金流、資產負債、比率、季度/年度/TTM、單位及匯出已實作。資料缺漏的圖表保留缺值；不因缺任一指標使頁面崩潰。 |
| 6：估值 | CSV、point-in-time 正 PE、五條分位估值線、對數軸、ROIC/WACC 使用者假設已實作。Adjusted/Normalized EPS、聚焦價格模式、band deviation tooltip、分割事件 UI 尚未完成。 |
| 7：Actions / Pages | 兩套 workflow 已建立，含測試 gate / cache / permissions / artifacts / update PR；已推送 main；目前環境對 GitHub API 連線回傳 403，尚未確認遠端 Actions / Pages 部署結果。 |
| 8：測試 | pytest 18 項、Vitest 9 項、Chromium E2E 3 項通過；TypeScript、ESLint、Vite build 與 catalog 驗證通過。正式 dist 以瀏覽器驗證 HTTP 200、SoFi TTM 卡及無 page error。 |
| 9：文件 | README、ARCHITECTURE、DATA_SOURCES、FINANCIAL_FORMULAS、DEPLOYMENT 及本檔已完成。 |

## 已確認的資料限制

- 單季累積值相減要求同 accession；不跨未核實申報版本。部分 OCF/ICF/financing/CapEx/SBC 單季與 FCF 無法完整還原，維持 N/A。
- 對直接公司補充披露定義明確的 revenue/net income/EPS/NII，才允許與標準概念做 TTM；不將部分客戶合約收入當作 SoFi 總營收。
- 官方資料快照含 904 筆 raw / supplemental facts，最新期間 2026-09-30；不是即時行情，且各指標期間可能不同。
- 信用沖銷、逾期、個人/學生貸款發放額、貸存比、有形淨值與分部等尚缺已驗證 adapter，未宣稱完成。
- 無已核實可再散布的自動免費行情；用戶必須有權使用其 CSV。分割/ADR/股息不自動判定。TSM IFRS 未支援，其他白名單股票尚未逐一 live 驗證。
- 會員成長及產品/會員比等擴展指標、ROE/ROA 歷史圖、完整報表表內 YoY/QoQ、自動英文切換仍待擴展。
- 健康評分缺已校準門檻及完整信用資料，不產生總分。規則分析不解釋未知變動原因。
- 官方 supplemental parser 為明確表頭 adapter，issuer 改版可能需要維護；不保證解析所有歷史 SEC 格式。
- 單檔 atomic replace 不等於跨檔 transaction，生成需單一程序，CI 在發布前驗證 catalog 與公司 JSON 一致。
- 正式 build 成功，ECharts 相關主 bundle 約 871 kB（gzip 約 290 kB），Vite 仍有 chunk size 提示，後續可進一步分割載入。

## 發布前外部步驟

程式碼已推送 main。仍需啟用 Pages Actions、填 SEC_USER_AGENT repository variable，執行並檢查遠端 workflow。雲端環境 draft 需使用者檢閱、儲存並發布；未驗證新 task 的 snapshot restoration。

雲端 `install_script`、`start_skill` 已儲存，安裝腳本已在本機實際重跑成功；已新增 SEC 兩個網域與 SEC_USER_AGENT 變數需求/建議值。開發服務啟動指令已執行。GitHub 程式碼與 workflow 已推送；Pages 上線及雲端 snapshot 發布尚未確認。
