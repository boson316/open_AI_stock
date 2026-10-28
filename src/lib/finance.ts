export type Fact = {
  metric: string;
  value: number;
  unit: string;
  start: string | null;
  end: string;
  filed: string;
  accession: string;
  tag: string;
  basis?: string | null;
  reporting_basis?: string | null;
  report_fiscal_year?: number | null;
  source_refs?: string[];
  source: string;
  form: string;
  quality: "reported" | "derived";
  lineage: string[];
};
export type Dataset = {
  version: 1;
  ticker: string;
  cik: string;
  name: string;
  sector: string;
  updated: string;
  source: string;
  facts: Fact[];
  warnings: string[];
  currency?: "USD" | "TWD";
  accounting_standard?: "US GAAP" | "IFRS";
  share_basis?: "ordinary";
  periods?: ("quarter" | "annual")[];
};
export type Company = {
  ticker: string;
  cik: string;
  name: string;
  exchange: string;
  sector: string;
  status: string;
  file: string | null;
  updated: string | null;
  coverage?: {
    quarters: number;
    first_end: string;
    last_end: string;
    core_complete: boolean;
  };
  currency?: "USD" | "TWD";
  periods?: ("quarter" | "annual")[];
};
export type Catalog = {
  version: number;
  companies: Company[];
  coverage: string[];
};
export type Price = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjustedClose: number | null;
  volume: number;
  source: string;
};
export const instant = new Set([
  "assets",
  "liabilities",
  "equity",
  "cash",
  "shares",
  "deposits",
  "allowance",
  "cet1",
  "members",
  "products",
]);
const equivalentTags: Record<string, string> = {
  "disclosure:sofi.revenue": "us-gaap:RevenuesNetOfInterestExpense",
  "disclosure:sofi.net_income": "us-gaap:NetIncomeLoss",
  "disclosure:sofi.eps": "us-gaap:EarningsPerShareDiluted",
  "disclosure:sofi.net_interest_income": "us-gaap:InterestIncomeExpenseNet",
};
const duration = (a: string, b: string) =>
  (Date.parse(b) - Date.parse(a)) / 86400000;
export const divide = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b <= 0 || !Number.isFinite(a / b) ? null : a / b;
export const growth = (a: number | null, b: number | null) => {
  const x = divide(a, b);
  return x === null ? null : x - 1;
};
export function cagr(
  start: number | null,
  end: number | null,
  startDate: string,
  endDate: string,
) {
  const years = duration(startDate, endDate) / 365.2425;
  return start === null ||
    end === null ||
    start <= 0 ||
    end <= 0 ||
    !Number.isFinite(years) ||
    years <= 0
    ? null
    : (end / start) ** (1 / years) - 1;
}
export function normalize(facts: Fact[], asOf = "9999-12-31"): Fact[] {
  const fs = facts.filter((f) => f.filed <= asOf);
  const groups = new Map<string, Fact[]>();
  const groupKey = (f: Fact) =>
    `${f.metric}|${f.tag}|${f.unit}|${f.start}|${f.accession}`;
  for (const f of fs) {
    const key = groupKey(f);
    const group = groups.get(key) ?? [];
    group.push(f);
    groups.set(key, group);
  }
  const selected = new Map<string, Fact>();
  const key = (f: Fact) => `${f.metric}|${f.end}|${f.unit}`;
  const newer = (a: Fact, b: Fact) =>
    `${a.filed}|${a.accession}` > `${b.filed}|${b.accession}`;
  for (const f of fs) {
    const days = f.start ? duration(f.start, f.end) + 1 : 0;
    if (instant.has(f.metric) || (days >= 70 && days <= 105)) {
      const old = selected.get(key(f));
      if (!old || newer(f, old)) selected.set(key(f), f);
    }
  }
  for (const f of fs) {
    const days = f.start ? duration(f.start, f.end) + 1 : 0;
    if (
      instant.has(f.metric) ||
      f.metric === "eps" ||
      f.metric === "nim" ||
      days < 150 ||
      days > 380
    )
      continue;
    const previous = groups
      .get(groupKey(f))!
      .filter(
        (p) =>
          p.metric === f.metric &&
          p.tag === f.tag &&
          p.unit === f.unit &&
          p.start === f.start &&
          p.accession === f.accession &&
          duration(p.end, f.end) >= 70 &&
          duration(p.end, f.end) <= 105,
      )
      .sort((a, b) => b.end.localeCompare(a.end))[0];
    const old = selected.get(key(f));
    if (!previous || (old && old.filed >= f.filed)) continue;
    selected.set(key(f), {
      ...f,
      start: new Date(Date.parse(previous.end) + 86400000)
        .toISOString()
        .slice(0, 10),
      value: f.value - previous.value,
      quality: "derived",
      lineage: [
        `${f.tag}|${f.accession}|${f.start}|${f.end}|${f.value}`,
        `minus ${previous.tag}|${previous.accession}|${previous.start}|${previous.end}|${previous.value}`,
      ],
    });
  }
  return [...selected.values()].sort((a, b) => a.end.localeCompare(b.end));
}
export function ttm(fs: Fact[]): number | null {
  if (fs.length !== 4 || fs.some((f) => !f.start)) return null;
  const sorted = [...fs].sort((a, b) => a.end.localeCompare(b.end));
  if (
    new Set(
      fs.map(
        (f) =>
          `${f.metric}|${f.unit}|${f.basis ?? equivalentTags[f.tag] ?? f.tag}`,
      ),
    ).size !== 1
  )
    return null;
  if (
    sorted.some(
      (f) =>
        duration(f.start!, f.end) + 1 < 70 ||
        duration(f.start!, f.end) + 1 > 105,
    )
  )
    return null;
  if (sorted.slice(1).some((f, i) => duration(sorted[i].end, f.start!) !== 1))
    return null;
  const days = duration(sorted[0].start!, sorted[3].end) + 1;
  return days >= 350 && days <= 380
    ? sorted.reduce((a, f) => a + f.value, 0)
    : null;
}
export function annual(facts: Fact[]): Fact[] {
  const map = new Map<string, Fact>();
  for (const f of facts) {
    const days = f.start ? duration(f.start, f.end) + 1 : 0;
    if (!instant.has(f.metric) && (days < 350 || days > 380)) continue;
    if (
      instant.has(f.metric) &&
      !f.form.startsWith("10-K") &&
      !f.form.startsWith("20-F")
    )
      continue;
    const key = `${f.metric}|${f.end}|${f.unit}`;
    const old = map.get(key);
    if (!old || `${f.filed}|${f.accession}` > `${old.filed}|${old.accession}`)
      map.set(key, f);
  }
  return [...map.values()].sort((a, b) => a.end.localeCompare(b.end));
}
export const last = (fs: Fact[], metric: string) =>
  fs.filter((f) => f.metric === metric).at(-1) ?? null;
export const sumTTM = (fs: Fact[], metric: string) =>
  ttm(fs.filter((f) => f.metric === metric).slice(-4));
export function yoy(fs: Fact[], metric: string): number | null {
  const rows = fs.filter((f) => f.metric === metric);
  const current = rows.at(-1);
  if (!current) return null;
  const previous = [...rows]
    .reverse()
    .find(
      (f) =>
        duration(f.end, current.end) >= 350 &&
        duration(f.end, current.end) <= 380,
    );
  return growth(current.value, previous?.value ?? null);
}
export function validateDataset(raw: unknown): Dataset {
  if (!raw || typeof raw !== "object") throw new Error("資料不是 JSON 物件");
  const d = raw as Dataset;
  if (
    d.version !== 1 ||
    !d.ticker ||
    !/^\d{10}$/.test(d.cik) ||
    !d.name ||
    (d.currency !== undefined && !["USD", "TWD"].includes(d.currency)) ||
    (d.periods !== undefined &&
      (!Array.isArray(d.periods) ||
        d.periods.length === 0 ||
        d.periods.some((p) => !["quarter", "annual"].includes(p)))) ||
    d.source !==
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${d.cik}.json` ||
    !Array.isArray(d.facts) ||
    !Array.isArray(d.warnings) ||
    !Number.isFinite(Date.parse(d.updated))
  )
    throw new Error("資料格式或版本不相容");
  for (const f of d.facts) {
    if (
      !f.metric ||
      !f.unit ||
      !f.tag ||
      !f.accession ||
      !Number.isFinite(f.value) ||
      !/^https:\/\/(www\.)?sec.gov\//.test(f.source) ||
      !Number.isFinite(Date.parse(f.end)) ||
      !Number.isFinite(Date.parse(f.filed)) ||
      f.filed < f.end ||
      (f.start && (!Number.isFinite(Date.parse(f.start)) || f.start > f.end)) ||
      !Array.isArray(f.lineage) ||
      !["reported", "derived"].includes(f.quality)
    )
      throw new Error("財報欄位未通過驗證");
  }
  return d;
}
export function parsePrices(csv: string, source: string): Price[] {
  if (!source.trim()) throw new Error("請填寫股價資料來源及授權說明");
  const lines = csv
    .trim()
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  if (lines[0] !== "Date,Open,High,Low,Close,AdjustedClose,Volume")
    throw new Error(
      "CSV 欄位須為 Date,Open,High,Low,Close,AdjustedClose,Volume",
    );
  const seen = new Set<string>();
  const result = lines.slice(1).map((line) => {
    const parts = line.split(",");
    const [date, o, h, l, c, a, v] = parts;
    const [open, high, low, close, volume] = [o, h, l, c, v].map(Number);
    const adjustedClose = a === "" ? null : Number(a);
    if (
      parts.length !== 7 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date ||
      seen.has(date) ||
      [o, h, l, c, v].some((x) => x === "") ||
      [open, high, low, close, volume].some(
        (x) => !Number.isFinite(x) || x < 0,
      ) ||
      (adjustedClose !== null &&
        (!Number.isFinite(adjustedClose) || adjustedClose <= 0)) ||
      close <= 0 ||
      high < Math.max(open, close, low) ||
      low > Math.min(open, close)
    )
      throw new Error("股價 CSV 存在無效、重複或不一致的資料");
    seen.add(date);
    return { date, open, high, low, close, adjustedClose, volume, source };
  });
  if (!result.length) throw new Error("CSV 沒有股價資料");
  return result.sort((a, b) => a.date.localeCompare(b.date));
}
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y),
    index = (a.length - 1) * q,
    low = Math.floor(index);
  return a[low] + (a[Math.ceil(index)] - a[low]) * (index - low);
}
export function river(facts: Fact[], prices: Price[]) {
  const observations: number[] = [];
  return prices.map((p) => {
    // Date-only filings: conservatively use from following day, never intraday.
    const asOf = new Date(Date.parse(p.date) - 86400000)
      .toISOString()
      .slice(0, 10);
    const eps = sumTTM(
      normalize(
        facts.filter((f) => f.metric === "eps" && f.unit === "USD/shares"),
        asOf,
      ),
      "eps",
    );
    const pe = p.close > 0 && eps !== null && eps > 0 ? p.close / eps : null;
    if (pe !== null) observations.push(pe);
    return {
      date: p.date,
      price: p.close,
      pe,
      eps,
      bands: [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => {
        const v = observations.length >= 20 ? quantile(observations, q) : null;
        return eps !== null && eps > 0 && v !== null ? eps * v : null;
      }),
    };
  });
}
export function csvDownload(name: string, rows: (string | number | null)[][]) {
  const body =
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map(
            (cell) =>
              '"' +
              String(cell ?? "")
                .replace(/"/g, '""')
                .replace(/^([=+@\t\r])/, "'$1") +
              '"',
          )
          .join(","),
      )
      .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([body], { type: "text/csv;charset=utf-8;" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export const format = (
  v: number | null | undefined,
  unit = "USD",
  currency = "USD",
) =>
  v == null || !Number.isFinite(v)
    ? "N/A"
    : unit === "%" || unit === "pure"
      ? `${(v * 100).toFixed(1)}%`
      : unit === "x"
        ? `${v.toFixed(1)}×`
        : unit.endsWith("/shares")
          ? `${currency === "TWD" ? "NT$" : "$"}${v.toFixed(2)}`
          : unit === "count"
            ? `${v.toLocaleString("zh-TW")} 人／項`
            : unit === "shares"
              ? `${(v / 1e6).toFixed(1)} 百萬股`
              : `${currency === "TWD" ? "NT$" : "$"}${(v / 1e6).toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 百萬`;
export const labels: Record<string, string> = {
  nim: "淨利差 NIM",
  cet1: "CET1（母公司）",
  members: "會員總數",
  products: "產品總數",
  revenue: "營業收入",
  gross_profit: "毛利",
  operating_income: "營業利益",
  net_income: "稅後淨利",
  eps: "稀釋 EPS",
  assets: "總資產",
  liabilities: "總負債",
  equity: "股東權益",
  cash: "現金及約當現金",
  ocf: "營業現金流",
  icf: "投資現金流",
  financing_cf: "融資現金流",
  capex: "資本支出",
  sbc: "股票基礎薪酬",
  shares: "發行在外股數",
  deposits: "存款總額",
  allowance: "信用損失備抵",
  net_interest_income: "淨利息收入",
};
