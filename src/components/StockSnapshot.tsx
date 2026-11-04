import { useResearch } from "../lib/research";

const num = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "N/A" : v.toLocaleString("zh-TW", { maximumFractionDigits: d });
const actionClass = (a: string) =>
  a === "加碼" || a === "新建" ? "positive" : a === "減碼" || a === "出清" ? "negative" : "muted";

/** 研究總覽頁：外部行情、估值位階、13F 持有者、風險分組與個股觀察；與官方財報分開標示。 */
export type OfficialQuote = {
  close: number;
  asof: string;
  prev: number | null;
  hi52: number;
  lo52: number;
  source: string;
  pe: number | null;
  pb: number | null;
  ps: number | null;
  pfcf: number | null;
  mcap: number | null;
  sharesEnd: string | null;
  sharesKind?: string | null;
  fcfNegative?: boolean;
  epsTtm?: number | null;
  epsEnd?: string | null;
  fx?: number | null;
  adr?: boolean;
};
const SHARE_LABEL: Record<string, string> = {
  shares: "資產負債表流通股數",
  shares_cover: "申報封面流通股數",
  diluted_shares: "加權平均稀釋股數",
};

export function StockSnapshot({
  base,
  ticker,
  onGurus,
  official = null,
}: {
  base: string;
  ticker: string;
  onGurus: () => void;
  official?: OfficialQuote | null;
}) {
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
  // GOOG 有自己的自動股價時用自己的行情卡；沒有時才借用同一發行人 GOOGL 的外部報價。
  const comp = c ?? (ticker === "GOOG" && !official ? data.companies.GOOGL : undefined);
  if (!comp && !official && !holders.length && !notes.length) return null;
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
          <p>
            {comp
              ? `外部資料（${data.as_of} 前後擷取，非 SEC 官方）；財報數字以本站官方資料為準`
              : "股價每週自動更新；倍數由本站 SEC 官方財報計算，13F 持股為外部資料"}
          </p>
        </div>
      </div>
      {!comp && official && <OfficialQuoteCard q={official} />}
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
              <strong>{multOr(comp.pe, official?.pe)}</strong>
            </div>
            <div>
              <span>預估本益比</span>
              <strong>{comp.fwd_pe ? `${comp.fwd_pe.toFixed(1)}×` : "—"}</strong>
            </div>
            <div>
              <span>股價淨值比</span>
              <strong>{multOr(comp.pb, official?.pb)}</strong>
            </div>
            <div>
              <span>股價營收比</span>
              <strong>{multOr(comp.ps, official?.ps)}</strong>
            </div>
            <div>
              <span>股價自由現金流比</span>
              <strong>{comp.pfcf ? `${comp.pfcf.toFixed(1)}×` : official?.fcfNegative ? <small>TTM 自由現金流為負</small> : multOr(null, official?.pfcf)}</strong>
            </div>
            <div>
              <span>市值</span>
              <strong>
                {comp.mcap_100m_usd
                  ? `${num(comp.mcap_100m_usd, 0)} 億美元`
                  : official?.mcap
                    ? `${num(official.mcap / 1e8, 0)} 億美元＊`
                    : "—"}
              </strong>
            </div>
            <p className="muted small span-all">
              本益比以 {comp.price}（{comp.price_asof}）計
              {comp.pe_median !== null
                ? `；近 ${comp.pe_n} 季本益比中位數 ${comp.pe_median}×（${comp.pe_min}–${comp.pe_max}），目前高於約 ${comp.pe_rank}% 的歷史季度。`
                : "。"}
              {official && <OfficialNote q={official} />}
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

const mult = (v: number | null) => (v !== null && Number.isFinite(v) && v > 0 ? `${v.toFixed(1)}×` : "N/A");

/** 沒有外部研究資料時：收盤價、52 週區間與倍數全部由本站官方財報 × 自動股價計算。 */
function OfficialQuoteCard({ q }: { q: OfficialQuote }) {
  const pos = q.hi52 > q.lo52 ? (q.close - q.lo52) / (q.hi52 - q.lo52) : null;
  const day = q.prev ? (q.close / q.prev - 1) * 100 : null;
  return (
    <div className="research-grid" data-testid="official-quote">
      <div className="panel quote-panel">
        <span className="muted small">
          收盤價 · {q.asof}（{q.source}）
        </span>
        <strong className="quote">{num(q.close)}</strong>
        {day !== null && (
          <span className={`small ${day >= 0 ? "positive" : "negative"}`}>
            前一交易日 {day >= 0 ? "+" : ""}
            {day.toFixed(2)}%
          </span>
        )}
        <div className="range-bar" aria-label="52 週區間">
          <span className="range-fill" style={{ width: `${Math.max(0, Math.min(1, pos ?? 0)) * 100}%` }} />
          <span className="range-labels">
            <small>52 週低 {num(q.lo52)}</small>
            <small>距高點 {`${((q.close / q.hi52 - 1) * 100).toFixed(1)}%`}</small>
            <small>高 {num(q.hi52)}</small>
          </span>
        </div>
        <p className="muted small">每週自動更新的免費日線（已按分割調整），非即時報價。</p>
      </div>
      <div className="panel valuation-mini">
        <div>
          <span>本益比（TTM）</span>
          <strong>{mult(q.pe)}</strong>
        </div>
        <div>
          <span>股價淨值比</span>
          <strong>{mult(q.pb)}</strong>
        </div>
        <div>
          <span>股價營收比</span>
          <strong>{mult(q.ps)}</strong>
        </div>
        <div>
          <span>股價自由現金流比</span>
          <strong>{q.fcfNegative ? <small>TTM 自由現金流為負</small> : mult(q.pfcf)}</strong>
        </div>
        <div>
          <span>市值</span>
          <strong>{q.mcap ? `${num(q.mcap / 1e8, 0)} 億美元` : "—"}</strong>
        </div>
        <div>
          <span>距 52 週低點</span>
          <strong>{q.lo52 > 0 ? `+${((q.close / q.lo52 - 1) * 100).toFixed(1)}%` : "N/A"}</strong>
        </div>
        <p className="muted small" style={{ gridColumn: "1 / -1" }}>
          倍數＝收盤價 ÷ 本站 SEC 官方 TTM 數字（EPS 截至 {q.epsEnd ?? "—"}；營收；自由現金流 = OCF − |CapEx|），只用股價日以前已公布的季度；市值＝收盤價 ×{" "}
          {q.sharesKind ? SHARE_LABEL[q.sharesKind] : "最新申報流通股數"}
          {q.sharesEnd ? `（${q.sharesEnd}）` : ""}。非外部研究資料，沒有預估本益比。
        </p>
      </div>
    </div>
  );
}

/** 外部值缺漏時改用本站計算值（標＊）；兩者都沒有才顯示「—」。 */
function multOr(external: number | null | undefined, ours: number | null | undefined) {
  if (external) return `${external.toFixed(1)}×`;
  if (ours !== null && ours !== undefined && Number.isFinite(ours) && ours > 0) return `${ours.toFixed(1)}×＊`;
  return "—";
}

function OfficialNote({ q }: { q: OfficialQuote }) {
  return (
    <>
      {" "}
      ＊為本站計算：{q.asof} 收盤 {num(q.close)} ÷ SEC 官方 TTM 數字
      {q.adr && q.fx ? `（1 ADR = 5 股普通股，USD/TWD ${q.fx}）` : ""}；市值 = 收盤價 ×{" "}
      {q.sharesKind ? SHARE_LABEL[q.sharesKind] : "流通股數"}
      {q.sharesEnd ? `（${q.sharesEnd}）` : ""}
      {q.adr ? " ÷ 5" : ""}。
    </>
  );
}
