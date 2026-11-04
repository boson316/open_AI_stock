import { annual, cagr, ttm, type Fact } from "./finance";

/** 外部季末估值資料的一列（見 ExternalValuation.tsx）。 */
export type QuarterPrice = {
  date: string;
  label: string;
  price: number;
  eps_ttm: number | null;
};

/**
 * 沒有外部估值資料時：用自動股價（週收盤）與 SEC 財報組出季末股價、TTM EPS。
 * 每個財季末取該日（含）之前 10 天內最後一筆週收盤；最後一列為最新收盤。
 * quarters 需已換算到與股價相同的股數基礎（adjustForSplits）。
 */
export function quarterPricesFromWeekly(
  quarters: Fact[],
  weekly: [string, number][],
  latest: { date: string; close: number } | null,
): QuarterPrice[] {
  const ends = [...new Set(quarters.filter((f) => f.metric === "eps").map((f) => f.end))].sort();
  const sorted = [...weekly].sort((a, b) => a[0].localeCompare(b[0]));
  const rows: QuarterPrice[] = [];
  for (const end of ends) {
    const hit = sorted.filter(([d]) => d <= end && days(d, end) <= 10).at(-1);
    if (!hit) continue;
    rows.push({ date: end, label: `${end.slice(2, 4)}/${end.slice(5, 7)}`, price: hit[1], eps_ttm: ttmAt(quarters, "eps", end) });
  }
  if (latest && latest.close > 0 && (!rows.length || latest.date > rows.at(-1)!.date)) {
    const lastEnd = ends.at(-1);
    rows.push({ date: latest.date, label: "最新", price: latest.close, eps_ttm: lastEnd ? ttmAt(quarters, "eps", lastEnd) : null });
  }
  return rows;
}

const days = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

/** 截至 end（含）最近四個連續單季的 TTM 合計；不足或不連續時 null。 */
export function ttmAt(quarters: Fact[], metric: string, end: string) {
  // 容許 20 天誤差：52/53 週會計年度的季末每年差一兩天（如 Apple、AMD）。
  const limit = new Date(Date.parse(end) + 20 * 86400000).toISOString().slice(0, 10);
  const rows = quarters.filter((f) => f.metric === metric && f.end <= limit);
  const lastRow = rows.at(-1);
  if (!lastRow || days(lastRow.end, end) > 20) return null;
  return ttm(rows.slice(-4));
}

/** TTM 自由現金流 = 營業現金流 − |資本支出|。 */
export function fcfAt(quarters: Fact[], end: string) {
  const ocf = ttmAt(quarters, "ocf", end),
    capex = ttmAt(quarters, "capex", end);
  return ocf === null || capex === null ? null : ocf - Math.abs(capex);
}

export type FcfYieldPoint = {
  date: string;
  label: string;
  price: number;
  /** 以股價幣別、每股（TSM 為每 ADR）表示的 TTM 自由現金流 */
  fcfPerShare: number | null;
  fcfYield: number | null;
  earningsYield: number | null;
};

/**
 * 自由現金流報酬率歷史。
 * 不直接用「FCF ÷ 市值」：外部股價為美元（TSM 為 ADR），SEC 財報可能是新臺幣，
 * 也可能有股票分割。改以「FCF ÷ 淨利」這個與幣別、股數無關的比值，
 * 乘上同一來源的 TTM EPS 換成每股（股價幣別）FCF，再除以股價：
 *   FCF 殖利率 = (TTM FCF ÷ TTM 淨利) × (TTM EPS ÷ 股價)
 * 淨利 ≤ 0 或 EPS ≤ 0 時無法換算，留空。
 */
export function fcfYieldHistory(
  quarters: Fact[],
  rows: QuarterPrice[],
): FcfYieldPoint[] {
  const ends = [
    ...new Set(quarters.filter((f) => f.metric === "ocf").map((f) => f.end)),
  ].sort();
  return rows.map((r) => {
    // 外部資料日期為季末月份最後一日；公司會計季末可能差幾天（如 Apple）。
    const end = ends.filter((e) => days(e, r.date) <= 20).at(-1);
    const fcf = end ? fcfAt(quarters, end) : null;
    const ni = end ? ttmAt(quarters, "net_income", end) : null;
    const eps = r.eps_ttm;
    const fcfPerShare =
      fcf !== null && ni !== null && ni > 0 && eps !== null && eps > 0
        ? (fcf / ni) * eps
        : null;
    return {
      date: r.date,
      label: r.label,
      price: r.price,
      fcfPerShare,
      fcfYield: fcfPerShare === null ? null : fcfPerShare / r.price,
      earningsYield: eps !== null && eps > 0 ? eps / r.price : null,
    };
  });
}

export const median = (values: number[]) => {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y),
    m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/** 年度 EPS 的 n 年複合成長率（同幣別、同股數口徑相除，與幣別無關）。 */
export function epsCagr(raw: Fact[], years: number) {
  const eps = annual(raw).filter((f) => f.metric === "eps");
  const lastRow = eps.at(-1);
  if (!lastRow) return null;
  const prior = eps.find(
    (f) => Math.abs(days(f.end, lastRow.end) / 365.2425 - years) < 0.05,
  );
  return prior ? cagr(prior.value, lastRow.value, prior.end, lastRow.end) : null;
}

/**
 * 林區法用的 EPS 成長率：依序試 5、4、3、2 年年度 EPS 複合成長率，取第一個可算的。
 * 期初年度虧損（EPS ≤ 0）時複合成長率沒有意義，回傳 null 並說明原因。
 */
export function epsGrowthBest(raw: Fact[]): { value: number | null; years: number | null; reason: string | null } {
  for (const y of [5, 4, 3, 2]) {
    const v = epsCagr(raw, y);
    if (v !== null) return { value: v, years: y, reason: null };
  }
  const eps = annual(raw).filter((f) => f.metric === "eps");
  const lossYears = eps.filter((f) => f.value <= 0).map((f) => f.end.slice(0, 4));
  return {
    value: null,
    years: null,
    reason: lossYears.length
      ? `近年有年度 EPS ≤ 0（${lossYears.slice(-3).join("、")} 年度），無法計算複合成長率`
      : "年度 EPS 資料不足 2 年",
  };
}

export type DcfInput = {
  /** 基期每股自由現金流 */
  fcf: number;
  /** 第 1–5 年年成長率（小數） */
  g1: number;
  /** 第 6–10 年年成長率（小數） */
  g2: number;
  /** 永續成長率（小數） */
  gt: number;
  /** 折現率（小數） */
  r: number;
};

/** 兩階段 + 永續成長的每股 DCF；折現率須大於永續成長率。 */
export function dcf({ fcf, g1, g2, gt, r }: DcfInput) {
  if (!(r > gt) || !Number.isFinite(fcf)) return null;
  let cash = fcf,
    stage1 = 0,
    stage2 = 0;
  for (let y = 1; y <= 10; y++) {
    cash *= 1 + (y <= 5 ? g1 : g2);
    const pv = cash / (1 + r) ** y;
    if (y <= 5) stage1 += pv;
    else stage2 += pv;
  }
  const terminal = (cash * (1 + gt)) / (r - gt) / (1 + r) ** 10;
  const value = stage1 + stage2 + terminal;
  return { value, stage1, stage2, terminal };
}

/**
 * 反推 DCF：要讓內在價值等於現價，前 10 年需要的年成長率
 * （第 1–10 年同一成長率，其餘假設不變）。找不到時 null。
 */
export function impliedGrowth(
  price: number,
  input: Omit<DcfInput, "g1" | "g2">,
) {
  if (input.fcf <= 0 || price <= 0) return null;
  const at = (g: number) => dcf({ ...input, g1: g, g2: g })?.value ?? NaN;
  let lo = -0.5,
    hi = 1.5;
  if (!(at(lo) <= price && at(hi) >= price)) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < price) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * 彼得林區合理價：合理本益比 = EPS 成長率(%) + 殖利率(%)。
 * PEGY 比 =（成長率 + 殖利率）÷ 本益比；林區認為 < 1 偏貴、≥ 2 很有吸引力。
 */
export function lynch(eps: number, pe: number, growthPct: number, yieldPct: number) {
  const fairPe = growthPct + yieldPct;
  return {
    fairPe,
    fairValue: eps > 0 && fairPe > 0 ? eps * fairPe : null,
    ratio: pe > 0 ? fairPe / pe : null,
    peg: pe > 0 && growthPct > 0 ? pe / growthPct : null,
  };
}

export function lynchVerdict(ratio: number | null) {
  if (ratio === null) return { text: "本益比或成長率為負，林區法不適用", tone: "" };
  if (ratio < 1) return { text: "偏貴：成長率加殖利率追不上本益比", tone: "negative" };
  if (ratio < 1.5) return { text: "大致合理", tone: "" };
  if (ratio < 2) return { text: "略為便宜", tone: "positive" };
  return { text: "很有吸引力（林區標準 ≥ 2）", tone: "positive" };
}
