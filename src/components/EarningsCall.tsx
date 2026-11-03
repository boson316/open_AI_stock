import { useEffect, useState } from "react";
import { ExternalLink, Mic } from "lucide-react";
import type { Fact } from "../lib/finance";

type Item = { label: string; value: string; detail?: string };
export type EarningsCallEntry = {
  quarter: string;
  period_end: string;
  date: string;
  source: string;
  source_label: string;
  highlights: Item[];
  summary: string[];
  guidance: string[];
  drivers: string[];
  risks: string[];
  mix: Item[];
  qa: { q: string; a: string }[];
};
export type EarningsCalls = {
  version: 1;
  note: string;
  calls: Record<string, EarningsCallEntry[]>;
};

/** 結構與必要欄位驗證；格式不對就不顯示，避免半套內容。 */
export function validateCalls(raw: unknown): EarningsCalls {
  const d = raw as EarningsCalls;
  if (!d || d.version !== 1 || typeof d.calls !== "object") throw Error("法說會資料格式無效");
  for (const [t, list] of Object.entries(d.calls))
    for (const c of list) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date) || !/^\d{4}-\d{2}-\d{2}$/.test(c.period_end))
        throw Error(`${t} 法說會日期無效`);
      if (!/^https:\/\//.test(c.source)) throw Error(`${t} 法說會缺少官方來源`);
      for (const k of ["highlights", "summary", "guidance", "drivers", "risks", "mix", "qa"] as const)
        if (!Array.isArray(c[k])) throw Error(`${t} 法說會缺少 ${k}`);
    }
  return d;
}

const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

/** 同一會計季（季末相差 20 天內）的單季值，與去年同季的年增率。 */
function quarterly(quarters: Fact[], metric: string, end: string) {
  const rows = quarters.filter((f) => f.metric === metric && f.start && days(f.start, f.end) < 110);
  const now = rows.filter((f) => days(f.end, end) <= 20).at(-1);
  if (!now) return { value: null, yoy: null };
  const prior = rows.find((f) => {
    const gap = days(f.end, now.end);
    return gap >= 350 && gap <= 380;
  });
  return {
    value: now.value,
    yoy: prior && prior.value > 0 ? now.value / prior.value - 1 : null,
  };
}

const pct = (v: number | null) =>
  v === null || !Number.isFinite(v) ? "N/A" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

export function EarningsCall({
  base,
  ticker,
  quarters,
  shareUnit,
}: {
  base: string;
  ticker: string;
  quarters: Fact[];
  shareUnit: string;
}) {
  const [data, setData] = useState<EarningsCalls | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${base}data/earnings-calls.json`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => setData(validateCalls(j)))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [base]);
  useEffect(() => setOpen(false), [ticker]);

  if (error) return <div className="notice error" role="alert">法說會資料讀取失敗：{error}</div>;
  const call = data?.calls[ticker]
    ?.slice()
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!data || !call) return null;
  const eps = quarterly(quarters, "eps", call.period_end);
  const revenue = quarterly(quarters, "revenue", call.period_end);
  const list = (title: string, items: string[], tone = "") =>
    items.length > 0 && (
      <div className={`call-block ${tone}`}>
        <h4>{title}</h4>
        <ul>
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <section className="panel tool-panel earnings-call" aria-label="最新法說會重點">
      <div className="panel-head">
        <div>
          <h3>
            <Mic size={18} /> 最新法說會重點：{call.quarter}
          </h3>
          <span className="muted small">本站自行整理的重點，不是逐字稿；數字以公司公布為準</span>
        </div>
        <a className="button secondary" href={call.source} target="_blank" rel="noreferrer">
          官方原文 <ExternalLink size={14} />
        </a>
      </div>
      <div className="kpi-row">
        <div className="kpi">
          <span>法說會日期</span>
          <strong>{call.date.slice(2).replaceAll("-", "/")}</strong>
        </div>
        <div className="kpi">
          <span>本季 EPS（{shareUnit}）</span>
          <strong>{eps.value === null ? "N/A" : eps.value.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}</strong>
        </div>
        <div className="kpi">
          <span>EPS 年增率</span>
          <strong className={eps.yoy === null ? "" : eps.yoy >= 0 ? "positive" : "negative"}>{pct(eps.yoy)}</strong>
        </div>
        <div className="kpi">
          <span>營收年增率（財報幣別）</span>
          <strong className={revenue.yoy === null ? "" : revenue.yoy >= 0 ? "positive" : "negative"}>{pct(revenue.yoy)}</strong>
        </div>
      </div>
      <ul className="call-summary">
        {call.summary.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {open && (
        <div className="call-detail">
          <div className="call-chips">
            {call.highlights.map((h) => (
              <span key={h.label} className="call-chip">
                <small>{h.label}</small>
                <strong>{h.value}</strong>
                {h.detail && <small>{h.detail}</small>}
              </span>
            ))}
          </div>
          <div className="call-grid">
            {list("成長動能", call.drivers, "positive")}
            {list("風險", call.risks, "negative")}
            {list("財測與指引", call.guidance)}
          </div>
          {call.mix.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>營收結構</th>
                    <th>占比</th>
                    <th>變化</th>
                  </tr>
                </thead>
                <tbody>
                  {call.mix.map((m) => (
                    <tr key={m.label}>
                      <th>{m.label}</th>
                      <td>{m.value}</td>
                      <td>{m.detail ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h4>法人 Q&amp;A</h4>
          {call.qa.map((x) => (
            <details key={x.q} className="call-qa">
              <summary>{x.q}</summary>
              <p>{x.a}</p>
            </details>
          ))}
          <p className="muted small">
            {data.note} 本季 EPS 與年增率取自本站 SEC 財報資料。來源：
            <a href={call.source} target="_blank" rel="noreferrer">
              {call.source_label}
            </a>
            。僅供研究，不構成投資建議。
          </p>
        </div>
      )}
      <button className="call-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "收合" : "查看完整內容"}
      </button>
    </section>
  );
}
