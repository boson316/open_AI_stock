# 目前交付狀態

- 收錄 SOFI、GOOGL、GOOG、NVDA、AMD、TSM、MSFT、AAPL、AMZN、META、PLTR、MU、TSLA。
- 每個代號最近 20 個連續財季的營收、淨利及直接披露稀釋 EPS 已取得，共 260 個代號／財季；GOOGL 與 GOOG 共用 Alphabet 發行人財報。
- `public/data/coverage.json` 保存精確季度起迄、單位、申報日、原始標籤、來源、年報合計檢查及選用欄位缺值。部署拒絕缺季、不連續、單位錯誤、過期報告或可比年報核對失敗。
- Q4 EPS 採直接披露，沒有從全年／YTD EPS 相減。52/53 週及非曆年財年按實際日期處理。
- Palantir 淨利以歸屬普通股股東口徑對應年報，修正非控制權益及 HTML 括號分格的處理。
- TSM 季度為 TIFRS、年度為 IFRS (IASB)，新臺幣與普通股 EPS。不可比年度淨利不硬湊相等；ROE/ROA 與美元 ADR PE/PB 暫不混算。
- Tesla 早期圖片表格已人工核對，固定來源圖片 SHA256，保留發行人重列拆股 EPS 的註記。
- 前端支援各股票搜尋、來源明細、季度／年度／TTM、互動圖表、CSV/PNG/SVG、深色模式與響應式版面；非金融公司不顯示銀行指標或銀行風險模型。
- 本地測試：pytest 37 項、Vitest 10 項、Chromium E2E 4 項，包含全部新增代號切換；最後 CI 結果以實際 workflow 為準。
- Pages 已啟用，先前 SoFi 版本 run `40544116493` 成功部署。多股票及 20 季版本將經新版 CI 後更新同一網站。

## 仍有的限制

- **20 季完整覆蓋指核心營收／淨利／EPS，不表示每個選用財務欄位都有值。** OCF、ICF、融資現金流、CapEx、SBC 等若缺少相容同申報運算元，仍為 N/A；每季缺值均在 coverage 報告揭露，不以零或不相容期間補齊。
- 部分銀行信用、放款、分部資料未完整解析。健康評分未校準，拒絕產生總分。
- 無已確認可公開再散布的自動免費股價來源。CSV 需使用者有權使用；目前沒有整合全股票公司行動與匯率事件，不宣稱全系列已統一拆股調整。
- 歷史 EPS 為該期最新可得申報／官方比較披露。跨拆股及重編比較須核對來源；Adjusted/Normalized EPS 尚未提供。
- 來源表格改版可能需更新明確 adapter。未知格式、圖片 hash 改變及核心缺季會阻擋發布。
- GitHub Repository variable `SEC_USER_AGENT` 需由管理員填入真實公開聯絡資訊；目前 integration 沒有新增／讀取此 variable 的權限（403）。現有網站使用已下載的正式快照，不需此 variable 才能瀏覽。
- 尚未驗證雲端設定發布後的新 task snapshot restoration。ECharts bundle 仍有可進一步分割的大小提示。
