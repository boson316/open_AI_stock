import type { Fact } from "./finance";
import { ttmAt } from "./intrinsic";

const days = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

/** 截至 end（±20 天）最近的期末值（資產負債表項目）。 */
export function instantAt(quarters: Fact[], metric: string, end: string) {
  const f = quarters
    .filter((x) => x.metric === metric && days(x.end, end) <= 20)
    .at(-1);
  return f ? f.value : null;
}

/** 單季（70–105 天）流量值。 */
function quarterAt(quarters: Fact[], metric: string, end: string) {
  const f = quarters
    .filter(
      (x) =>
        x.metric === metric &&
        x.start &&
        days(x.end, end) <= 20 &&
        days(x.start, x.end) + 1 >= 70 &&
        days(x.start, x.end) + 1 <= 105,
    )
    .at(-1);
  return f ? { value: f.value, days: days(f.start!, f.end) + 1 } : null;
}

const has = (quarters: Fact[], metric: string) =>
  quarters.some((f) => f.metric === metric);

/** 所有出現過某指標的期末日期（排序後）。 */
export function endsOf(quarters: Fact[], metrics: string[]) {
  return [
    ...new Set(
      quarters.filter((f) => metrics.includes(f.metric)).map((f) => f.end),
    ),
  ].sort();
}

export type DebtPoint = {
  date: string;
  shortTerm: number | null;
  currentLongTerm: number | null;
  longTerm: number | null;
  total: number | null;
  cash: number | null;
  equity: number | null;
};

/**
 * 長短期金融借款：短期借款（含商業本票）、一年內到期的長期負債、長期借款。
 * 某項公司從未申報時視為 0（多數公司沒有短期借款）；三項都沒有時整期留空。
 */
export function debtHistory(quarters: Fact[]): DebtPoint[] {
  const metrics = ["short_borrowings", "debt_current", "long_term_debt"];
  const reported = metrics.filter((m) => has(quarters, m));
  if (!reported.length) return [];
  return endsOf(quarters, metrics).map((date) => {
    // 短期借款還清後公司常不再列示，缺值視為 0；長期借款與一年內到期部分
    // 曾經申報、這期卻沒有時視為「不明」，不當成 0，避免低估負債。
    const get = (m: string) => {
      if (!reported.includes(m)) return 0;
      const v = instantAt(quarters, m, date);
      return v ?? (m === "short_borrowings" ? 0 : null);
    };
    const anyHere = metrics.some((m) => instantAt(quarters, m, date) !== null);
    const shortTerm = anyHere ? get("short_borrowings") : null;
    const currentLongTerm = anyHere ? get("debt_current") : null;
    const longTerm = anyHere ? get("long_term_debt") : null;
    const parts = [shortTerm, currentLongTerm, longTerm];
    return {
      date,
      shortTerm,
      currentLongTerm,
      longTerm,
      total: anyHere && parts.every((v) => v !== null) ? parts.reduce((a, v) => a! + v!, 0) : null,
      cash: instantAt(quarters, "cash", date),
      equity: instantAt(quarters, "equity", date),
    };
  });
}

export type CccPoint = {
  date: string;
  dso: number | null;
  dio: number | null;
  dpo: number | null;
  ccc: number | null;
};

/**
 * 現金週轉循環（天）= 應收帳款天數 + 存貨天數 − 應付帳款天數。
 * 以期末餘額 ÷ 當季營收（或營業成本）× 當季天數計算；
 * 公司從未申報存貨（軟體、網路業）時存貨天數視為 0。
 */
export function cccHistory(quarters: Fact[]): CccPoint[] {
  const noInventory = !has(quarters, "inventory");
  return endsOf(quarters, ["receivables", "payables"]).map((date) => {
    const rev = quarterAt(quarters, "revenue", date);
    const costDirect = quarterAt(quarters, "cost_revenue", date);
    const gp = quarterAt(quarters, "gross_profit", date);
    const cost =
      costDirect ??
      (rev && gp ? { value: rev.value - gp.value, days: rev.days } : null);
    const ar = instantAt(quarters, "receivables", date);
    const inv = instantAt(quarters, "inventory", date);
    const ap = instantAt(quarters, "payables", date);
    const ratio = (bal: number | null, flow: { value: number; days: number } | null) =>
      bal !== null && flow && flow.value > 0 ? (bal / flow.value) * flow.days : null;
    const dso = ratio(ar, rev);
    const dio = noInventory ? 0 : ratio(inv, cost);
    const dpo = ratio(ap, cost);
    return {
      date,
      dso,
      dio,
      dpo,
      ccc: dso !== null && dio !== null && dpo !== null ? dso + dio - dpo : null,
    };
  });
}

export type FTest = {
  key: string;
  group: "獲利能力" | "財務結構" | "經營效率";
  label: string;
  rule: string;
  pass: boolean | null;
  detail: string;
};

const fmtPct = (v: number | null) =>
  v === null || !Number.isFinite(v) ? "N/A" : `${(v * 100).toFixed(1)}%`;
const fmtX = (v: number | null) =>
  v === null || !Number.isFinite(v) ? "N/A" : v.toFixed(2);

/**
 * Piotroski F 分數：以「最近四季」與「再前四季」比較（期末 end 與一年前）。
 * 9 項各得 0 或 1 分；缺資料的項目不計分，另列可評分項目數。
 */
export function piotroski(quarters: Fact[], end: string) {
  const prior = new Date(Date.parse(end) - 365 * 86400000).toISOString().slice(0, 10);
  const prior2 = new Date(Date.parse(end) - 730 * 86400000).toISOString().slice(0, 10);
  const ttm = (m: string, e: string) => ttmAt(quarters, m, e);
  const at = (m: string, e: string) => instantAt(quarters, m, e);
  const div = (a: number | null, b: number | null) =>
    a === null || b === null || b === 0 ? null : a / b;
  const cmp = (a: number | null, b: number | null, better: "up" | "down") =>
    a === null || b === null ? null : better === "up" ? a > b : a < b;

  const ni = ttm("net_income", end),
    niP = ttm("net_income", prior);
  const ocf = ttm("ocf", end);
  const roa = div(ni, at("assets", prior)),
    roaP = div(niP, at("assets", prior2));
  // 從未申報長期借款時不給分（可能只是資料尚未收錄），列為缺資料。
  const lev = div(at("long_term_debt", end), at("assets", end));
  const levP = div(at("long_term_debt", prior), at("assets", prior));
  const cr = div(at("current_assets", end), at("current_liabilities", end));
  const crP = div(at("current_assets", prior), at("current_liabilities", prior));
  const sh = at("shares", end),
    shP = at("shares", prior);
  const rev = ttm("revenue", end),
    revP = ttm("revenue", prior);
  const gm = div(ttm("gross_profit", end), rev),
    gmP = div(ttm("gross_profit", prior), revP);
  const turn = div(rev, at("assets", prior)),
    turnP = div(revP, at("assets", prior2));

  const tests: FTest[] = [
    { key: "roa", group: "獲利能力", label: "資產報酬率為正", rule: "淨利 ÷ 期初總資產 > 0",
      pass: roa === null ? null : roa > 0, detail: `ROA ${fmtPct(roa)}` },
    { key: "cfo", group: "獲利能力", label: "營業現金流為正", rule: "近四季營業現金流 > 0",
      pass: ocf === null ? null : ocf > 0, detail: ocf === null ? "N/A" : ocf > 0 ? "為正" : "為負" },
    { key: "droa", group: "獲利能力", label: "資產報酬率提升", rule: "ROA 高於去年同期",
      pass: cmp(roa, roaP, "up"), detail: `${fmtPct(roaP)} → ${fmtPct(roa)}` },
    { key: "accrual", group: "獲利能力", label: "現金流大於淨利", rule: "營業現金流 > 淨利（獲利含金量）",
      pass: ocf === null || ni === null ? null : ocf > ni, detail: `現金流 ÷ 淨利 ${fmtX(div(ocf, ni))}` },
    { key: "lev", group: "財務結構", label: "長期負債比下降", rule: "長期借款 ÷ 總資產低於去年",
      pass: lev === null || levP === null ? null : lev < levP || (lev === 0 && levP === 0),
      detail: `${fmtPct(levP)} → ${fmtPct(lev)}` },
    { key: "cr", group: "財務結構", label: "流動比率提升", rule: "流動資產 ÷ 流動負債高於去年",
      pass: cmp(cr, crP, "up"), detail: `${fmtX(crP)} → ${fmtX(cr)}` },
    { key: "shares", group: "財務結構", label: "沒有增發股票", rule: "發行在外股數未增加",
      pass: sh === null || shP === null ? null : sh <= shP * 1.005,
      detail: sh === null || shP === null ? "N/A" : `股數變動 ${fmtPct(sh / shP - 1)}` },
    { key: "gm", group: "經營效率", label: "毛利率提升", rule: "近四季毛利率高於去年",
      pass: cmp(gm, gmP, "up"), detail: `${fmtPct(gmP)} → ${fmtPct(gm)}` },
    { key: "turn", group: "經營效率", label: "資產週轉率提升", rule: "營收 ÷ 期初總資產高於去年",
      pass: cmp(turn, turnP, "up"), detail: `${fmtX(turnP)} → ${fmtX(turn)}` },
  ];
  const scored = tests.filter((t) => t.pass !== null);
  return {
    end,
    tests,
    score: scored.filter((t) => t.pass).length,
    scorable: scored.length,
  };
}

/** 有營收 TTM 的每個季末都算一次，供歷史走勢圖。 */
export function piotroskiHistory(quarters: Fact[]) {
  return endsOf(quarters, ["revenue"])
    .map((end) => piotroski(quarters, end))
    .filter((r) => r.scorable >= 5);
}

export function fVerdict(score: number, scorable: number) {
  if (scorable < 9)
    return { text: `只有 ${scorable} 項可評分，總分僅供參考`, tone: "" };
  if (score >= 8) return { text: "財務體質強健（8–9 分）", tone: "positive" };
  if (score >= 5) return { text: "財務體質普通（5–7 分）", tone: "" };
  return { text: "財務體質偏弱（0–4 分）", tone: "negative" };
}

/** 兩階段股利折現：前 n 年成長 g1，之後永續成長 gt，以要求報酬率 r 折現。 */
export function ddm(d0: number, g1: number, gt: number, r: number, years = 5) {
  if (!(r > gt) || !(d0 > 0)) return null;
  let d = d0,
    stage = 0;
  for (let y = 1; y <= years; y++) {
    d *= 1 + g1;
    stage += d / (1 + r) ** y;
  }
  const terminal = (d * (1 + gt)) / (r - gt) / (1 + r) ** years;
  return { value: stage + terminal, stage, terminal };
}
