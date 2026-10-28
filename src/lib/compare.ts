import { ttm } from "./finance";
import type { Fact } from "./finance";

export type CompareMetric = {
  id: string;
  label: string;
  note?: string;
  /** 金融公司沒有毛利率，維持 N/A 而非替代。 */
  skipFinancial?: boolean;
};

export const COMPARE_METRICS: CompareMetric[] = [
  { id: "gross_margin", label: "毛利率", skipFinancial: true },
  { id: "operating_margin", label: "營業利益率" },
  { id: "net_margin", label: "淨利率" },
  { id: "revenue_yoy", label: "營收年增率" },
  { id: "net_income_yoy", label: "淨利年增率" },
  { id: "eps_yoy", label: "EPS 年增率", note: "EPS 為各期官方披露，未統一拆股調整" },
  { id: "fcf_margin", label: "自由現金流率（FCF／營收）" },
  { id: "capex_ratio", label: "資本支出占營收" },
  { id: "sbc_ratio", label: "股票薪酬占營收" },
  { id: "cash_quality", label: "現金流品質（OCF／淨利）", note: "淨利接近 0 或為負時比值失真" },
];

type Row = Partial<
  Record<
    "revenue" | "gross_profit" | "operating_income" | "net_income" | "eps" | "ocf" | "capex" | "sbc",
    number
  >
>;

const QUARTER_ENDS = [
  [3, 31],
  [6, 30],
  [9, 30],
  [12, 31],
];

/** 把各公司不同會計年度的季末，對齊到最近的曆季季末（例如 NVDA 7/26 → 6/30）。 */
export function calendarBucket(end: string): string {
  const t = Date.parse(end);
  const year = Number(end.slice(0, 4));
  let best = "";
  let distance = Infinity;
  for (let y = year - 1; y <= year + 1; y++)
    for (const [m, d] of QUARTER_ENDS) {
      const iso = `${y}-${String(m).padStart(2, "0")}-${d}`;
      const gap = Math.abs(Date.parse(iso) - t);
      if (gap < distance) {
        distance = gap;
        best = iso;
      }
    }
  return best;
}

const METRIC_KEYS = [
  "revenue",
  "gross_profit",
  "operating_income",
  "net_income",
  "eps",
  "ocf",
  "capex",
  "sbc",
] as const;

function byPeriod(quarters: Fact[]): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const f of quarters) {
    if (!(METRIC_KEYS as readonly string[]).includes(f.metric)) continue;
    const row = rows.get(f.end) ?? {};
    row[f.metric as (typeof METRIC_KEYS)[number]] = f.value;
    rows.set(f.end, row);
  }
  return rows;
}

const ratio = (a?: number, b?: number) =>
  a === undefined || b === undefined || b === 0 ? null : a / b;
const fcf = (r: Row) =>
  r.ocf === undefined || r.capex === undefined ? undefined : r.ocf - Math.abs(r.capex);

function compute(id: string, r: Row, prior?: Row, financial = false): number | null {
  switch (id) {
    case "gross_margin":
      return financial ? null : ratio(r.gross_profit, r.revenue);
    case "operating_margin":
      return ratio(r.operating_income, r.revenue);
    case "net_margin":
      return ratio(r.net_income, r.revenue);
    case "fcf_margin":
      return ratio(fcf(r), r.revenue);
    case "capex_ratio":
      return r.capex === undefined ? null : ratio(Math.abs(r.capex), r.revenue);
    case "sbc_ratio":
      return ratio(r.sbc, r.revenue);
    case "cash_quality":
      return r.net_income !== undefined && r.net_income > 0 ? ratio(r.ocf, r.net_income) : null;
    case "revenue_yoy":
    case "net_income_yoy":
    case "eps_yoy": {
      const key = id === "revenue_yoy" ? "revenue" : id === "net_income_yoy" ? "net_income" : "eps";
      const now = r[key],
        before = prior?.[key];
      // 前期為零或負數時成長率沒有意義，維持 N/A。
      return now === undefined || before === undefined || before <= 0 ? null : now / before - 1;
    }
  }
  return null;
}

/** 單一公司在每個曆季桶的指標值（桶 → 值，缺值為 null）。 */
export function metricSeries(
  quarters: Fact[],
  metricId: string,
  financial: boolean,
): Map<string, number | null> {
  const rows = byPeriod(quarters);
  const ends = [...rows.keys()].sort();
  const out = new Map<string, number | null>();
  for (const end of ends) {
    const priorEnd = ends.find((e) => {
      const n = (Date.parse(end) - Date.parse(e)) / 86400000;
      return n >= 350 && n <= 380;
    });
    out.set(
      calendarBucket(end),
      compute(metricId, rows.get(end)!, priorEnd ? rows.get(priorEnd) : undefined, financial),
    );
  }
  return out;
}

/** 以 TTM（連續四季）計算比較表；不連續即回傳 null。 */
export function ttmSummary(quarters: Fact[], financial: boolean) {
  const four = (m: string) =>
    ttm(
      quarters
        .filter((f) => f.metric === m && f.start)
        .sort((a, b) => a.end.localeCompare(b.end))
        .slice(-4),
    );
  const revenue = four("revenue"),
    gp = four("gross_profit"),
    op = four("operating_income"),
    ni = four("net_income"),
    ocf = four("ocf"),
    capex = four("capex");
  const free = ocf === null || capex === null ? null : ocf - Math.abs(capex);
  const nz = (a: number | null, b: number | null) => (a === null || !b ? null : a / b);
  return {
    gross_margin: financial ? null : nz(gp, revenue),
    operating_margin: nz(op, revenue),
    net_margin: nz(ni, revenue),
    fcf_margin: nz(free, revenue),
    capex_ratio: capex === null ? null : nz(Math.abs(capex), revenue),
    cash_quality: ni !== null && ni > 0 ? nz(ocf, ni) : null,
  };
}
