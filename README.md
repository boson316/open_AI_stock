# OpenStock Analytics

免費、靜態部署的繁體中文美股財報研究平台。React / TypeScript / Vite / Tailwind CSS / Apache ECharts；Python 3.12 處理 SEC 資料。不需要付費 API、資料庫或常駐後端。

本版收錄 **SOFI、GOOGL、GOOG、NVDA、AMD、TSM、MSFT、AAPL、AMZN、META、PLTR、MU、TSLA**。13 個代號各有最近 20 個連續財季的營收、淨利與直接披露稀釋 EPS，並附正式 SEC 資料快照。GOOGL / GOOG 共用 Alphabet 的發行人財報；股價仍須按各自代號匯入。所有測試中的合成數字只存在於 `tests/`，不發布至 `public/data/`。

## 本地開發

需要 Node.js 24、Python 3.12+。在儲存庫根目錄：

```bash
npm ci
python -m venv .venv
.venv/bin/pip install -r requirements.lock
.venv/bin/pip install --no-deps -e .
npm run dev
```

開發伺服器預設使用 `/open_AI_stock/` base path。若 npm / pip 的預設快取目錄不可寫，設定 `npm_config_cache=/workspace/.cache/npm` 與 `PIP_CACHE_DIR=/workspace/.cache/pip`。Windows 請使用 `.venv\Scripts\python`。

```bash
npm run typecheck
npm run lint
npm run test
.venv/bin/pytest -q
.venv/bin/python -m openstock.validate public/data
.venv/bin/python -m openstock.coverage --check
npm run build
npx playwright install chromium
npm run test:e2e
```

已安裝 Chromium 時可設定 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`。測試會自行啟動 Vite；現有同埠開發服務可重用。正式靜態輸出為 `dist/`，`npm run preview` 可檢查產物。

## 更新官方資料

```bash
export SEC_USER_AGENT='OpenStockAnalytics your-real-contact@your-domain.com'
.venv/bin/python -m openstock.pipeline --ticker ALL --supplemental
.venv/bin/python -m openstock.validate public/data
.venv/bin/python -m openstock.coverage
```

請使用真實可聯絡的 User-Agent；`.env.example` 僅供格式參考，CLI 不會自動載入 `.env`。正式來源是 `data.sec.gov` 的 Company Facts、Submissions，以及 `www.sec.gov` 的官方申報附件。每個 client 循序請求、最多 2 次/秒、40 秒逾時、最多 4 次退避重試，快取 24 小時。請勿平行執行多個更新程序。

`--supplemental` 解析官方季度公告：美國公司以正式 8-K 補入直接披露的 Q4 EPS；SoFi 另解析最近四份會員、NIM、母公司 CET1 等補充表；TSM 解析近二十份 6-K 盈餘公告。Tesla 早期圖片表格已人工核對，來源圖片 SHA256 固定校驗，不使用 OCR 猜值。解析器遇到未知格式會拒絕猜測，更新命令失敗時保留上一有效版本。

離線可匯入**未修改的官方 Company Facts JSON**：

```bash
.venv/bin/python -m openstock.pipeline --ticker SOFI --input /path/to/companyfacts.json
```

`--input` 不會自行下載 supplemental。前端的「匯入財報 JSON」接受管線輸出的 schema，不接受原始 Company Facts；資料只保留於目前瀏覽器工作階段。

### 自訂 XBRL 標籤

以經財報核對的 `metric -> [namespace:tag]` JSON 傳入 `--mapping`。不得將分部收入冒充合併總收入。Inline XBRL 匯入例：

```bash
.venv/bin/python -m openstock.pipeline --ticker SOFI \
  --mapping /path/to/reviewed-mapping.json \
  --filing-url 'https://www.sec.gov/Archives/edgar/data/1818874/ACCESSION/DOCUMENT.htm' \
  --filed YYYY-MM-DD --accession ACCESSION --form 10-Q
```

`--filing-input /path/to/official.htm` 可取代該附件的下載，仍須提供真實來源及申報 metadata。僅接受公司識別相符、無分部維度、支援數值轉換與單位的 contexts。未映射概念、未知轉換與 continuation 留缺值，不從頁面位置猜測。

## 網站功能

- 公司搜尋僅將已生成並驗證的股票標示可用；靜態前端不會啟動 Python。
- SoFi KPI、來源明細、季度 / 年度 / TTM、YoY / 前期增率、3 / 5 年 CAGR。
- 損益、現金流、資產負債、比率與財務表格；圖例、縮放、圖表類型、全螢幕、PNG / SVG / CSV 匯出。
- 金融機構解讀、10 項條件式財報觀察、深色模式及手機版。
- 經授權股價 CSV 匯入、按申報可得日期計算的 PE 分位估值圖、使用者 ROIC / WACC 假設計算。
- 缺值明示 N/A；不將自行推算值標示為官方 Adjusted EPS，也不在資料不足時產生健康總分。

## 股價匯入

本版不使用授權範圍未確認的 Yahoo / Stooq 非官方介面。請自行取得有權使用的資料，填寫來源，確認區間不存在未處理的股票分割後匯入：

```csv
Date,Open,High,Low,Close,AdjustedClose,Volume
```

日期須為交易所本地日期 YYYY-MM-DD；數值欄位只使用小數點、不含千位逗號。AdjustedClose 可留白，但估值使用 **Close**；不把股息調整價直接配對未調整 EPS。不得把缺漏日期補成交易日或宣稱即時行情。匯入不會上傳、永久儲存或公開再散布。分割輔助函式有測試，但 UI 尚未整合公司行動事件表，因此**有分割事件的區間不能直接用來估值**。

## 新增股票

白名單位於 `scripts/openstock/pipeline.py`。全部 13 個代號已附上並驗證官方快照；以 `--ticker ALL --supplemental` 循序更新全部，或使用單一代號更新後重建 coverage 報告。Alphabet、NVIDIA、Tesla 的歷史營收標籤遷移，須先核對重疊期間數值一致，才保留各期原始標籤並連接其 accounting basis。

TSM 季度採官方 6-K 的 **TIFRS**，年度採 Company Facts / 20-F 的 **IFRS (IASB)**；兩者部分淨利與 EPS 不一致，不能混合還原季度或計算 ROE/ROA。財報使用新臺幣與普通股 EPS，美元 ADR PE/PB 在未完成可靠換算前維持 N/A。新增公司需檢查會計年度、產業、tag 映射及法定申報型態，不能只填一個 ticker。

## GitHub Actions / Pages

詳見 [DEPLOYMENT.md](DEPLOYMENT.md)。Pages 工作流程執行 Python schema / 財務測試、前端 typecheck / lint / test、Chromium E2E、正式 build，成功才部署。財報更新於週二至週六 UTC 06:30 執行，預設更新全部 13 個代號，建立資料 PR；審閱合併後由 Pages workflow 部署。更新失敗不發布損毀 JSON。

## 已知限制

近五年覆蓋指營收、淨利與稀釋 EPS，**不表示每個選用財務欄位都沒有缺值**。`public/data/coverage.json` 列出每季來源、會計期間、年度核對與選用欄位缺值，部署會檢查報告未過期且核心 20 季完整。這是可執行、可部署的版本，尚未完成需求中的所有進階功能。詳見 [PROJECT_STATUS.md](PROJECT_STATUS.md)：同 filing 累積值不足時現金流單季仍會 N/A；分部營收、放款與信用風險等補充指標尚未完整解析；健康分數未校準；Adjusted / Normalized EPS 模式尚未提供；股票分割 / ADR / 股息調整未整合至 UI。匯入資料經 schema 驗證仍不代表具有真實來源認證，使用者應核對官方申報。

相關文件：[架構](ARCHITECTURE.md) · [資料來源](DATA_SOURCES.md) · [公式](FINANCIAL_FORMULAS.md) · [部署](DEPLOYMENT.md)。僅供研究輔助，不構成投資建議。
