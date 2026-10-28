import { useEffect, useMemo, useState } from "react";
import { Download, Lock, Plus, Trash2, Upload } from "lucide-react";
import { useResearch } from "../lib/research";
import type { Research } from "../lib/research";

export type Holding = { ticker: string; shares: number; cost: number; price?: number | null };
export type PortfolioState = { holdings: Holding[]; cash: number };
const KEY = "openstock-portfolio";
const EMPTY: PortfolioState = { holdings: [], cash: 0 };

function readStored(): PortfolioState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return parsePortfolio(raw);
  } catch {
    return EMPTY;
  }
}

/** 檢查使用者匯入的持股：只接受代號、股數、總成本與選填價格，其餘欄位一律捨棄。 */
export function parsePortfolio(raw: unknown): PortfolioState {
  const d = raw as PortfolioState;
  if (!d || !Array.isArray(d.holdings)) return EMPTY;
  const holdings = d.holdings
    .map((h) => ({
      ticker: String(h.ticker ?? "").toUpperCase().trim(),
      shares: Number(h.shares),
      cost: Number(h.cost),
      price: h.price === null || h.price === undefined || h.price === ("" as unknown) ? null : Number(h.price),
    }))
    .filter((h) => /^[A-Z0-9.-]{1,10}$/.test(h.ticker) && Number.isFinite(h.shares) && h.shares >= 0 && Number.isFinite(h.cost));
  return { holdings, cash: Number.isFinite(Number(d.cash)) ? Number(d.cash) : 0 };
}

/** 一行一檔：代號,股數,總成本[,價格]。 */
export function parseCsvHoldings(text: string): Holding[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^ticker|^代號/i.test(l))
    .map((l) => {
      const [ticker, shares, cost, price] = l.split(/[,\t]/).map((x) => x.trim());
      return { ticker: ticker.toUpperCase(), shares: Number(shares), cost: Number(cost), price: price ? Number(price) : null };
    })
    .filter((h) => h.ticker && Number.isFinite(h.shares) && Number.isFinite(h.cost));
}

/** 現價：使用者自填優先，其次為研究資料的收盤價（個股或 ETF）；都沒有則 null，不估計。 */
export function priceOf(h: Holding, data: Research | null): number | null {
  if (h.price !== null && h.price !== undefined && Number.isFinite(h.price) && h.price > 0) return h.price;
  if (!data) return null;
  const c = data.companies[h.ticker];
  if (c?.close) return c.close;
  const e = data.etf.find((x) => x.ticker === h.ticker);
  return e ? (e.close ?? e.price) : null;
}

export function analyze(state: PortfolioState, data: Research | null) {
  const rows = state.holdings.map((h) => {
    const price = priceOf(h, data);
    const value = price === null ? null : price * h.shares;
    return { ...h, price, value, pnl: value === null || !h.cost ? null : value / h.cost - 1 };
  });
  const stock = rows.reduce((a, r) => a + (r.value ?? 0), 0);
  const total = stock + state.cash;
  // 穿透曝險：直接持股 + ETF 市值 × 該 ETF 內本站收錄個股的權重。
  const exposure = new Map<string, { direct: number; viaEtf: number }>();
  for (const r of rows) {
    if (r.value === null) continue;
    const etfRows = data?.etf_holdings.filter((x) => x.etf === r.ticker) ?? [];
    if (etfRows.length) {
      for (const x of etfRows) {
        if (!x.in_scope || !x.lt_ticker) continue;
        const e = exposure.get(x.lt_ticker) ?? { direct: 0, viaEtf: 0 };
        e.viaEtf += (r.value * x.weight) / 100;
        exposure.set(x.lt_ticker, e);
      }
    } else {
      const key = r.ticker === "GOOG" ? "GOOGL" : r.ticker;
      const e = exposure.get(key) ?? { direct: 0, viaEtf: 0 };
      e.direct += r.value;
      exposure.set(key, e);
    }
  }
  return { rows, stock, total, exposure: [...exposure].map(([ticker, v]) => ({ ticker, ...v, sum: v.direct + v.viaEtf })).sort((a, b) => b.sum - a.sum) };
}

const money = (v: number | null) =>
  v === null || !Number.isFinite(v) ? "N/A" : `$${v.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}`;
const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? "N/A" : `${(v * 100).toFixed(1)}%`);

export function Portfolio({ base, onSelect }: { base: string; onSelect: (t: string) => void }) {
  const { data } = useResearch(base);
  const [state, setState] = useState<PortfolioState>(readStored);
  const [csv, setCsv] = useState("");
  const [drops, setDrops] = useState([20, 30, 50]);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* 私密視窗等情況無法保存；仍可在本次瀏覽使用 */
    }
  }, [state]);
  const result = useMemo(() => analyze(state, data), [state, data]);
  const set = (i: number, patch: Partial<Holding>) =>
    setState((s) => ({ ...s, holdings: s.holdings.map((h, j) => (j === i ? { ...h, ...patch } : h)) }));
  const unpriced = result.rows.filter((r) => r.price === null);

  return (
    <section id="portfolio" className="portfolio">
      <div className="section-title">
        <div>
          <span className="eyebrow">MY PORTFOLIO</span>
          <h2>我的持股</h2>
        </div>
      </div>
      <div className="notice">
        <Lock size={18} />
        <div>
          <strong>只存在你的瀏覽器</strong>
          <p>
            持股、成本與現金只保存在這台裝置的瀏覽器（localStorage），不會上傳、不會出現在公開網站。換裝置請用「匯出 JSON」帶過去。現價取自研究資料的收盤價
            {data ? `（${data.companies.GOOGL?.close_asof ?? data.as_of}）` : ""}，不會自動更新；沒有收盤價的代號請自行填入價格。
          </p>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>持股</h3>
          <div className="tools">
            <button
              className="button secondary"
              onClick={() => setState((s) => ({ ...s, holdings: [...s.holdings, { ticker: "", shares: 0, cost: 0, price: null }] }))}
            >
              <Plus size={14} /> 新增一列
            </button>
            <button
              className="button secondary"
              onClick={() => {
                const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
                const a = document.createElement("a");
                a.href = url;
                a.download = "my-portfolio.json";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download size={14} /> 匯出 JSON
            </button>
            <label className="button secondary">
              <Upload size={14} /> 匯入 JSON
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setState(parsePortfolio(JSON.parse(await f.text())));
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table editable">
            <thead>
              <tr>
                <th>代號</th>
                <th>股數</th>
                <th>總成本（美元）</th>
                <th>現價</th>
                <th>市值</th>
                <th>占股票</th>
                <th>占總帳戶</th>
                <th>未實現報酬</th>
                <th aria-label="刪除" />
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input aria-label={`第 ${i + 1} 列代號`} value={r.ticker} onChange={(e) => set(i, { ticker: e.target.value.toUpperCase() })} />
                  </td>
                  <td>
                    <input aria-label={`${r.ticker || `第 ${i + 1} 列`} 股數`} type="number" value={r.shares} onChange={(e) => set(i, { shares: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input aria-label={`${r.ticker || `第 ${i + 1} 列`} 總成本`} type="number" value={r.cost} onChange={(e) => set(i, { cost: Number(e.target.value) })} />
                  </td>
                  <td>
                    <input
                      aria-label={`${r.ticker || `第 ${i + 1} 列`} 自訂價格`}
                      type="number"
                      placeholder={r.price !== null ? String(r.price) : "請填價格"}
                      value={state.holdings[i].price ?? ""}
                      onChange={(e) => set(i, { price: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </td>
                  <td>{money(r.value)}</td>
                  <td>{r.value !== null && result.stock ? pct(r.value / result.stock) : "N/A"}</td>
                  <td>{r.value !== null && result.total ? pct(r.value / result.total) : "N/A"}</td>
                  <td className={r.pnl === null ? "" : r.pnl >= 0 ? "positive" : "negative"}>{pct(r.pnl)}</td>
                  <td>
                    <button aria-label={`刪除 ${r.ticker || `第 ${i + 1} 列`}`} onClick={() => setState((s) => ({ ...s, holdings: s.holdings.filter((_, j) => j !== i) }))}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <th>現金</th>
                <td colSpan={3}>
                  <input aria-label="現金" type="number" value={state.cash} onChange={(e) => setState((s) => ({ ...s, cash: Number(e.target.value) || 0 }))} />
                </td>
                <td>{money(state.cash)}</td>
                <td />
                <td>{result.total ? pct(state.cash / result.total) : "N/A"}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
        {unpriced.length > 0 && <p className="negative small">沒有現價、未計入市值：{unpriced.map((r) => r.ticker || "（空白）").join("、")}。請在「現價」欄填入。</p>}
        <details>
          <summary>貼上 CSV 一次匯入（代號,股數,總成本[,價格]）</summary>
          <textarea aria-label="持股 CSV" rows={5} value={csv} placeholder={"NVDA,100,15000\nSMH,20,9000\nAAPL,10,2000,230"} onChange={(e) => setCsv(e.target.value)} />
          <button
            className="button"
            onClick={() => {
              const rows = parseCsvHoldings(csv);
              if (rows.length) setState((s) => ({ ...s, holdings: rows }));
            }}
          >
            以 CSV 取代持股
          </button>
        </details>
      </div>
      {result.rows.length > 0 && (
        <>
          <div className="kpi-row">
            <div className="kpi panel">
              <span>總帳戶（股票 + 現金）</span>
              <strong>{money(result.total)}</strong>
            </div>
            <div className="kpi panel">
              <span>股票市值</span>
              <strong>{money(result.stock)}</strong>
            </div>
            <div className="kpi panel">
              <span>總成本</span>
              <strong>{money(result.rows.reduce((a, r) => a + (r.cost || 0), 0))}</strong>
            </div>
            <div className="kpi panel">
              <span>現金占比</span>
              <strong>{result.total ? pct(state.cash / result.total) : "N/A"}</strong>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3>穿透後的個股曝險</h3>
              <span className="muted small">直接持股，加上 SMH、EWT 內含的部分（ETF 市值 × 前十／十五大持股權重）</span>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>代號</th>
                    <th>直接持有</th>
                    <th>透過 ETF</th>
                    <th>穿透曝險</th>
                    <th>占總帳戶</th>
                  </tr>
                </thead>
                <tbody>
                  {result.exposure.map((e) => (
                    <tr key={e.ticker}>
                      <th>
                        <button className="link-button" onClick={() => onSelect(e.ticker)}>
                          {e.ticker}
                        </button>
                      </th>
                      <td>{money(e.direct)}</td>
                      <td>{money(e.viaEtf)}</td>
                      <td>
                        <strong>{money(e.sum)}</strong>
                      </td>
                      <td>{result.total ? pct(e.sum / result.total) : "N/A"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">ETF 只計入公布的前十／十五大持股，其餘成分不拆。同一家公司不管直接買或透過 ETF 買，下跌時都會一起跌。</p>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3>壓力測試：全面下跌</h3>
              <span className="muted small">跌幅套用在目前股票市值，現金不跌；可自訂三個跌幅</span>
            </div>
            <div className="stress-grid">
              {drops.map((d, i) => {
                const loss = (result.stock * d) / 100;
                return (
                  <div key={i} className="stress-card">
                    <label>
                      下跌
                      <input
                        aria-label={`壓力情境 ${i + 1} 跌幅`}
                        type="number"
                        value={d}
                        onChange={(e) => setDrops((p) => p.map((x, j) => (j === i ? Math.min(100, Math.max(0, Number(e.target.value) || 0)) : x)))}
                      />
                      %
                    </label>
                    <strong className="negative">−{money(loss)}</strong>
                    <span className="muted small">
                      總帳戶 {result.total ? pct(-loss / result.total) : "N/A"} → 剩 {money(result.total - loss)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="muted small">這是均一跌幅的粗估，各檔實際不會同時跌到底；本頁不使用依記憶整理的歷史跌幅。</p>
          </div>
        </>
      )}
      {data && data.checklist.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h3>賣出或大幅減碼前的五個問題</h3>
            <span className="muted small">一套思考順序，不是預測</span>
          </div>
          <ol className="checklist">
            {[...data.checklist]
              .sort((a, b) => a.n - b.n)
              .map((q) => (
                <li key={q.id}>
                  <strong>{q.q}</strong>
                  <p className="muted">{q.hint}</p>
                  <small>{q.where}</small>
                </li>
              ))}
          </ol>
        </div>
      )}
    </section>
  );
}
