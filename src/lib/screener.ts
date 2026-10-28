import { ttm } from "./finance";
import type { Fact } from "./finance";
import { metricSeries, ttmSummary } from "./compare";

export type ScreenMetric = {
  id: string;
  label: string;
  unit: "%" | "×";
  higherIsBetter: boolean;
};

export const SCREEN_METRICS: ScreenMetric[] = [
  { id: "gross_margin", label: "毛利率（TTM）", unit: "%", higherIsBetter: true },
  { id: "operating_margin", label: "營業利益率（TTM）", unit: "%", higherIsBetter: true },
  { id: "net_margin", label: "淨利率（TTM）", unit: "%", higherIsBetter: true },
  { id: "fcf_margin", label: "FCF 率（TTM）", unit: "%", higherIsBetter: true },
  { id: "capex_ratio", label: "CapEx／營收（TTM）", unit: "%", higherIsBetter: false },
  { id: "cash_quality", label: "OCF／淨利（TTM）", unit: "×", higherIsBetter: true },
  { id: "revenue_ttm_growth", label: "TTM 營收年增率", unit: "%", higherIsBetter: true },
  { id: "revenue_yoy", label: "最新季營收年增率", unit: "%", higherIsBetter: true },
  { id: "net_income_yoy", label: "最新季淨利年增率", unit: "%", higherIsBetter: true },
  { id: "eps_yoy", label: "最新季 EPS 年增率", unit: "%", higherIsBetter: true },
];

export type ScreenRow = {
  ticker: string;
  name: string;
  currency: string;
  latest: string | null;
  values: Record<string, number | null>;
};

export type Filter = { min: string; max: string };
export type Filters = Record<string, Filter>;

/** 連續四季 TTM 營收，與一年前同一窗口比較；任一窗口不連續即 N/A。 */
export function ttmRevenueGrowth(quarters: Fact[]): number | null {
  const rev = quarters
    .filter((f) => f.metric === "revenue" && f.start)
    .sort((a, b) => a.end.localeCompare(b.end));
  if (rev.length < 5) return null;
  const now = rev.slice(-4);
  const target = Date.parse(now[3].end) - 365 * 86400000;
  const anchor = rev.findIndex((f) => Math.abs(Date.parse(f.end) - target) <= 15 * 86400000);
  if (anchor < 3) return null;
  const a = ttm(now),
    b = ttm(rev.slice(anchor - 3, anchor + 1));
  return a === null || b === null || b <= 0 ? null : a / b - 1;
}

export function buildRow(
  ticker: string,
  name: string,
  currency: string,
  quarters: Fact[],
  financial: boolean,
): ScreenRow {
  const t = ttmSummary(quarters, financial);
  const latestOf = (id: string) => {
    const s = [...metricSeries(quarters, id, financial).entries()].sort(([a], [b]) => a.localeCompare(b));
    return s.at(-1)?.[1] ?? null;
  };
  const ends = quarters.filter((f) => f.metric === "revenue").map((f) => f.end).sort();
  return {
    ticker,
    name,
    currency,
    latest: ends.at(-1) ?? null,
    values: {
      gross_margin: t.gross_margin,
      operating_margin: t.operating_margin,
      net_margin: t.net_margin,
      fcf_margin: t.fcf_margin,
      capex_ratio: t.capex_ratio,
      cash_quality: t.cash_quality,
      revenue_ttm_growth: ttmRevenueGrowth(quarters),
      revenue_yoy: latestOf("revenue_yoy"),
      net_income_yoy: latestOf("net_income_yoy"),
      eps_yoy: latestOf("eps_yoy"),
    },
  };
}

const parse = (s: string) => {
  const v = Number(s.trim());
  return s.trim() === "" || !Number.isFinite(v) ? null : v;
};

/** 啟用條件的欄位若為 N/A 一律不符合，不把缺值當成通過。 */
export function applyFilters(rows: ScreenRow[], filters: Filters): ScreenRow[] {
  const active = SCREEN_METRICS.flatMap((m) => {
    const f = filters[m.id];
    if (!f) return [];
    const min = parse(f.min),
      max = parse(f.max);
    return min === null && max === null ? [] : [{ m, min, max }];
  });
  return rows.filter((r) =>
    active.every(({ m, min, max }) => {
      const raw = r.values[m.id];
      if (raw === null || raw === undefined) return false;
      const v = m.unit === "%" ? raw * 100 : raw;
      return (min === null || v >= min) && (max === null || v <= max);
    }),
  );
}

export const PRESETS: { id: string; label: string; description: string; filters: Filters }[] = [
  {
    id: "growth-margin",
    label: "高毛利成長",
    description: "毛利率 ≥ 50%，TTM 營收年增率 ≥ 15%",
    filters: { gross_margin: { min: "50", max: "" }, revenue_ttm_growth: { min: "15", max: "" } },
  },
  {
    id: "cash-solid",
    label: "現金流穩健",
    description: "FCF 率 ≥ 15%，OCF／淨利 ≥ 1",
    filters: { fcf_margin: { min: "15", max: "" }, cash_quality: { min: "1", max: "" } },
  },
  {
    id: "profit-growth",
    label: "獲利與成長兼具",
    description: "淨利率 ≥ 20%，最新季營收年增率 ≥ 10%",
    filters: { net_margin: { min: "20", max: "" }, revenue_yoy: { min: "10", max: "" } },
  },
];
