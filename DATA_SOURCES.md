# 資料來源與限制

## 官方財報

- [SEC API 文件](https://www.sec.gov/edgar/sec-api-documentation)
- [SEC Fair Access](https://www.sec.gov/os/accessing-edgar-data)
- [SoFi Company Facts](https://data.sec.gov/api/xbrl/companyfacts/CIK0001818874.json)
- [SoFi Submissions](https://data.sec.gov/submissions/CIK0001818874.json)
- [2026 Q3 官方盈餘公告](https://www.sec.gov/Archives/edgar/data/1818874/000181887426000065/a2026q3earningsrelease.htm)
- [2025 Q4 官方盈餘公告](https://www.sec.gov/Archives/edgar/data/1818874/000181887426000008/a2025q4earningsrelease.htm)

下載以環境變數 `SEC_USER_AGENT` 提供可聯絡資訊；不得放入虛構信箱。每個 client 至多每秒 2 次、循序執行，快取 24 小時，40 秒逾時，對 429 / 5xx 退避重試；403 不重複轟炸。TLS 驗證保持開啟。不要同時運行多個獨立更新程序。

## SoFi 會計口徑

總營收使用 `us-gaap:RevenuesNetOfInterestExpense`。`RevenueFromContractWithCustomerExcludingAssessedTax` 只是部分營收，不能套用為 SoFi 合併總營收。2021-06-30 之前的 SPAC 時期排除；不把收購前殼公司數字當作 SoFi 歷史。

官方盈餘公告的表格資料以 `disclosure:sofi.*` 作為來源行識別，**不是原始 XBRL tag**。直接揭露的 Q4 EPS 是 reported，不是累積 EPS 相減。可證實口徑相同的四個概念（總淨營收、GAAP 淨利、GAAP 稀釋 EPS、淨利息收入）設明確等價表，供 TTM 跨來源加總。未定義的標籤不能混用。

CET1 明確選擇 SoFi Technologies 母公司，不能視為 SoFi Bank 資本比率。NIM 採當季平均餘額表官方揭露，不從期末資產或存款自行推算。會員數 / 產品數為官方營運披露，並非會計審計意見。

每筆保存 value、unit、start/end、filed、accession、tag、source、form、quality 及 lineage。`updated` 是下載/生成時間，**不是財報期間，也不是即時報價時間**。同一日期不同 filing 的數值均保留；畫面採最新可得版本，歷史估值採 as-of。

目前快照包含 13 個代號各自最近 20 個連續財季（共 260 個代號／財季，GOOG / GOOGL 共用發行人資料）。核心欄位為營收、淨利及直接披露稀釋 EPS；每個值與選用欄位缺值皆記錄於 `public/data/coverage.json`。各公司財年不同，最新公告期間亦不同。Company Facts 與正式 10-Q 可能落後 earnings release；各卡片期間分別顯示，不假定同步。

## 自訂與缺值

Company Facts 不保證包含 issuer extension、維度、會員或信用風險。Inline adapter 只接受明確映射且無維度的合併 context；未知格式保留缺值。未映射的分部營收、放款、逾期、信用損失與有形淨值等仍為 N/A，不從相近欄位替代。更新未知表格布局會失敗並保留原有發布資料。

## 股價

目前沒有已確認再散布授權的自動股價來源，未呼叫非官方 Yahoo / Stooq API。使用者 CSV 必須來自其有權使用的來源，記錄來源及匯入時間；這是工作階段內本機匯入，不會跟隨部署公開。Close 配對 EPS，AdjustedClose 僅保存，不自動混用股息與分割調整基礎。無可靠價格時股價及估值卡維持 N/A。

SEC 存取免費不代表所有 issuer 文件、第三方附件或市場資料均無版權限制；公開部署前應自行確認使用情境。不得把使用者 CSV 授權擴張成再散布授權。

## TSM 最新季度與會計口徑

TSM 6-K 季度盈餘公告可從 Submissions 找到，最新收錄 [2026 Q3 官方公告](https://www.sec.gov/Archives/edgar/data/1046179/000104617926000726/a3q26e_withguidancexfinal.htm)。舊公告的分頁表格與分行標頭已處理，並核對 20 個連續財季。季度數字依公告的 **TIFRS**，不是美元 ADR 財務數字。

[2024 年 20-F](https://www.sec.gov/Archives/edgar/data/1046179/000119312525083423/d896993d20f.htm) 明示依 IASB IFRS 編製，部分淨利及 EPS 與季度 TIFRS 公告合計不同。程式不將差異強行調整成相等，不混算兩種口徑的 ROE/ROA。報告將不可比年報核對列為 `not_comparable`，而不是通過。

## 直接 Q4 與人工核對來源

美國公司從官方 8-K earnings release 取得直接披露的 Q4；不做全年 EPS 減九月 EPS。負數括號分在不同 HTML cell、非控制權益與普通股股東淨利分別處理。

Tesla 2022 update 的圖片版 [slide 4](https://www.sec.gov/Archives/edgar/data/1318605/000156459023000799/slide-g0lictaep2w.jpg) 已人工逐項核對 2021Q4–2022Q4；其比較 EPS 已由發行人按 2022 年三拆一重列。資料及 SHA256 來源校驗位於 `tesla_verified.py`。其他歷史每股值仍保留各期申報披露口徑，未宣稱所有股票的五年 EPS 均已統一調整全部拆股事件。

Stock Analysis、Morningstar、GuruFocus、Yahoo、TradingView 等可供交叉查閱；本次未使用其商業資料作為公開再散布來源，也未確認其擷取授權。宏觀研究可另查 FRED，各系列仍須保留來源與條款。

## 現金流季度與申報群組

現金流五項（OCF、ICF、融資、資本支出、SBC）各自核對最新 20 個連續且已披露的季度；可能早於最新盈餘公告。`coverage.json` 的 `cashflow` 保存每季數值、完整來源、兩筆運算元、可知日期、會計準則與年度／十二個月合計檢查。

同 accession 可還原單季；跨 accession 僅接受同報告財年 vintage、同累積起日、標籤、單位與 US GAAP／TIFRS 口徑，且前後累計階段及期間相鄰。群組內同一期間有衝突或 `/A` 修訂時拒絕跨申報相減。直接季度優先，衍生值的 filed 為兩筆來源較晚日期，保存 `source_refs`。此規則僅適用可加總現金流，不適用 EPS、股數或利率。

TSM 現金流改用官方 **合併 TIFRS 6-K 完整財報**，例如 [2026 H1](https://www.sec.gov/Archives/edgar/data/1046179/000104617926000541/a2026q2consolidatedreport-.htm)。明確核對「In Thousands of New Taiwan Dollars」後乘 1,000，拒絕母公司個別報表；營業現金流取稅後淨額，資本支出取購置 PPE 支付款，排除處分收入。採當期及比較期 YTD 配對，保留原文件 SHA256。

SOFI、NVDA、AMZN 的 CapEx 明確採 `PaymentsToAcquireProductiveAssets`，包含設備、軟體及其他無形資產；不宣稱與只含 PPE 的其他公司定義相同。

META 2022 與 TSLA 2023 的 CapEx 年度比較數後來有修訂，但未取得所有季度重編分攤。歷史季度保持可驗證的披露 vintage，四季與同 vintage 年度核對；與最新版年比較數的差異標記 `different_vintage`，不任意塞入 Q4。

## 介面參考

新版資訊層級參考 [Ghostfolio](https://github.com/ghostfolio/ghostfolio)、[TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts)、[OpenBB](https://github.com/OpenBB-finance/OpenBB) 的公開設計：圖表優先、緊湊摘要、快速選股及手機底部分頁。沒有複製品牌素材或商業資料。

## 毛利與現金流補充（本輪）

- 毛利：GrossProfit 標籤、官方 8-K/6-K 直接披露，或 `profit.py` 審核過的 Alphabet、NVIDIA、Amazon、Meta「營收 − CostOfRevenue」（同期間、同 accession、同單位；`tag=calculated:revenue-minus-cost`，保存兩筆來源）。`coverage.py` 檢查同期間單位一致、毛利不超過營收、不等於營業利益、標籤屬於審核清單。
- 現金流：見 PROJECT_STATUS.md。`handoff/reference/official-source-table-inspection.json` 保存官方表格擷取（含個別與合併報表，須篩選合併）。
