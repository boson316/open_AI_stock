import { useEffect, useState } from "react";
import { requiredGrowth, scenarioReturn, useResearch, wacc } from "../lib/research";
import type { Research, Scenario } from "../lib/research";

const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? "N/A" : `${(v * 100).toFixed(digits)}%`;
const num = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "N/A" : v.toLocaleString("zh-TW", { maximumFractionDigits: digits });

export function ValuationTools({ base, ticker }: { base: string; ticker: string }) {
  const { data, error } = useResearch(base);
  if (error) return <div className="notice error" role="alert">研究資料讀取失敗：{error}</div>;
  if (!data) return null;
  const c = data.companies[ticker];
  if (!c) return null;
  return (
    <div className="valuation-tools">
      <Drawdown data={data} ticker={ticker} />
      <RoicWacc data={data} ticker={ticker} />
      <Scenarios data={data} ticker={ticker} />
    </div>
  );
}

function Drawdown({ data, ticker }: { data: Research; ticker: string }) {
  const c = data.companies[ticker];
  if (c.hi52 === null || c.close === null) return null;
  const epsTtm = c.pe ? c.price / c.pe : null;
  const position = c.lo52 !== null ? (c.close - c.lo52) / (c.hi52 - c.lo52) : null;
  return (
    <section className="panel tool-panel" aria-label="跌幅價位表">
      <div className="panel-head">
        <div>
          <h3>跌幅價位表</h3>
          <span className="muted small">從近 52 週高點回落 20%／30%／50% 的價位與對應本益比（{c.close_asof}）</span>
        </div>
      </div>
      <div className="range-bar" aria-label={`52 週區間 ${c.lo52} 到 ${c.hi52}，目前 ${c.close}`}>
        <span className="range-fill" style={{ width: `${Math.max(0, Math.min(1, position ?? 0)) * 100}%` }} />
        <span className="range-labels">
          <small>低 {num(c.lo52)}</small>
          <strong>現價 {num(c.close)}（區間 {pct(position, 0)}）</strong>
          <small>高 {num(c.hi52)}</small>
        </span>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>情境</th>
              <th>價位</th>
              <th>對應本益比</th>
              <th>狀態</th>
            </tr>
          </thead>
          <tbody>
            {[0.2, 0.3, 0.5].map((d) => {
              const level = c.hi52! * (1 - d);
              return (
                <tr key={d}>
                  <th>距高點 −{d * 100}%</th>
                  <td>{num(level)}</td>
                  <td>{epsTtm && epsTtm > 0 ? `${(level / epsTtm).toFixed(1)}×` : "N/A"}</td>
                  <td className={c.close! <= level ? "negative" : "muted"}>{c.close! <= level ? "已跌破" : "尚未到"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        目前距 52 週高點 {pct(c.close / c.hi52 - 1)}。對應本益比用資料商本益比反推的 TTM EPS（{epsTtm ? num(epsTtm) : "N/A"}）估算；TTM EPS
        被業外收益墊高時（如 Google、Amazon）本益比會偏低失真。{c.basis ? `${c.basis}。` : ""}
      </p>
    </section>
  );
}

function RoicWacc({ data, ticker }: { data: Research; ticker: string }) {
  const r = data.roic[ticker];
  if (!r) return null;
  const w = wacc({ rf: data.rf_us10y, beta: r.beta, erp: r.erp, kdSpread: r.kd_spread, tax: r.tax, debtWeight: r.debt_weight });
  const spread = r.roic_latest - w.wacc;
  const spread4 = r.roic_avg4 - w.wacc;
  const verdict = Math.abs(spread) < 1 ? "接近資金成本" : spread > 0 ? "高於資金成本：有創造價值的空間" : "低於資金成本：目前的報酬還不夠覆蓋要求";
  return (
    <section className="panel tool-panel" aria-label="ROIC 與 WACC">
      <div className="panel-head">
        <div>
          <h3>ROIC 與 WACC：每投入 100 元資本</h3>
          <span className="muted small">ROIC 高於 WACC 才算真的在創造價值；WACC 為本站以 CAPM 估算，不是公司公布數字</span>
        </div>
      </div>
      <div className="kpi-row">
        <div className="kpi">
          <span>ROIC（{r.roic_quarter}，單季年化）</span>
          <strong>{r.roic_latest.toFixed(1)}%</strong>
        </div>
        <div className="kpi">
          <span>WACC（估算）</span>
          <strong>{w.wacc.toFixed(1)}%</strong>
        </div>
        <div className="kpi">
          <span>ROIC − WACC</span>
          <strong className={spread >= 0 ? "positive" : "negative"}>
            {spread >= 0 ? "+" : ""}
            {spread.toFixed(1)} 個百分點
          </strong>
        </div>
        <div className="kpi">
          <span>近四季平均 ROIC − WACC</span>
          <strong className={spread4 >= 0 ? "positive" : "negative"}>
            {spread4 >= 0 ? "+" : ""}
            {spread4.toFixed(1)} 個百分點
          </strong>
        </div>
      </div>
      <p className={`verdict ${spread >= 1 ? "positive" : spread <= -1 ? "negative" : ""}`}>{verdict}</p>
      <details>
        <summary>計算明細</summary>
        <ul className="calc-list">
          <li>股東要求報酬 = 無風險利率 {data.rf_us10y}% + Beta {r.beta} × 風險溢酬 {r.erp}% = {w.ke.toFixed(2)}%</li>
          <li>稅後借款成本 =（{data.rf_us10y}% + 利差 {r.kd_spread}%）×（1 − 稅率 {r.tax}%）= {w.kd.toFixed(2)}%</li>
          <li>債務占資本 {(r.debt_weight * 100).toFixed(1)}%（最新季總債務 ÷（市值 + 總債務））{r.debt_weight_note ? `；${r.debt_weight_note}` : ""}</li>
          <li>Beta 來源：{r.beta_src}（{r.beta_asof}）；風險溢酬與借款利差為假設，無風險利率為美國 10 年期公債殖利率。</li>
          <li>ROIC 為資料商頁面值，資本口徑未逐項查證。</li>
        </ul>
      </details>
      <p className="muted small">{r.note}</p>
    </section>
  );
}

function Scenarios({ data, ticker }: { data: Research; ticker: string }) {
  const c = data.companies[ticker];
  const initial = data.scenarios[ticker] ?? [];
  const [rows, setRows] = useState<Scenario[]>(initial);
  useEffect(() => setRows(data.scenarios[ticker] ?? []), [data, ticker]);
  if (!rows.length || !c.pe) return null;
  const ttmEps = c.price / c.pe;
  const fwdEps = c.fwd_pe ? c.price / c.fwd_pe : null;
  // 基期 EPS 取 TTM 與預估兩者較低者，避免一次性收益墊高。
  const baseEps = fwdEps !== null && fwdEps > 0 && ttmEps > 0 ? Math.min(ttmEps, fwdEps) : ttmEps;
  const mid = rows.find((r) => r.scenario === "mid") ?? rows[0];
  const hurdle = mid.hurdle + mid.prem;
  const need = requiredGrowth(c.price, baseEps, mid.exit_pe, mid.years, hurdle);
  const update = (i: number, key: "eps_cagr" | "exit_pe", v: string) => {
    const n = Number(v);
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [key]: Number.isFinite(n) ? n : r[key] } : r)));
  };
  return (
    <section className="panel tool-panel" aria-label="三情境估值">
      <div className="panel-head">
        <div>
          <h3>三情境估值</h3>
          <span className="muted small">
            基期 EPS {baseEps > 0 ? baseEps.toFixed(2) : "N/A"}（TTM {ttmEps.toFixed(2)}、預估 {fwdEps ? fwdEps.toFixed(2) : "N/A"}，取較低者）×（1 + EPS 年增率）^{mid.years} × 退出本益比
          </span>
        </div>
        <button className="button secondary" onClick={() => setRows(initial)}>
          還原預設假設
        </button>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>情境</th>
              <th>EPS 年增率（%）</th>
              <th>退出本益比（×）</th>
              <th>{mid.years} 年後價格</th>
              <th>年化報酬</th>
              <th>vs 基準 {hurdle}%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const res = scenarioReturn(c.price, baseEps, r);
              const beat = res && res.annual * 100 >= hurdle;
              return (
                <tr key={r.scenario}>
                  <th>{r.label}</th>
                  <td>
                    <input aria-label={`${r.label} EPS 年增率`} type="number" value={r.eps_cagr} onChange={(e) => update(i, "eps_cagr", e.target.value)} />
                  </td>
                  <td>
                    <input aria-label={`${r.label} 退出本益比`} type="number" value={r.exit_pe} onChange={(e) => update(i, "exit_pe", e.target.value)} />
                  </td>
                  <td>{res ? num(res.target) : "N/A"}</td>
                  <td className={res ? (res.annual >= 0 ? "positive" : "negative") : ""}>{res ? pct(res.annual) : "N/A"}</td>
                  <td>{res ? (beat ? "▲ 高於" : "▼ 低於") : "N/A"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        達到基準（短天期美債約 {mid.hurdle}% + 股票風險溢酬 {mid.prem}%）所需 EPS 年增率：<strong>{pct(need)}</strong>
        （以中性退出本益比 {mid.exit_pe}× 計）；高於中性假設 {mid.eps_cagr}%，代表現價已把這份成長算進去。現價 {c.price}（{c.price_asof}）。
        預設假設由使用者提供的研究整理設定，不是預測：{mid.basis}。結果對假設非常敏感，可直接修改上表數字。
      </p>
    </section>
  );
}
