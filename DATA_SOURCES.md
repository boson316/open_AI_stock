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

目前快照在 2026-10-27 UTC 下載，含 904 筆原始及補充申報記錄（有比較期及重複申報，**不代表 904 個季度**），最新公告會計期間為 2026-09-30。Company Facts 與正式 10-Q 可能落後 earnings release；各卡片期間分別顯示，不假定同步。

## 自訂與缺值

Company Facts 不保證包含 issuer extension、維度、會員或信用風險。Inline adapter 只接受明確映射且無維度的合併 context；未知格式保留缺值。未映射的分部營收、放款、逾期、信用損失與有形淨值等仍為 N/A，不從相近欄位替代。更新未知表格布局會失敗並保留原有發布資料。

## 股價

目前沒有已確認再散布授權的自動股價來源，未呼叫非官方 Yahoo / Stooq API。使用者 CSV 必須來自其有權使用的來源，記錄來源及匯入時間；這是工作階段內本機匯入，不會跟隨部署公開。Close 配對 EPS，AdjustedClose 僅保存，不自動混用股息與分割調整基礎。無可靠價格時股價及估值卡維持 N/A。

SEC 存取免費不代表所有 issuer 文件、第三方附件或市場資料均無版權限制；公開部署前應自行確認使用情境。不得把使用者 CSV 授權擴張成再散布授權。
