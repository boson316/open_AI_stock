import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { FinancialChart } from "./FinancialChart";
import { COMPARE_METRICS, metricSeries, ttmSummary } from "../lib/compare";
import { csvDownload, normalize, validateDataset } from "../lib/finance";
import type { Catalog, Fact } from "../lib/finance";

type Loaded = { quarters: Fact[]; financial: boolean; currency: string };
const MAX = 6;
const TABLE_COLUMNS = [
  ["gross_margin", "毛利率", true],
  ["operating_margin", "營業利益率", true],
  ["net_margin", "淨利率", true],
  ["fcf_margin", "FCF 率", true],
  ["capex_ratio", "CapEx／營收", false],
  ["cash_quality", "OCF／淨利", true],
] as const;

const pct = (v: number | null) =>
  v === null ? "N/A" : `${(v * 100).toFixed(1)}%`;
const times = (v: number | null) => (v === null ? "N/A" : `${v.toFixed(2)}×`);

export function Compare({
  catalog,
  base,
  dark,
  current,
  colors,
}: {
  catalog: Catalog;
  base: string;
  dark: boolean;
  current: string;
  colors: Record<string, string>;
}) {
  const available = catalog.companies.filter(
    (c) => c.status === "available" && c.file,
  );
  const [selected, setSelected] = useState<string[]>(() => {
    const me = available.find((c) => c.ticker === current);
    const peers = available
      .filter((c) => c.ticker !== current && c.sector === me?.sector)
      .slice(0, 2)
      .map((c) => c.ticker);
    const rest = available
      .filter((c) => c.ticker !== current && !peers.includes(c.ticker))
      .map((c) => c.ticker);
    return [current, ...peers, ...rest].slice(0, 3);
  });
  const [metric, setMetric] = useState("gross_margin");
  const [data, setData] = useState<Record<string, Loaded>>({});
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    for (const t of selected) {
      const c = available.find((x) => x.ticker === t);
      if (
        !c ||
        data[t] ||
        failed.includes(t) ||
        !c.file ||
        !/^[A-Z]+\.json$/.test(c.file)
      )
        continue;
      fetch(`${base}data/${c.file}`, { signal: controller.signal })
        .then((r) => {
          if (!r.ok) throw Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then(validateDataset)
        .then((d) => {
          if (d.ticker !== t || d.cik !== c.cik) throw Error("公司資料不一致");
          setData((prev) => ({
            ...prev,
            [t]: {
              quarters: normalize(d.facts),
              financial: c.sector === "fintech" || c.sector === "bank",
              currency: d.currency ?? "USD",
            },
          }));
        })
        .catch((e) => {
          if (e.name !== "AbortError") setFailed((prev) => [...prev, t]);
        });
    }
    return () => controller.abort();
  }, [selected, catalog, base]);

  const ready = selected.filter((t) => data[t]);
  const def = COMPARE_METRICS.find((m) => m.id === metric)!;
  const isMultiple = metric === "cash_quality";
  const series = useMemo(
    () =>
      ready.map((t) => ({
        ticker: t,
        map: metricSeries(data[t].quarters, metric, data[t].financial),
      })),
    [ready.join(","), data, metric],
  );
  const dates = [
    ...new Set(
      series.flatMap((s) =>
        [...s.map.entries()].filter(([, v]) => v !== null).map(([d]) => d),
      ),
    ),
  ]
    // 各公司結帳日不同，聯集後最多相差一兩個曆季；多留 2 季，確保每家公司近 20 季都完整顯示。
    .sort()
    .slice(-22);
  const summaries = ready.map((t) => ({
    ticker: t,
    ...ttmSummary(data[t].quarters, data[t].financial),
  }));
  const best = (id: (typeof TABLE_COLUMNS)[number][0], higher: boolean) => {
    const vals = summaries
      .map((s) => s[id])
      .filter((v): v is number => v !== null);
    return vals.length > 1
      ? higher
        ? Math.max(...vals)
        : Math.min(...vals)
      : null;
  };
  const toggle = (t: string) =>
    setSelected((prev) =>
      prev.includes(t)
        ? prev.length > 1
          ? prev.filter((x) => x !== t)
          : prev
        : prev.length < MAX
          ? [...prev, t]
          : prev,
    );

  return (
    <section id="compare" className="compare">
      <div className="section-title">
        <div>
          <span className="eyebrow">PEER COMPARISON</span>
          <h2>多股比較</h2>
        </div>
      </div>
      <div className="panel compare-controls">
        <div>
          <h3>選擇公司（最多 {MAX} 檔）</h3>
          <div className="chip-row" role="group" aria-label="比較公司">
            {available.map((c) => (
              <button
                key={c.ticker}
                className={`chip ${selected.includes(c.ticker) ? "on" : ""}`}
                aria-pressed={selected.includes(c.ticker)}
                disabled={
                  !selected.includes(c.ticker) && selected.length >= MAX
                }
                onClick={() => toggle(c.ticker)}
              >
                <span
                  className="chip-dot"
                  style={{ background: colors[c.ticker] ?? "#5376e5" }}
                />
                {c.ticker}
              </button>
            ))}
          </div>
        </div>
        <div>
          <h3>比較指標</h3>
          <div className="chip-row" role="group" aria-label="比較指標">
            {COMPARE_METRICS.map((m) => (
              <button
                key={m.id}
                className={`chip ${metric === m.id ? "on" : ""}`}
                aria-pressed={metric === m.id}
                onClick={() => setMetric(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {failed.length > 0 && (
        <div className="notice error" role="alert">
          讀取失敗：{failed.join("、")}
        </div>
      )}
      <FinancialChart
        title={`多股比較：${def.label}`}
        dark={dark}
        dates={dates}
        unit={isMultiple ? "倍" : "%"}
        initialType="line"
        height={360}
        series={series.map((s) => ({
          name: s.ticker,
          values: dates.map((d) => {
            const v = s.map.get(d);
            return v === null || v === undefined
              ? null
              : isMultiple
                ? v
                : v * 100;
          }),
        }))}
      />
      <div className="panel compare-table-panel">
        <div className="panel-head">
          <h3>近四季（TTM）核心比率</h3>
          <button
            className="button secondary"
            onClick={() =>
              csvDownload("peer-comparison.csv", [
                ["代號", ...TABLE_COLUMNS.map((c) => c[1])],
                ...summaries.map((s) => [
                  s.ticker,
                  ...TABLE_COLUMNS.map(([id]) =>
                    s[id] === null
                      ? null
                      : id === "cash_quality"
                        ? s[id]!.toFixed(4)
                        : (s[id]! * 100).toFixed(2),
                  ),
                ]),
              ])
            }
          >
            <Download size={14} />
            匯出 CSV
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>公司</th>
                {TABLE_COLUMNS.map((c) => (
                  <th key={c[0]}>{c[1]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => (
                <tr key={s.ticker}>
                  <th>
                    <span
                      className="chip-dot"
                      style={{ background: colors[s.ticker] ?? "#5376e5" }}
                    />{" "}
                    {s.ticker}
                  </th>
                  {TABLE_COLUMNS.map(([id, , higher]) => (
                    <td
                      key={id}
                      className={
                        s[id] !== null && s[id] === best(id, higher)
                          ? "best"
                          : ""
                      }
                    >
                      {id === "cash_quality" ? times(s[id]) : pct(s[id])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="notice">
        <div>
          <strong>比較說明</strong>
          <p>
            各公司會計年度不同，圖表以最近的曆季季末對齊（例如 NVIDIA 7
            月底季度對到
            6/30），僅為視覺對齊，不代表同一天結帳。只比較比率，不比較金額：TSM
            為新臺幣、TIFRS，其餘為美元 US
            GAAP，不可直接比較絕對金額。SOFI
            為金融公司，毛利率不適用；TTM
            欄位為連續四季，不連續時顯示 N/A，不補零。
            {def.note ? `${def.label}：${def.note}。` : ""}
            表中綠字為各欄最佳值（CapEx／營收以最低為佳）。僅供研究，不構成投資建議。
          </p>
        </div>
      </div>
    </section>
  );
}
