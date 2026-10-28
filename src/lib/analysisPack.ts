import { growth, labels, ttm } from "./finance";
import type { Dataset, Fact } from "./finance";

const COLUMNS = [
  "revenue",
  "gross_profit",
  "operating_income",
  "net_income",
  "eps",
  "ocf",
  "capex",
  "financing_cf",
  "sbc",
] as const;
const FINANCIAL_SECTORS = new Set(["fintech", "bank"]);

const PROMPT = [
  "你是謹慎的財報分析師。請只根據下方「資料」與「資料限制」回答，用繁體中文（台灣用語）。",
  "規則：",
  "1. 不使用資料以外的數字、新聞或記憶；資料沒有的欄位（N/A）請明說「資料不足」，不要推測或補零。",
  "2. 每個論點註明期間（例如 2026-06-30 該季）；比較請用表中已有的數字，不要自行重算複雜指標。",
  "3. 不提供買賣建議、目標價或股價預測；此資料包沒有股價，不要評論估值高低。",
  "4. 輸出格式：① 獲利能力 ② 成長 ③ 現金流品質（FCF、CapEx、SBC） ④ 主要風險與資料限制 ⑤ 後續需追蹤的 3 個問題。",
  "5. 最後列出你引用的期間與欄位，方便我核對。",
].join("\n");

const fmt = (v: number | null, digits = 1) =>
  v === null || !Number.isFinite(v)
    ? "N/A"
    : v.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
const millions = (v: number | null) => fmt(v === null ? null : v / 1e6);
const pct = (v: number | null) => (v === null ? "N/A" : `${fmt(v * 100)}%`);

function pick(quarters: Fact[], metric: string, end: string): Fact | null {
  return quarters.find((f) => f.metric === metric && f.end === end) ?? null;
}

function lastFour(quarters: Fact[], metric: string): Fact[] {
  return quarters
    .filter((f) => f.metric === metric && f.start)
    .sort((a, b) => a.end.localeCompare(b.end))
    .slice(-4);
}

/** 產生給外部 AI 的 Markdown 資料包；只用已發布且可追溯的季度資料，缺值維持 N/A。 */
export function buildAnalysisPack(
  dataset: Dataset,
  quarters: Fact[],
  generatedAt = new Date().toISOString(),
  includePrompt = true,
): string {
  const currency = dataset.currency ?? "USD";
  const symbol = currency === "TWD" ? "新臺幣" : "美元";
  const financial = FINANCIAL_SECTORS.has(dataset.sector);
  const dates = [
    ...new Set(
      quarters
        .filter((f) => (COLUMNS as readonly string[]).includes(f.metric))
        .map((f) => f.end),
    ),
  ]
    .sort()
    .slice(-20);
  const v = (m: string, d: string) => pick(quarters, m, d)?.value ?? null;
  const margin = (m: string, d: string) => {
    const n = v(m, d),
      r = v("revenue", d);
    return n === null || !r ? null : n / r;
  };
  const fcf = (d: string) => {
    const o = v("ocf", d),
      c = v("capex", d);
    return o === null || c === null ? null : o - Math.abs(c);
  };

  const header = [
    "日期",
    labels.revenue,
    labels.gross_profit,
    "毛利率",
    labels.operating_income,
    "營業利益率",
    labels.net_income,
    "淨利率",
    labels.eps,
    labels.ocf,
    labels.capex,
    "自由現金流(OCF−CapEx)",
    labels.sbc,
    labels.financing_cf,
  ];
  const rows = dates.map((d) => [
    d,
    millions(v("revenue", d)),
    financial ? "不適用" : millions(v("gross_profit", d)),
    financial ? "不適用" : pct(margin("gross_profit", d)),
    millions(v("operating_income", d)),
    pct(margin("operating_income", d)),
    millions(v("net_income", d)),
    pct(margin("net_income", d)),
    fmt(v("eps", d), 2),
    millions(v("ocf", d)),
    millions(v("capex", d) === null ? null : Math.abs(v("capex", d)!)),
    millions(fcf(d)),
    millions(v("sbc", d)),
    millions(v("financing_cf", d)),
  ]);

  const ttmOf = (m: string) => ttm(lastFour(quarters, m));
  const ttmRev = ttmOf("revenue"),
    ttmNi = ttmOf("net_income"),
    ttmOcf = ttmOf("ocf"),
    ttmCapex = ttmOf("capex"),
    ttmGp = ttmOf("gross_profit"),
    ttmOp = ttmOf("operating_income");
  const ttmFcf =
    ttmOcf === null || ttmCapex === null ? null : ttmOcf - Math.abs(ttmCapex);
  const ratio = (a: number | null, b: number | null) =>
    a === null || !b ? null : a / b;
  const yoyOf = (m: string) => {
    const latest = lastFour(quarters, m).at(-1);
    if (!latest) return null;
    const prior = quarters.find((f) => {
      const n = (Date.parse(latest.end) - Date.parse(f.end)) / 86400000;
      return f.metric === m && n >= 350 && n <= 380;
    });
    return prior ? growth(latest.value, prior.value) : null;
  };

  const derivedCounts = new Map<string, number>();
  for (const f of quarters)
    if (
      f.quality === "derived" &&
      dates.includes(f.end) &&
      (COLUMNS as readonly string[]).includes(f.metric)
    )
      derivedCounts.set(
        labels[f.metric],
        (derivedCounts.get(labels[f.metric]) ?? 0) + 1,
      );
  const derived = [...derivedCounts].map(([m, n]) => `${m} ${n} 季`);
  const sources = [
    ...new Set(
      quarters
        .filter(
          (f) =>
            ["revenue", "ocf", "net_income"].includes(f.metric) &&
            dates.slice(-4).includes(f.end),
        )
        .flatMap((f) => [f.source, ...(f.source_refs ?? [])]),
    ),
  ];
  const cashEnd = dates.filter((d) => v("ocf", d) !== null).at(-1);
  const incomeEnd = dates.filter((d) => v("revenue", d) !== null).at(-1);
  const limits = [
    ...new Set(dataset.warnings),
    ...(financial
      ? [`${dataset.ticker} 為金融公司，毛利率不適用，也不以營業利益替代。`]
      : []),
    ...(cashEnd !== incomeEnd
      ? [
          `現金流最新季度為 ${cashEnd ?? "N/A"}，損益最新季度為 ${incomeEnd ?? "N/A"}，兩者截止日不同。`,
        ]
      : []),
    "歷史季度保留當時可取得的申報口徑，未按最新年度修訂逐季重編；EPS 為各期官方披露值，不做全年減累計。",
    "此資料包不含股價，無法判斷估值高低。",
  ].filter((l, i, all) => all.indexOf(l) === i);

  const table = [header, ...rows].map((r) => `| ${r.join(" | ")} |`);
  table.splice(1, 0, `|${header.map(() => " --- ").join("|")}|`);
  return [
    `# ${dataset.name}（${dataset.ticker}）財務分析資料包`,
    "",
    `- 幣別／準則：${symbol}／${dataset.accounting_standard ?? "US GAAP"}`,
    `- 金額單位：百萬${symbol}；EPS 為${symbol}／股；毛利率等比率已計算好`,
    `- 損益最新季度：${incomeEnd ?? "N/A"}；現金流最新季度：${cashEnd ?? "N/A"}`,
    `- 資料產生時間：${generatedAt}；網站資料更新：${dataset.updated}`,
    "",
    ...(includePrompt ? ["## 給 AI 的指示", PROMPT, ""] : []),
    `## 資料（近 ${dates.length} 季，單季）`,
    ...table,
    "",
    "## 摘要（程式計算，非 AI 推算）",
    `- TTM 營收：${millions(ttmRev)}；TTM 淨利：${millions(ttmNi)}；TTM 自由現金流：${millions(ttmFcf)}`,
    `- TTM 毛利率：${financial ? "不適用" : pct(ratio(ttmGp, ttmRev))}；TTM 營業利益率：${pct(ratio(ttmOp, ttmRev))}；TTM 淨利率：${pct(ratio(ttmNi, ttmRev))}`,
    `- 最新季度年增率：營收 ${pct(yoyOf("revenue"))}；淨利 ${pct(yoyOf("net_income"))}；EPS ${pct(yoyOf("eps"))}`,
    "",
    "## 資料限制",
    ...limits.map((l) => `- ${l}`),
    ...(derived.length
      ? [
          "",
          "## 推算季度（近 20 季中由累計值相減而得，非直接披露；兩筆來源見網站「財報明細」）",
          derived.join("、"),
        ]
      : []),
    "",
    "## 主要來源（最近 4 季）",
    ...sources.map((s) => `- ${s}`),
    "",
  ].join("\n");
}

export function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/markdown;charset=utf-8;" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** 多檔合併：共用一段指示，每檔各自保留資料、限制與來源。 */
export function buildCombinedPack(
  packs: { dataset: Dataset; quarters: Fact[] }[],
  generatedAt = new Date().toISOString(),
): string {
  return [
    `# 股票財務分析資料包（${packs.length} 檔）`,
    "",
    `資料產生時間：${generatedAt}。每檔金額單位為百萬該檔幣別（TSM 為新臺幣，其餘為美元），不同幣別不可直接相加或比較金額，只可比較比率與成長率。`,
    "",
    "## 給 AI 的指示",
    PROMPT,
    "6. 若要跨公司比較，只比較毛利率、營業利益率、淨利率、年增率、FCF 占營收比等比率；不要比較不同幣別的金額，並先列出各公司資料限制。",
    "",
    ...packs.flatMap(({ dataset, quarters }) => [
      "---",
      "",
      buildAnalysisPack(dataset, quarters, generatedAt, false),
    ]),
  ].join("\n");
}
