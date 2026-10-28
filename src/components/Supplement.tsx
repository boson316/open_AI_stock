import { csvDownload } from "../lib/finance";
import { useResearch } from "../lib/research";
import type { ResearchQuarter } from "../lib/research";

const ROWS: [keyof ResearchQuarter, string, "money" | "pct" | "x"][] = [
  ["pretax", "稅前淨利率", "pct"],
  ["buyback", "買回庫藏股", "money"],
  ["div", "現金股利", "money"],
  ["acq", "其中：併購", "money"],
  ["sec", "其中：有價證券淨買賣", "money"],
  ["cash", "現金及投資", "money"],
  ["debt", "總債務", "money"],
  ["net_cash", "淨現金（負為淨負債）", "money"],
  ["roe", "ROE（單季年化）", "pct"],
  ["roa", "ROA", "pct"],
  ["roic", "ROIC", "pct"],
  ["de", "負債 ÷ 權益", "x"],
  ["cr", "流動比率", "x"],
  ["pe", "本益比（季末）", "x"],
  ["pb", "股價淨值比（季末）", "x"],
  ["ev_ebitda", "EV／EBITDA（季末）", "x"],
  ["fcf_yield", "FCF 殖利率（季末）", "pct"],
];
const fmt = (v: number | null, kind: "money" | "pct" | "x") =>
  v === null || !Number.isFinite(v)
    ? "N/A"
    : kind === "pct"
      ? `${v.toFixed(1)}%`
      : kind === "x"
        ? `${v.toFixed(2)}×`
        : v.toLocaleString("zh-TW", { maximumFractionDigits: 1 });

/** 官方資料沒有的補充欄位（近四季，外部資料）；官方已有的營收、獲利、現金流不重複列出。 */
export function Supplement({ base, ticker }: { base: string; ticker: string }) {
  const { data } = useResearch(base);
  if (!data) return null;
  const key = ticker === "GOOG" ? "GOOGL" : ticker;
  const rows = data.quarterly[key];
  if (!rows?.length) return null;
  const unit = ticker === "TSM" ? "億新臺幣" : "億美元";
  return (
    <div className="panel statement">
      <div className="panel-head">
        <div>
          <h3>補充指標（近四季，外部資料）</h3>
          <span className="muted small">
            官方 SEC 未收錄的欄位，取自使用者提供的研究資料（{data.as_of}）；金額單位 {unit}，資本回饋為現金流出（負值）。
          </span>
        </div>
        <button
          className="button secondary"
          onClick={() =>
            csvDownload(`${ticker}-supplement.csv`, [
              ["指標", ...rows.map((r) => `${r.quarter} (${r.end})`)],
              ...ROWS.map(([k, label]) => [label, ...rows.map((r) => r[k] as number | null)]),
            ])
          }
        >
          匯出 CSV
        </button>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>指標</th>
              {rows.map((r) => (
                <th key={r.end}>
                  {r.quarter}
                  <small className="cell-meta">{r.end}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([k, label, kind]) => (
              <tr key={k}>
                <th>{label}</th>
                {rows.map((r) => (
                  <td key={r.end}>{fmt(r[k] as number | null, kind)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        ROE 為單季稅後淨利 × 4 ÷ 平均股東權益，會被業外收益、稅項推高或壓低；ROIC 為資料商頁面值。季末估值以季末收盤價計。
      </p>
    </div>
  );
}

const FIELD: Record<string, string> = {
  revenue: "營收",
  gross_profit: "毛利",
  operating_income: "營業利益",
  net_income: "稅後淨利",
  eps: "EPS",
  ocf: "營業現金流",
  capex: "資本支出",
  icf: "投資現金流",
  financing_cf: "融資現金流",
};

/** 外部資料與官方 SEC 的逐筆核對結果，公開列出差異。 */
export function Reconciliation({ base }: { base: string }) {
  const { data } = useResearch(base);
  if (!data) return null;
  const r = data.reconciliation;
  return (
    <div className="panel prose reconciliation">
      <h3>外部研究資料 × 官方 SEC 核對</h3>
      <p>
        已比對 <strong>{r.checked}</strong> 筆重疊的季度財報數字，<strong>{r.matched}</strong> 筆一致，<strong>{r.mismatches.length}</strong>{" "}
        筆不一致；不一致時本站一律顯示官方值，外部資料只用於官方沒有的欄位（行情、估值倍數、資本回饋、現金與負債、ROE／ROIC、13F、總經）。
      </p>
      <p className="muted small">{r.rule}</p>
      {r.mismatches.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>代號</th>
                <th>季度</th>
                <th>欄位</th>
                <th>官方 SEC</th>
                <th>外部資料</th>
                <th>差異</th>
              </tr>
            </thead>
            <tbody>
              {r.mismatches.map((m) => (
                <tr key={m.ticker + m.end + m.field}>
                  <th>{m.ticker}</th>
                  <td>
                    {m.quarter}
                    <small className="cell-meta">{m.end}</small>
                  </td>
                  <td>{FIELD[m.field] ?? m.field}</td>
                  <td>
                    {m.official.toLocaleString("zh-TW")} {m.unit}
                  </td>
                  <td>
                    {m.external.toLocaleString("zh-TW")} {m.unit}
                  </td>
                  <td>{(m.external - m.official).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        常見原因：資料商把一次性費用歸到不同季度、採非 GAAP 毛利口徑，或 TSM 使用不同的報表版本。外部資料另有：個人帳戶與持股不上公開網站；「依記憶整理」的 2022 跌幅不收錄；TSM
        市值單位不一致故不顯示。
      </p>
    </div>
  );
}
