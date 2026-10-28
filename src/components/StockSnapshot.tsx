import { useResearch } from "../lib/research";

const num = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "N/A" : v.toLocaleString("zh-TW", { maximumFractionDigits: d });
const actionClass = (a: string) =>
  a === "加碼" || a === "新建" ? "positive" : a === "減碼" || a === "出清" ? "negative" : "muted";

/** 研究總覽頁：外部行情、估值位階、13F 持有者、風險分組與個股觀察；與官方財報分開標示。 */
export function StockSnapshot({ base, ticker, onGurus }: { base: string; ticker: string; onGurus: () => void }) {
  const { data } = useResearch(base);
  if (!data) return null;
  const c = data.companies[ticker];
  const holders = data.guru_holdings
    .filter((h) => h.ticker === ticker || (ticker === "GOOGL" && h.ticker === "GOOG") || (ticker === "GOOG" && h.ticker === "GOOGL"))
    .map((h) => ({ ...h, guru: data.gurus.find((g) => g.id === h.manager)! }))
    .sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1));
  const key = ticker === "GOOG" ? "GOOGL" : ticker;
  const notes = data.commentary[key] ?? [];
  const risk = data.risk[key];
  const comp = c ?? (ticker === "GOOG" ? data.companies.GOOGL : undefined);
  if (!comp && !holders.length && !notes.length) return null;
  const pos =
    comp && comp.close !== null && comp.hi52 !== null && comp.lo52 !== null
      ? (comp.close - comp.lo52) / (comp.hi52 - comp.lo52)
      : null;
  const intro = notes.find((n) => n.kind === "intro");
  const takeaway = notes.find((n) => n.kind === "takeaway");
  const obs = notes.filter((n) => n.kind === "obs");
  const caveats = notes.filter((n) => n.kind === "caveat");
  return (
    <section className="snapshot-research" aria-label="市場行情與研究觀察">
      <div className="section-heading">
        <div>
          <h2>市場行情與研究觀察</h2>
          <p>外部資料（{data.as_of} 前後擷取，非 SEC 官方）；財報數字以本站官方資料為準</p>
        </div>
      </div>
      {comp && (
        <div className="research-grid">
          <div className="panel quote-panel">
            <span className="muted small">
              {ticker === "GOOG" ? "GOOGL 報價（同一發行人）" : "收盤價"} · {comp.close_asof}
            </span>
            <strong className="quote">{num(comp.close)}</strong>
            {comp.hi52 !== null && comp.lo52 !== null && (
              <div className="range-bar" aria-label="52 週區間">
                <span className="range-fill" style={{ width: `${Math.max(0, Math.min(1, pos ?? 0)) * 100}%` }} />
                <span className="range-labels">
                  <small>52 週低 {num(comp.lo52)}</small>
                  <small>距高點 {comp.close ? `${((comp.close / comp.hi52 - 1) * 100).toFixed(1)}%` : "N/A"}</small>
                  <small>高 {num(comp.hi52)}</small>
                </span>
              </div>
            )}
            {comp.basis && <p className="muted small">{comp.basis}</p>}
          </div>
          <div className="panel valuation-mini">
            <div>
              <span>本益比（TTM）</span>
              <strong>{comp.pe ? `${comp.pe.toFixed(1)}×` : "N/A"}</strong>
            </div>
            <div>
              <span>預估本益比</span>
              <strong>{comp.fwd_pe ? `${comp.fwd_pe.toFixed(1)}×` : "N/A"}</strong>
            </div>
            <div>
              <span>股價淨值比</span>
              <strong>{comp.pb ? `${comp.pb.toFixed(1)}×` : "N/A"}</strong>
            </div>
            <div>
              <span>股價營收比</span>
              <strong>{comp.ps ? `${comp.ps.toFixed(1)}×` : "N/A"}</strong>
            </div>
            <div>
              <span>股價自由現金流比</span>
              <strong>{comp.pfcf ? `${comp.pfcf.toFixed(1)}×` : "N/A"}</strong>
            </div>
            <div>
              <span>市值</span>
              <strong>{comp.mcap_100m_usd ? `${num(comp.mcap_100m_usd, 0)} 億美元` : "N/A"}</strong>
            </div>
            <p className="muted small span-all">
              本益比以 {comp.price}（{comp.price_asof}）計；近 {comp.pe_n} 季本益比中位數 {comp.pe_median ?? "N/A"}×（{comp.pe_min ?? "N/A"}–{comp.pe_max ?? "N/A"}），目前高於約 {comp.pe_rank ?? "N/A"}% 的歷史季度。
            </p>
          </div>
        </div>
      )}
      {(takeaway || intro) && (
        <div className="panel insight-card">
          {takeaway && <p className="takeaway">{takeaway.text}</p>}
          {intro && <p className="muted">{intro.text}</p>}
          {obs.length > 0 && (
            <details>
              <summary>重點觀察（{obs.length}）</summary>
              <ul>
                {obs.map((o, i) => (
                  <li key={i}>{o.text}</li>
                ))}
              </ul>
            </details>
          )}
          {caveats.length > 0 && (
            <div className="caveat-box">
              <strong>這檔要注意</strong>
              <ul>
                {caveats.map((o, i) => (
                  <li key={i}>{o.text}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="muted small">觀察文字為外部資料整理，所引數字可能與本站官方 SEC 數字不同；不一致處見「資料來源」頁的核對報告。</p>
        </div>
      )}
      <div className="research-grid">
        {risk && (
          <div className="panel risk-card">
            <span className="muted small">風險分組（研究判斷，非評分）</span>
            <strong className={`risk-group ${risk.group.includes("重傷") ? "negative" : risk.group.includes("抗跌") ? "positive" : ""}`}>{risk.group}</strong>
            <dl>
              <dt>升息傷害</dt>
              <dd>{risk.rate_risk}</dd>
              <dt>AI 泡沫曝險</dt>
              <dd>{risk.ai_exposure}</dd>
              <dt>財務緩衝</dt>
              <dd>{risk.buffer}</dd>
            </dl>
          </div>
        )}
        <div className="panel holders-card">
          <div className="panel-head">
            <span className="muted small">13F 大師持有（{data.gurus[0]?.quarter ?? ""}）</span>
            <button className="link-button" onClick={onGurus}>
              看全部大師 →
            </button>
          </div>
          {holders.length ? (
            <ul className="holder-list">
              {holders.map((h) => (
                <li key={h.manager + h.ticker}>
                  <span className="guru-avatar small">{h.guru.name.slice(0, 1)}</span>
                  <span className="holder-name">
                    {h.guru.name}
                    <small>{h.guru.fund}</small>
                  </span>
                  <span className="holder-weight">{h.weight !== null ? `${h.weight.toFixed(2)}%` : h.option ? h.option : "—"}</span>
                  <span className={`action ${actionClass(h.action)}`}>
                    {h.action}
                    {h.chg !== null && h.action !== "不變" && h.action !== "出清" ? ` ${h.chg > 0 ? "+" : ""}${h.chg}%` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">收錄的 14 位投資人在可見的 13F 持股中沒有這檔（未登入時部分來源只顯示前五大，「沒看到」不等於「沒持有」）。</p>
          )}
        </div>
      </div>
    </section>
  );
}
