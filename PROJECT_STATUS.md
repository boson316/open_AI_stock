# 目前交付狀態

- 收錄 SOFI、GOOGL、GOOG、NVDA、AMD、TSM、MSFT、AAPL、AMZN、META、PLTR、MU、TSLA。
- 每個代號最近 20 個連續財季的營收、淨利及直接披露稀釋 EPS 已取得，共 260 個代號／財季；GOOGL 與 GOOG 共用 Alphabet 發行人財報。
- `public/data/coverage.json` 保存精確季度起迄、單位、申報日、原始標籤、來源、年報合計檢查及選用欄位缺值。部署拒絕缺季、不連續、單位錯誤、過期報告或可比年報核對失敗。
- Q4 EPS 採直接披露，沒有從全年／YTD EPS 相減。52/53 週及非曆年財年按實際日期處理。
- Palantir 淨利以歸屬普通股股東口徑對應年報，修正非控制權益及 HTML 括號分格的處理。
- TSM 季度為 TIFRS、年度為 IFRS (IASB)，新臺幣與普通股 EPS。不可比年度淨利不硬湊相等；ROE/ROA 與美元 ADR PE/PB 暫不混算。
- Tesla 早期圖片表格已人工核對，固定來源圖片 SHA256，保留發行人重列拆股 EPS 的註記。
- 前端支援各股票搜尋、來源明細、季度／年度／TTM、互動圖表、CSV/PNG/SVG、深色模式與響應式版面；非金融公司不顯示銀行指標或銀行風險模型。
- **現金流**：每檔最新 20 個連續財季的 OCF、ICF、融資現金流、CapEx、SBC 皆有值；FCF = OCF − |CapEx|，coverage 逐季記錄。US 股票單季值取自官方 3 個月數據、同申報或穩定同財年申報群組的累計相減（兩筆來源與推算紀錄保存在 `source_refs`／`lineage`）；TSM 為合併 TIFRS 6-K 表格（新臺幣）；NVDA 歷史 CapEx 為官方原件核對值。現金流截止日可能早於最新盈餘公告日，畫面明確顯示。META 2022、TSLA 2023 年度 CapEx 比較數後來修訂，標記 `different_vintage`，不把差額塞入 Q4。
- **毛利率**：毛利 / 同期間營收，近 20 季皆有值（除 SOFI）。優先採官方 GrossProfit；GOOGL、GOOG、AMZN、META 及 NVDA 缺漏季度採同期間、同申報、同單位的「營收 − 營業成本」（標記 calculated）；Q4 由穩定 vintage 的全年減九個月還原，或採官方 8-K/6-K 直接披露。不以營業利益替代。SOFI 為金融公司，明確標示「毛利率不適用」且圖例不顯示。已與 SEC Company Facts 獨立比對（直接披露季度皆一致；營收減成本及 Q4 還原皆一致）。
- **發布門檻**：`python -m openstock.coverage` 現在同時要求核心損益、現金流及毛利率三項通過，否則失敗；`--check` 驗證報告未過期。
- 本地測試（本輪重跑）：pytest 48 項、Vitest 10 項、Chromium E2E 6 項（含逐檔現金流 20 列 CSV、逐檔毛利率 CSV 與 coverage 數值一致、SOFI 不適用），typecheck、lint、production build 通過。最後正式站結果以實際 workflow 為準。

## 仍有的限制

- **20 季完整覆蓋指核心損益、五項現金流及（適用者）毛利率；其他選用欄位仍可能為 N/A**，每季缺值均在 coverage 報告揭露，不以零或不相容期間補齊。歷史季度保留當時可得申報口徑，未按最新年度修訂逐季重編。
- 部分銀行信用、放款、分部資料未完整解析。健康評分未校準，拒絕產生總分。
- 無已確認可公開再散布的自動免費股價來源。CSV 需使用者有權使用；目前沒有整合全股票公司行動與匯率事件，不宣稱全系列已統一拆股調整。
- 歷史 EPS 為該期最新可得申報／官方比較披露。跨拆股及重編比較須核對來源；Adjusted/Normalized EPS 尚未提供。
- 來源表格改版可能需更新明確 adapter。未知格式、圖片 hash 改變及核心缺季會阻擋發布。
- GitHub Repository variable `SEC_USER_AGENT` 需由管理員填入真實公開聯絡資訊；目前 integration 沒有新增／讀取此 variable 的權限（403）。現有網站使用已下載的正式快照，不需此 variable 才能瀏覽。
- 尚未驗證雲端設定發布後的新 task snapshot restoration。ECharts bundle 仍有可進一步分割的大小提示。
