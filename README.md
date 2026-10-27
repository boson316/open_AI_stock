# OpenStock Analytics

免費、靜態部署的繁體中文美股財報研究平台。React / TypeScript / Vite / Tailwind CSS / Apache ECharts；Python 3.12 處理 SEC 資料。不需要付費 API、資料庫或常駐後端。

本版以 **SoFi Technologies (SOFI)** 為驗證標的。已附正式 SEC 資料快照，可直接啟動研究介面。所有測試中的合成數字只存在於 `tests/`，不發布至 `public/data/`。

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
npm run build
npx playwright install chromium
npm run test:e2e
```

已安裝 Chromium 時可設定 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`。測試會自行啟動 Vite；現有同埠開發服務可重用。正式靜態輸出為 `dist/`，`npm run preview` 可檢查產物。

## 更新官方資料

```bash
export SEC_USER_AGENT='OpenStockAnalytics your-real-contact@your-domain.com'
.venv/bin/python -m openstock.pipeline --ticker SOFI --supplemental
.venv/bin/python -m openstock.validate public/data
```

請使用真實可聯絡的 User-Agent；`.env.example` 僅供格式參考，CLI 不會自動載入 `.env`。正式來源是 `data.sec.gov` 的 Company Facts、Submissions，以及 `www.sec.gov` 的官方申報附件。每個 client 循序請求、最多 2 次/秒、40 秒逾時、最多 4 次退避重試，快取 24 小時。請勿平行執行多個更新程序。

`--supplemental` 僅支援 SoFi，循序解析最近四份官方 earnings release，包括直接揭露的 Q4 GAAP EPS、季度歷史表、會員數、季度 NIM 與明確標示為 **SoFi Technologies 母公司** 的 CET1。解析器遇到未知格式會拒絕猜測，更新命令失敗時保留上一有效版本。

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

白名單位於 `scripts/openstock/pipeline.py`。GOOGL / GOOG、NVDA、AMD、MSFT、AAPL、AMZN、META、PLTR 可執行 Company Facts 管線；仍需逐公司核對總收入定義與會計口徑，再將輸出提交。只有 SOFI 已在本次驗證並隨專案附上資料。

TSM 雖預留 CIK，20-F / 6-K、IFRS、ADR 每股單位尚未支援，不會被標示為可用。新增公司需檢查會計年度、產業、tag 映射及法定申報型態，不能只填一個 ticker。

## GitHub Actions / Pages

詳見 [DEPLOYMENT.md](DEPLOYMENT.md)。Pages 工作流程執行 Python schema / 財務測試、前端 typecheck / lint / test、Chromium E2E、正式 build，成功才部署。財報更新於週二至週六 UTC 06:30 執行，預設更新 SoFi，建立資料 PR；審閱合併後由 Pages workflow 部署。更新失敗不發布損毀 JSON。

## 已知限制

這是可執行、可部署的第一版，尚未完成需求中的所有進階功能。詳見 [PROJECT_STATUS.md](PROJECT_STATUS.md)：同 filing 累積值不足時現金流單季仍會 N/A；分部營收、放款與信用風險等補充指標尚未完整解析；健康分數未校準；Adjusted / Normalized EPS 模式尚未提供；股票分割 / ADR / 股息調整未整合至 UI。匯入資料經 schema 驗證仍不代表具有真實來源認證，使用者應核對官方申報。

相關文件：[架構](ARCHITECTURE.md) · [資料來源](DATA_SOURCES.md) · [公式](FINANCIAL_FORMULAS.md) · [部署](DEPLOYMENT.md)。僅供研究輔助，不構成投資建議。
