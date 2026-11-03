import { useEffect, useMemo, useState } from "react";
import type { Fact } from "../lib/finance";
import {
  dcf,
  epsCagr,
  fcfYieldHistory,
  impliedGrowth,
  lynch,
  lynchVerdict,
  median,
  ttmAt,
  type FcfYieldPoint,
} from "../lib/intrinsic";
import { useResearch, wacc, type Research } from "../lib/research";
import { validateExternal, type ExternalValuation } from "./ExternalValuation";
import { FinancialChart } from "./FinancialChart";

const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "N/A"
    : `${(v * 100).toFixed(digits)}%`;
const num = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "N/A"
    : v.toLocaleString("zh-TW", { maximumFractionDigits: digits });
const round1 = (v: number) => Math.round(v * 10) / 10;

type Props = {
  base: string;
  ticker: string;
  dark: boolean;
  /** 正規化後的單季財報（App 的 quarters） */
  quarters: Fact[];
  /** 原始財報事實，用於年度 EPS 成長率 */
  raw: Fact[];
  isFinancial: boolean;
};

/** 自由現金流報酬率、現金流折現評價、彼得林區評價。 */
export function IntrinsicValue({ base, ticker, dark, quarters, raw, isFinancial }: Props) {
  const { data: research } = useResearch(base);
  const [external, setExternal] = useState<ExternalValuation | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${base}data/external-valuation.json`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => setExternal(validateExternal(j)))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [base]);

  const rows = external?.companies[ticker];
  const history = useMemo(
    () => (rows ? fcfYieldHistory(quarters, rows) : []),
    [rows, quarters],
  );

  if (error)
    return <div className="notice error" role="alert">估值資料讀取失敗：{error}</div>;
  if (!external) return null;
  const rc = research?.companies[ticker];
  if (!rows && !rc)
    return (
      <div className="notice">
        <div>
          <strong>{ticker} 沒有股價資料，無法計算自由現金流報酬率與內在價值</strong>
          <p>這三項評價需要股價；目前外部資料涵蓋 {Object.keys(external.companies).join("、")}。</p>
        </div>
      </div>
    );

  const lastRow = rows?.at(-1);
  const price = rc ? (rc.close ?? rc.price) : lastRow!.price;
  const priceAsOf = rc ? (rc.close !== null ? rc.close_asof : rc.price_asof) : lastRow!.date;
  const epsTtm = rc?.pe ? rc.price / rc.pe : (lastRow?.eps_ttm ?? null);
  const pe = epsTtm && epsTtm > 0 ? price / epsTtm : null;
  const unit = external.basis?.[ticker] ? "美元／ADR" : "美元／股";

  // 基期每股 FCF：本站 SEC 財報換算為主；沒有時退回資料商 P/FCF。
  const withFcf = history.filter((h) => h.fcfPerShare !== null);
  const latestFcf = withFcf.at(-1);
  const vendorFcf = rc?.pfcf ? rc.price / rc.pfcf : null;
  const fcfTtm = latestFcf?.fcfPerShare ?? vendorFcf;
  const last12 = withFcf.slice(-12);
  const fcfAvg3 =
    last12.length >= 8
      ? last12.reduce((a, h) => a + h.fcfPerShare!, 0) / last12.length
      : null;

  // 殖利率：資料商季度配息（億，財報幣別）÷ SEC TTM 淨利 = 配息率，再 × 盈餘殖利率。
  const rq = research?.quarterly[ticker] ?? [];
  const divTtm = rq.length === 4 && rq.every((q) => q.div !== null)
    ? rq.reduce((a, q) => a + Math.abs(q.div!), 0) * 1e8
    : null;
  const niAtDiv = rq.at(-1) ? ttmAt(quarters, "net_income", rq.at(-1)!.end) : null;
  const payout = divTtm !== null && niAtDiv && niAtDiv > 0 ? divTtm / niAtDiv : null;
  const dividendYield = payout !== null && pe ? payout / pe : null;

  return (
    <div className="valuation-tools intrinsic">
      {isFinancial && (
        <div className="notice">
          <div>
            <strong>金融機構的自由現金流解釋有限</strong>
            <p>放款、存款變動計入營業現金流，以下 FCF 相關評價僅供參考。</p>
          </div>
        </div>
      )}
      <FcfYield
        history={history}
        dark={dark}
        currentYield={fcfTtm !== null ? fcfTtm / price : null}
        vendorYield={rc?.pfcf ? 1 / rc.pfcf : null}
        rf={research?.rf_us10y ?? null}
        priceAsOf={priceAsOf}
      />
      <Dcf
        key={`dcf-${ticker}-${research ? 1 : 0}`}
        research={research}
        ticker={ticker}
        price={price}
        priceAsOf={priceAsOf}
        unit={unit}
        fcfTtm={fcfTtm}
        fcfAvg3={fcfAvg3}
        fromVendor={!latestFcf && vendorFcf !== null}
        fcfDate={latestFcf?.date ?? null}
      />
      <Lynch
        key={`lynch-${ticker}-${research ? 1 : 0}`}
        price={price}
        priceAsOf={priceAsOf}
        unit={unit}
        eps={epsTtm}
        pe={pe}
        cagr5={epsCagr(raw, 5)}
        cagr3={epsCagr(raw, 3)}
        dividendYield={dividendYield}
        payout={payout}
      />
    </div>
  );
}

function FcfYield({
  history,
  dark,
  currentYield,
  vendorYield,
  rf,
  priceAsOf,
}: {
  history: FcfYieldPoint[];
  dark: boolean;
  currentYield: number | null;
  vendorYield: number | null;
  rf: number | null;
  priceAsOf: string;
}) {
  const valid = history.filter((h) => h.fcfYield !== null);
  const recent = valid.slice(-20).map((h) => h.fcfYield!);
  const med = median(recent);
  const latest = valid.at(-1);
  const rank =
    latest && recent.length
      ? recent.filter((v) => v <= latest.fcfYield!).length / recent.length
      : null;
  return (
    <section className="panel tool-panel" aria-label="自由現金流報酬率">
      <div className="panel-head">
        <div>
          <h3>自由現金流報酬率</h3>
          <span className="muted small">
            每股自由現金流 ÷ 股價：買下整家公司，每年能拿回多少現金。越高代表股價相對現金流越便宜
          </span>
        </div>
      </div>
      <div className="kpi-row">
        <div className="kpi">
          <span>以最新股價計（{priceAsOf}）</span>
          <strong>{pct(currentYield, 2)}</strong>
        </div>
        <div className="kpi">
          <span>近 5 年中位數</span>
          <strong>{pct(med, 2)}</strong>
        </div>
        <div className="kpi">
          <span>最新季末在近 5 年的位置</span>
          <strong>{rank === null ? "N/A" : `第 ${Math.round(rank * 100)} 百分位`}</strong>
        </div>
        <div className="kpi">
          <span>對照：10 年期美債殖利率</span>
          <strong>{rf === null ? "N/A" : `${rf.toFixed(2)}%`}</strong>
        </div>
      </div>
      {valid.length > 0 ? (
        <FinancialChart
          title="自由現金流報酬率 vs 盈餘殖利率（季末）"
          dates={history.map((h) => h.date)}
          dark={dark}
          unit="%"
          initialType="line"
          series={[
            {
              name: "自由現金流報酬率",
              values: history.map((h) => (h.fcfYield === null ? null : round1(h.fcfYield * 1000) / 10)),
            },
            {
              name: "盈餘殖利率（1 ÷ 本益比）",
              values: history.map((h) => (h.earningsYield === null ? null : round1(h.earningsYield * 1000) / 10)),
            },
          ]}
        />
      ) : (
        <p className="muted small">沒有可換算的季末資料（淨利或 EPS 為負，或缺少現金流量表）。</p>
      )}
      <p className="muted small">
        自由現金流 = 營業現金流 − 資本支出（SEC 財報，近四季合計）。為避免幣別（台積電財報為新臺幣、股價為美元 ADR）與股票分割造成誤差，
        以「FCF ÷ 淨利 × TTM EPS ÷ 季末股價」換算，淨利或 EPS ≤ 0 的季度留空。
        自由現金流報酬率低於盈餘殖利率，代表資本支出吃掉了大部分獲利（如台積電擴產期）。
        {vendorYield !== null ? ` 資料商 P/FCF 換算為 ${pct(vendorYield, 2)}，可交叉比對。` : ""}
      </p>
    </section>
  );
}

function Dcf({
  research,
  ticker,
  price,
  priceAsOf,
  unit,
  fcfTtm,
  fcfAvg3,
  fromVendor,
  fcfDate,
}: {
  research: Research | null;
  ticker: string;
  price: number;
  priceAsOf: string;
  unit: string;
  fcfTtm: number | null;
  fcfAvg3: number | null;
  fromVendor: boolean;
  fcfDate: string | null;
}) {
  const r = research?.roic[ticker];
  const defaultR = r
    ? wacc({ rf: research!.rf_us10y, beta: r.beta, erp: r.erp, kdSpread: r.kd_spread, tax: r.tax, debtWeight: r.debt_weight }).wacc
    : 9;
  const mid = research?.scenarios[ticker]?.find((s) => s.scenario === "mid");
  const defaults = {
    basis: "ttm" as "ttm" | "avg3",
    g1: mid ? mid.eps_cagr : 10,
    g2: mid ? round1(mid.eps_cagr / 2) : 5,
    gt: 2.5,
    r: round1(defaultR),
  };
  const [s, setS] = useState(defaults);
  const set = (key: "g1" | "g2" | "gt" | "r", v: string) => {
    const n = Number(v);
    if (Number.isFinite(n)) setS((p) => ({ ...p, [key]: n }));
  };
  const fcf = s.basis === "avg3" && fcfAvg3 !== null ? fcfAvg3 : fcfTtm;
  const input = fcf === null ? null : { fcf, g1: s.g1 / 100, g2: s.g2 / 100, gt: s.gt / 100, r: s.r / 100 };
  const res = input ? dcf(input) : null;
  const margin = res ? res.value / price - 1 : null;
  const implied = input ? impliedGrowth(price, { fcf: input.fcf, gt: input.gt, r: input.r }) : null;
  const rates = [-2, -1, 0, 1, 2].map((d) => s.r + d);
  const terminals = [s.gt - 1, s.gt, s.gt + 1];
  return (
    <section className="panel tool-panel" aria-label="現金流折現評價">
      <div className="panel-head">
        <div>
          <h3>現金流折現評價（DCF）</h3>
          <span className="muted small">
            把未來 10 年的每股自由現金流與之後的永續價值，用折現率換算回今天的價值
          </span>
        </div>
        <button className="button secondary" onClick={() => setS(defaults)}>
          還原預設假設
        </button>
      </div>
      {fcf === null || fcf <= 0 ? (
        <p className="notice">
          {fcf === null ? "缺少自由現金流資料" : "基期自由現金流為負"}，DCF 不適用。
        </p>
      ) : (
        <>
          <div className="kpi-row">
            <div className="kpi">
              <span>每股內在價值（{unit}）</span>
              <strong>{num(res?.value)}</strong>
            </div>
            <div className="kpi">
              <span>現價（{priceAsOf}）</span>
              <strong>{num(price)}</strong>
            </div>
            <div className="kpi">
              <span>安全邊際（內在價值 ÷ 現價 − 1）</span>
              <strong className={margin === null ? "" : margin >= 0 ? "positive" : "negative"}>
                {margin === null ? "N/A" : `${margin >= 0 ? "+" : ""}${pct(margin)}`}
              </strong>
            </div>
            <div className="kpi">
              <span>現價隱含的 10 年 FCF 年成長率</span>
              <strong>{pct(implied)}</strong>
            </div>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>假設</th>
                  <th>數值</th>
                  <th>說明</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>基期每股 FCF</th>
                  <td>
                    <select
                      aria-label="基期自由現金流"
                      value={s.basis}
                      onChange={(e) => setS((p) => ({ ...p, basis: e.target.value as "ttm" | "avg3" }))}
                    >
                      <option value="ttm">近四季 {num(fcfTtm)}</option>
                      {fcfAvg3 !== null && <option value="avg3">近 3 年平均 {num(fcfAvg3)}</option>}
                    </select>
                  </td>
                  <td className="wrap">
                    {fromVendor
                      ? "資料商 P/FCF 反推（本站財報無法換算）"
                      : `SEC 財報換算，截至 ${fcfDate}`}
                    ；資本支出起伏大時，可改用近 3 年平均。
                  </td>
                </tr>
                {(
                  [
                    ["g1", "第 1–5 年成長率（%）", mid ? `預設取三情境「中性」EPS 年增率 ${mid.eps_cagr}%` : "預設 10%"],
                    ["g2", "第 6–10 年成長率（%）", "預設為前 5 年的一半，反映成長趨緩"],
                    ["gt", "永續成長率（%）", "第 11 年起每年成長率，通常不超過長期名目 GDP（2–3%）"],
                    ["r", "折現率（%）", r ? `預設為本站 CAPM 估算的 WACC ${defaultR.toFixed(1)}%` : "預設 9%"],
                  ] as const
                ).map(([key, label, note]) => (
                  <tr key={key}>
                    <th>{label}</th>
                    <td>
                      <input aria-label={label} type="number" step="0.5" value={s[key]} onChange={(e) => set(key, e.target.value)} />
                    </td>
                    <td className="wrap">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {res && (
            <p className="muted small">
              價值組成：第 1–5 年 {num(res.stage1)}（{pct(res.stage1 / res.value, 0)}）、第 6–10 年 {num(res.stage2)}（
              {pct(res.stage2 / res.value, 0)}）、永續價值 {num(res.terminal)}（{pct(res.terminal / res.value, 0)}）。
              永續價值占比越高，結果越依賴遙遠未來的假設。
            </p>
          )}
          <h4>敏感度：每股內在價值（{unit}）</h4>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>折現率 ＼ 永續成長</th>
                  {terminals.map((t) => (
                    <th key={t}>{t.toFixed(1)}%</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => (
                  <tr key={rate}>
                    <th>{rate.toFixed(1)}%</th>
                    {terminals.map((t) => {
                      const v = dcf({ ...input!, r: rate / 100, gt: t / 100 })?.value ?? null;
                      return (
                        <td key={t} className={v === null ? "muted" : v >= price ? "positive" : "negative"}>
                          {num(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            綠色為高於現價、紅色為低於現價。此為簡化模型：以每股自由現金流折現，未另外加計淨現金或扣除負債，也未考慮股數稀釋與匯率；
            結果對成長率與折現率非常敏感，建議搭配「現價隱含成長率」判斷市場期待是否合理。僅供研究，不構成投資建議。
          </p>
        </>
      )}
    </section>
  );
}

function Lynch({
  price,
  priceAsOf,
  unit,
  eps,
  pe,
  cagr5,
  cagr3,
  dividendYield,
  payout,
}: {
  price: number;
  priceAsOf: string;
  unit: string;
  eps: number | null;
  pe: number | null;
  cagr5: number | null;
  cagr3: number | null;
  dividendYield: number | null;
  payout: number | null;
}) {
  const baseGrowth = cagr5 ?? cagr3;
  const defaults = {
    g: baseGrowth === null ? 10 : round1(Math.min(Math.max(baseGrowth * 100, 0), 25)),
    y: dividendYield === null ? 0 : Math.round(dividendYield * 1000) / 10,
  };
  const [s, setS] = useState(defaults);
  const set = (key: "g" | "y", v: string) => {
    const n = Number(v);
    if (Number.isFinite(n)) setS((p) => ({ ...p, [key]: n }));
  };
  if (eps === null || pe === null || eps <= 0)
    return (
      <section className="panel tool-panel" aria-label="彼得林區評價">
        <h3>彼得林區評價</h3>
        <p className="notice">TTM EPS ≤ 0 或缺少本益比，林區法不適用。</p>
      </section>
    );
  const res = lynch(eps, pe, s.g, s.y);
  const verdict = lynchVerdict(s.g > 0 ? res.ratio : null);
  const margin = res.fairValue === null ? null : res.fairValue / price - 1;
  return (
    <section className="panel tool-panel" aria-label="彼得林區評價">
      <div className="panel-head">
        <div>
          <h3>彼得林區評價</h3>
          <span className="muted small">
            合理本益比 ≈ EPS 年成長率 + 殖利率；合理價 = TTM EPS × 合理本益比
          </span>
        </div>
        <button className="button secondary" onClick={() => setS(defaults)}>
          還原預設假設
        </button>
      </div>
      <div className="kpi-row">
        <div className="kpi">
          <span>林區合理價（{unit}）</span>
          <strong>{num(res.fairValue)}</strong>
        </div>
        <div className="kpi">
          <span>現價（{priceAsOf}）</span>
          <strong>{num(price)}</strong>
        </div>
        <div className="kpi">
          <span>合理價 ÷ 現價 − 1</span>
          <strong className={margin === null ? "" : margin >= 0 ? "positive" : "negative"}>
            {margin === null ? "N/A" : `${margin >= 0 ? "+" : ""}${pct(margin)}`}
          </strong>
        </div>
        <div className="kpi">
          <span>（成長率 + 殖利率）÷ 本益比</span>
          <strong>{res.ratio === null ? "N/A" : res.ratio.toFixed(2)}</strong>
        </div>
      </div>
      <p className={`verdict ${verdict.tone}`}>{verdict.text}</p>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>項目</th>
              <th>數值</th>
              <th>說明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>TTM EPS（{unit}）</th>
              <td>{num(eps)}</td>
              <td className="wrap">現價 ÷ 本益比 {pe.toFixed(1)}×</td>
            </tr>
            <tr>
              <th>EPS 年成長率（%）</th>
              <td>
                <input aria-label="EPS 年成長率" type="number" step="0.5" value={s.g} onChange={(e) => set("g", e.target.value)} />
              </td>
              <td className="wrap">
                預設取 SEC 年度 EPS 近 5 年複合成長率 {pct(cagr5)}（近 3 年 {pct(cagr3)}），上限 25%：林區認為超過 25% 的高成長很難長期維持。
              </td>
            </tr>
            <tr>
              <th>殖利率（%）</th>
              <td>
                <input aria-label="殖利率" type="number" step="0.1" value={s.y} onChange={(e) => set("y", e.target.value)} />
              </td>
              <td className="wrap">
                {payout === null
                  ? "缺少近四季配息資料，預設 0%。"
                  : `近四季配息率 ${pct(payout)} ÷ 本益比換算（與幣別無關）。`}
              </td>
            </tr>
            <tr>
              <th>PEG（本益比 ÷ 成長率）</th>
              <td>{res.peg === null ? "N/A" : res.peg.toFixed(2)}</td>
              <td className="wrap">低於 1 通常被視為成長被低估；不含殖利率。</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted small">
        林區法適合穩定成長的公司；景氣循環股（如記憶體）在獲利高峰時本益比低、成長率高，容易看起來很便宜，需要搭配循環位置判斷。僅供研究，不構成投資建議。
      </p>
    </section>
  );
}
