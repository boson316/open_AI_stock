import { ExternalLink } from "lucide-react";
import { FinancialChart } from "./FinancialChart";
import { useResearch } from "../lib/research";
import type { Etf, Research } from "../lib/research";

const num = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "N/A" : v.toLocaleString("zh-TW", { maximumFractionDigits: d });
const host = (u: string | null) => {
  try {
    return u ? new URL(u).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
};

export function Market({ base, dark, onSelect }: { base: string; dark: boolean; onSelect: (t: string) => void }) {
  const { data, error } = useResearch(base);
  if (error) return <div className="notice error" role="alert">研究資料讀取失敗：{error}</div>;
  if (!data) return <p className="muted">載入市場資料中…</p>;
  const m = data.market;
  const val = data.commentary.VAL ?? [];
  const cape = [...m.cape_us].sort((a, b) => a.t - b.t);
  const capeDates = cape.map((r) =>
    Number.isInteger(r.t)
      ? `${r.t}-01-01`
      : r.label.replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, (_, y, mo, d) => `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`),
  );
  return (
    <section id="market" className="market">
      <div className="section-title">
        <div>
          <span className="eyebrow">MARKET VALUATION</span>
          <h2>台美估值與總經</h2>
        </div>
      </div>
      <p className="muted">
        市場層級的估值與總經背景，資料來自 Siblis Research、Multpl、新聞與分析（使用者整理，各列附來源與日期）。估值指標適合判斷未來幾年的預期報酬與部位大小，不適合抓進出場時機。
      </p>
      <div className="panel">
        <div className="panel-head">
          <h3>台美估值指標</h3>
          <span className="muted small">各指標日期與口徑不同，請看每列來源</span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>指標</th>
                <th>台股</th>
                <th>台股參考</th>
                <th>美股</th>
                <th>美股參考</th>
                <th>說明</th>
              </tr>
            </thead>
            <tbody>
              {m.metrics.map((r) => (
                <tr key={r.id}>
                  <th>{r.metric}</th>
                  <td>
                    <strong>{num(r.tw_now)}</strong>
                    <small className="cell-meta">
                      {r.tw_asof ?? ""} {r.tw_src && <a href={r.tw_src} target="_blank" rel="noreferrer">{host(r.tw_src)}</a>}
                    </small>
                  </td>
                  <td>
                    {num(r.tw_ref)}
                    <small className="cell-meta">{r.tw_ref_label}</small>
                  </td>
                  <td>
                    <strong>{num(r.us_now)}</strong>
                    <small className="cell-meta">
                      {r.us_asof ?? ""} {r.us_src && <a href={r.us_src} target="_blank" rel="noreferrer">{host(r.us_src)}</a>}
                    </small>
                  </td>
                  <td>
                    {num(r.us_ref)}
                    <small className="cell-meta">{r.us_ref_label}</small>
                  </td>
                  <td className="wrap">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="chart-grid">
        <FinancialChart
          title="美股席勒本益比（Shiller CAPE）"
          dark={dark}
          unit="倍"
          initialType="line"
          dates={capeDates}
          series={[{ name: "S&P 500 CAPE", values: cape.map((r) => r.cape) }]}
        />
        <FinancialChart
          title="各國席勒本益比（Siblis 同口徑）"
          dark={dark}
          unit="倍"
          plainAxis
          dates={m.cape_country.map((r) => r.country)}
          series={[
            { name: "2026 年 9 月", values: m.cape_country.map((r) => r.cape_2026) },
            { name: "2025 年 9 月", values: m.cape_country.map((r) => r.cape_2025) },
          ]}
        />
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>股票 vs 公債殖利率</h3>
          <span className="muted small">盈餘殖利率低於公債殖利率時，股票相對債券的風險溢酬為負</span>
        </div>
        <div className="yield-grid">
          {m.yields.map((y) => (
            <div key={y.id} className="yield-card">
              <span>{y.label}</span>
              <div>
                <small>台股</small>
                <strong>{y.tw}%</strong>
              </div>
              <div>
                <small>美股</small>
                <strong>{y.us}%</strong>
              </div>
              <p className="muted small">{y.note}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>總經背景</h3>
          <span className="muted small">新聞與分析整理；預估值不是事實</span>
        </div>
        <div className="macro-grid">
          {m.macro.map((x) => (
            <div key={x.id} className="macro-card">
              <span className="muted small">{x.label}</span>
              <strong>{x.value}</strong>
              <p>{x.detail}</p>
              <small className="muted">
                {x.asof} ·{" "}
                <a href={x.url} target="_blank" rel="noreferrer">
                  {host(x.url)} <ExternalLink size={11} />
                </a>
              </small>
            </div>
          ))}
        </div>
      </div>
      {val.length > 0 && <Notes title="估值觀察" items={val} />}
      <div className="section-heading">
        <div>
          <h2>相關 ETF</h2>
          <p>ETF 沒有財報，改看持股、費用與估值；藍色為本站收錄的個股</p>
        </div>
      </div>
      <div className="chart-grid">
        {data.etf.map((e) => (
          <EtfCard key={e.ticker} etf={e} data={data} onSelect={onSelect} />
        ))}
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>防禦型選項（民生、國庫券）</h3>
          <span className="muted small">生意抗跌不等於股價抗跌：看本益比與 Beta</span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>代號</th>
                <th>名稱</th>
                <th>收盤</th>
                <th>本益比</th>
                <th>預估本益比</th>
                <th>Beta</th>
                <th>殖利率</th>
                <th>說明</th>
              </tr>
            </thead>
            <tbody>
              {data.defensive.map((d) => (
                <tr key={d.ticker}>
                  <th>{d.ticker}</th>
                  <td className="wrap">{d.name}</td>
                  <td>{num(d.close)}</td>
                  <td>{d.pe ? `${d.pe}×` : "N/A"}</td>
                  <td>{d.fwd_pe ? `${d.fwd_pe}×` : "N/A"}</td>
                  <td>{d.beta ?? "N/A"}</td>
                  <td>{d.div_yield !== null ? `${d.div_yield}%` : "N/A"}</td>
                  <td className="wrap">{d.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">2026-10-14 收盤，取自 stockanalysis.com（使用者整理）。僅供研究，不構成投資建議。</p>
      </div>
    </section>
  );
}

function EtfCard({ etf, data, onSelect }: { etf: Etf; data: Research; onSelect: (t: string) => void }) {
  const holdings = data.etf_holdings.filter((h) => h.etf === etf.ticker);
  const max = Math.max(...holdings.map((h) => h.weight), 1);
  const price = etf.close ?? etf.price;
  const pos = (price - etf.wk52_lo) / (etf.wk52_hi - etf.wk52_lo);
  const notes = data.commentary[etf.ticker] ?? [];
  return (
    <div className="panel etf-card">
      <div className="panel-head">
        <div>
          <h3>
            {etf.ticker} <small className="muted">{etf.name_zh}</small>
          </h3>
          <span className="muted small">
            {etf.issuer} · 追蹤 {etf.index}
          </span>
        </div>
        <strong className="quote">{num(price)}</strong>
      </div>
      <div className="range-bar" aria-label={`${etf.ticker} 52 週區間`}>
        <span className="range-fill" style={{ width: `${Math.max(0, Math.min(1, pos)) * 100}%` }} />
        <span className="range-labels">
          <small>52 週低 {etf.wk52_lo}</small>
          <small>距高點 {((price / etf.wk52_hi - 1) * 100).toFixed(1)}%</small>
          <small>高 {etf.wk52_hi}</small>
        </span>
      </div>
      <div className="etf-stats">
        <span>費用率<strong>{etf.expense}%</strong></span>
        <span>規模<strong>${etf.aum_b}B</strong></span>
        <span>本益比<strong>{etf.pe ?? "N/A"}</strong></span>
        <span>殖利率<strong>{etf.div_yield ?? "N/A"}%</strong></span>
        <span>一年總報酬<strong>{etf.ret_1y}%</strong></span>
        <span>持股數<strong>{etf.n_holdings}</strong></span>
      </div>
      <h4>前 {holdings.length} 大持股</h4>
      <ul className="etf-holdings">
        {holdings.map((h) => (
          <li key={h.rank} className={h.in_scope ? "in-scope" : ""}>
            {h.in_scope && h.lt_ticker ? (
              <button className="link-button" onClick={() => onSelect(h.lt_ticker!)}>
                {h.name}
              </button>
            ) : (
              <span>{h.name}</span>
            )}
            <span className="bar">
              <span style={{ width: `${(h.weight / max) * 100}%` }} />
            </span>
            <span>{h.weight.toFixed(2)}%</span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        本站收錄個股合計占 {etf.overlap_total ?? "N/A"}%；持股日期 {etf.holdings_asof}；價格 {etf.price_note}。
      </p>
      {notes.length > 0 && (
        <details>
          <summary>觀察（{notes.length}）</summary>
          <ul>
            {notes.map((n, i) => (
              <li key={i}>{n.text}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Notes({ title, items }: { title: string; items: { kind: string; text: string }[] }) {
  return (
    <div className="panel insight-card">
      <h3>{title}</h3>
      <ul>
        {items
          .filter((c) => c.kind !== "caveat")
          .map((c, i) => (
            <li key={i}>{c.text}</li>
          ))}
      </ul>
      {items.some((c) => c.kind === "caveat") && (
        <div className="caveat-box">
          <strong>限制</strong>
          <ul>
            {items
              .filter((c) => c.kind === "caveat")
              .map((c, i) => (
                <li key={i}>{c.text}</li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
