import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { csvDownload, normalize, validateDataset } from "../lib/finance";
import type { Catalog } from "../lib/finance";
import {
  PRESETS,
  SCREEN_METRICS,
  applyFilters,
  buildRow,
} from "../lib/screener";
import type { Filters, ScreenRow } from "../lib/screener";

const fmt = (v: number | null | undefined, unit: "%" | "×") =>
  v === null || v === undefined
    ? "N/A"
    : unit === "%"
      ? `${(v * 100).toFixed(1)}%`
      : `${v.toFixed(2)}×`;

export function Screener({
  catalog,
  base,
  colors,
  onSelect,
}: {
  catalog: Catalog;
  base: string;
  colors: Record<string, string>;
  onSelect: (ticker: string) => void;
}) {
  const [rows, setRows] = useState<ScreenRow[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({});
  const [preset, setPreset] = useState("");
  const [sort, setSort] = useState<{ id: string; desc: boolean }>({
    id: "ticker",
    desc: false,
  });

  useEffect(() => {
    const controller = new AbortController();
    const targets = catalog.companies.filter(
      (c) => c.status === "available" && c.file && /^[A-Z]+\.json$/.test(c.file),
    );
    setLoading(true);
    Promise.all(
      targets.map(async (c) => {
        try {
          const r = await fetch(`${base}data/${c.file}`, {
            signal: controller.signal,
          });
          if (!r.ok) throw Error(`HTTP ${r.status}`);
          const d = validateDataset(await r.json());
          if (d.ticker !== c.ticker || d.cik !== c.cik)
            throw Error("公司資料不一致");
          return buildRow(
            c.ticker,
            c.name,
            d.currency ?? "USD",
            normalize(d.facts),
            c.sector === "fintech" || c.sector === "bank",
          );
        } catch (e) {
          if ((e as Error).name !== "AbortError")
            setFailed((prev) => [...prev, c.ticker]);
          return null;
        }
      }),
    ).then((result) => {
      if (controller.signal.aborted) return;
      setRows(result.filter((x): x is ScreenRow => x !== null));
      setLoading(false);
    });
    return () => controller.abort();
  }, [catalog, base]);

  const matched = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const shown = useMemo(() => {
    const value = (r: ScreenRow) =>
      sort.id === "ticker" ? r.ticker : (r.values[sort.id] ?? null);
    return [...matched].sort((a, b) => {
      const x = value(a),
        y = value(b);
      // N/A 一律排最後，不受升降冪影響。
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      return sort.desc ? -c : c;
    });
  }, [matched, sort]);
  const activeCount = Object.values(filters).filter(
    (f) => f.min.trim() !== "" || f.max.trim() !== "",
  ).length;
  const setBound = (id: string, key: "min" | "max", v: string) => {
    setPreset("");
    setFilters((prev) => ({
      ...prev,
      [id]: { min: prev[id]?.min ?? "", max: prev[id]?.max ?? "", [key]: v },
    }));
  };
  const header = (id: string, label: string) => (
    <th
      key={id}
      aria-sort={
        sort.id === id ? (sort.desc ? "descending" : "ascending") : "none"
      }
    >
      <button
        className="sort-button"
        onClick={() =>
          setSort((s) => ({ id, desc: s.id === id ? !s.desc : id !== "ticker" }))
        }
      >
        {label}
        {sort.id === id ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  return (
    <section id="screener" className="compare screener">
      <div className="section-title">
        <div>
          <span className="eyebrow">STOCK SCREENER</span>
          <h2>選股篩選</h2>
        </div>
      </div>
      <div className="panel compare-controls">
        <div>
          <h3>快速條件</h3>
          <div className="chip-row" role="group" aria-label="快速條件">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                className={`chip ${preset === p.id ? "on" : ""}`}
                aria-pressed={preset === p.id}
                title={p.description}
                onClick={() => {
                  setPreset(p.id);
                  setFilters(p.filters);
                }}
              >
                {p.label}
              </button>
            ))}
            <button
              className="chip"
              onClick={() => {
                setPreset("");
                setFilters({});
              }}
            >
              清除條件
            </button>
          </div>
          {preset && (
            <p className="muted small">
              {PRESETS.find((p) => p.id === preset)?.description}
            </p>
          )}
        </div>
        <div>
          <h3>自訂條件（留空表示不限，單位 % 或倍數）</h3>
          <div className="filter-grid">
            {SCREEN_METRICS.map((m) => (
              <div className="filter-row" key={m.id}>
                <span>{m.label}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  aria-label={`${m.label} 下限`}
                  placeholder="最小"
                  value={filters[m.id]?.min ?? ""}
                  onChange={(e) => setBound(m.id, "min", e.target.value)}
                />
                <span aria-hidden>～</span>
                <input
                  type="number"
                  inputMode="decimal"
                  aria-label={`${m.label} 上限`}
                  placeholder="最大"
                  value={filters[m.id]?.max ?? ""}
                  onChange={(e) => setBound(m.id, "max", e.target.value)}
                />
                <small>{m.unit}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
      {failed.length > 0 && (
        <div className="notice error" role="alert">
          讀取失敗：{failed.join("、")}
        </div>
      )}
      <div className="panel compare-table-panel">
        <div className="panel-head">
          <h3 role="status">
            {loading
              ? "載入 13 檔資料中…"
              : `符合條件 ${matched.length} / ${rows.length} 檔${activeCount ? `（${activeCount} 項條件）` : "（未設條件）"}`}
          </h3>
          <button
            className="button secondary"
            disabled={!shown.length}
            onClick={() =>
              csvDownload("screener.csv", [
                ["代號", "名稱", "最新季度", ...SCREEN_METRICS.map((m) => `${m.label} (${m.unit})`)],
                ...shown.map((r) => [
                  r.ticker,
                  r.name,
                  r.latest,
                  ...SCREEN_METRICS.map((m) => {
                    const v = r.values[m.id];
                    return v === null || v === undefined
                      ? null
                      : m.unit === "%"
                        ? (v * 100).toFixed(2)
                        : v.toFixed(4);
                  }),
                ]),
              ])
            }
          >
            <Download size={14} />
            匯出結果 CSV
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {header("ticker", "公司")}
                <th>最新季度</th>
                {SCREEN_METRICS.map((m) => header(m.id, m.label))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.ticker}>
                  <th>
                    <button
                      className="link-button"
                      aria-label={`查看 ${r.ticker}`}
                      onClick={() => onSelect(r.ticker)}
                    >
                      <span
                        className="chip-dot"
                        style={{ background: colors[r.ticker] ?? "#5376e5" }}
                      />{" "}
                      {r.ticker}
                      <small>{r.name}</small>
                    </button>
                  </th>
                  <td>{r.latest ?? "N/A"}</td>
                  {SCREEN_METRICS.map((m) => (
                    <td key={m.id}>{fmt(r.values[m.id], m.unit)}</td>
                  ))}
                </tr>
              ))}
              {!loading && !shown.length && (
                <tr>
                  <td colSpan={SCREEN_METRICS.length + 2} className="empty-row">
                    沒有符合條件的股票。放寬條件，或注意：啟用條件的欄位若為 N/A（例如
                    SOFI 的毛利率）一律視為不符合。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="notice">
        <div>
          <strong>篩選說明</strong>
          <p>
            篩選範圍僅限本站收錄的 13
            檔，不是全市場選股。TTM
            指標為連續四季合計，不連續時為 N/A；年增率比較同一公司相隔約一年的季度。各公司最新季度截止日不同（見「最新季度」欄），TSM
            為新臺幣 TIFRS，只可比較比率。N/A
            一律不符合已啟用條件，不補零。EPS 為各期官方披露值，未統一拆股調整。結果僅供研究，不構成投資建議。
          </p>
        </div>
      </div>
    </section>
  );
}
