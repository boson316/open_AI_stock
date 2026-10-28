import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ChartNoAxesCombined,
  ChartCandlestick,
  ChevronDown,
  Download,
  Ellipsis,
  ExternalLink,
  LayoutDashboard,
  Star,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleHelp,
  Database,
  FileText,
  Layers3,
  Menu,
  Moon,
  Search,
  ShieldCheck,
  Sun,
  Upload,
  X,
} from "lucide-react";
import { RuleAnalysis } from "./components/RuleAnalysis";
import { FinancialChart } from "./components/FinancialChart";
import {
  annual,
  cagr,
  csvDownload,
  divide,
  format,
  growth,
  instant,
  labels,
  last,
  normalize,
  parsePrices,
  river,
  sumTTM,
  ttm,
  validateDataset,
  yoy,
} from "./lib/finance";
import type { Catalog, Dataset, Fact, Price } from "./lib/finance";

const sections = [
  { id: "overview", label: "研究總覽", icon: Layers3 },
  { id: "income", label: "損益與成長", icon: BarChart3 },
  { id: "cashflow", label: "現金流分析", icon: Activity },
  { id: "balance", label: "資產與負債", icon: Database },
  { id: "banking", label: "金融機構指標", icon: ShieldCheck },
  { id: "valuation", label: "估值研究", icon: Activity },
  { id: "statements", label: "完整財務報表", icon: FileText },
  { id: "sources", label: "資料與方法", icon: CircleHelp },
];
const financialGroups: Record<string, string[]> = {
  income: ["revenue", "gross_profit", "operating_income", "net_income", "eps"],
  cashflow: ["ocf", "icf", "financing_cf", "capex", "sbc"],
  balance: ["assets", "liabilities", "equity", "cash", "shares"],
  banking: [
    "deposits",
    "net_interest_income",
    "allowance",
    "nim",
    "cet1",
    "members",
    "products",
  ],
};
const missingBanking = [
  "個人貸款發放額",
  "學生貸款發放額",
  "淨沖銷率",
  "逾期放款比率",
  "貸存比",
  "有形帳面價值",
  "分部營收",
  "每會員產品數",
];
const companyFallback = {
  ticker: "SOFI",
  name: "SoFi Technologies",
  sector: "fintech",
  exchange: "NASDAQ",
  cik: "0001818874",
  currency: "USD" as const,
  coverage: undefined as
    | {
        quarters: number;
        first_end: string;
        last_end: string;
        core_complete: boolean;
      }
    | undefined,
};
const base = import.meta.env.BASE_URL;
type Mode = "quarter" | "annual" | "ttm";
type Transform = "value" | "yoy" | "qoq";
type Detail = { title: string; description: string; facts: Fact[] };
const isRatio = (metric: string) => metric === "nim" || metric === "cet1";
const metricScale = (metric: string, currencyScale: number) =>
  isRatio(metric)
    ? 0.01
    : ["eps", "shares", "members", "products"].includes(metric)
      ? 1
      : currencyScale;
const metricUnit = (
  metric: string,
  currencyUnit: string,
  shareUnit = "美元／股",
) =>
  isRatio(metric)
    ? "%"
    : metric === "eps"
      ? shareUnit
      : metric === "shares"
        ? "股"
        : ["members", "products"].includes(metric)
          ? "人／項"
          : currencyUnit;

export function App() {
  const [catalog, setCatalog] = useState<Catalog>({
    version: 1,
    companies: [],
    coverage: [],
  });
  const [ticker, setTicker] = useState("SOFI"),
    [dataset, setDataset] = useState<Dataset | null>(null);
  const [imported, setImported] = useState(false);
  const [query, setQuery] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [section, setSection] = useState("overview"),
    [mobile, setMobile] = useState(false);
  const [dark, setDark] = useState(
    () => localStorage.getItem("openstock-theme") === "dark",
  );
  const [mode, setMode] = useState<Mode>("quarter"),
    [years, setYears] = useState(5),
    [transform, setTransform] = useState<Transform>("value");
  const [detail, setDetail] = useState<Detail | null>(null),
    [unit, setUnit] = useState(1e6);
  const [prices, setPrices] = useState<Price[]>([]),
    [priceSource, setPriceSource] = useState(""),
    [priceImported, setPriceImported] = useState(""),
    [priceConsent, setPriceConsent] = useState(false),
    [log, setLog] = useState(false);
  const pageTop = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("openstock-favorites") ?? "null",
      );
      return Array.isArray(saved) && saved.every((t) => typeof t === "string")
        ? saved
        : ["SOFI", "TSM", "NVDA", "AAPL", "GOOGL", "MSFT"];
    } catch {
      return ["SOFI", "TSM", "NVDA", "AAPL", "GOOGL", "MSFT"];
    }
  });
  const [listFilter, setListFilter] = useState<"all" | "favorites">("all");
  const [graphFocus, setGraphFocus] = useState<
    "both" | "revenue" | "net_income"
  >("both");
  useEffect(() => {
    localStorage.setItem("openstock-favorites", JSON.stringify(favorites));
  }, [favorites]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInput.current?.focus();
        setSearchOpen(true);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setMobile(false);
        setDetail(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("openstock-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${base}data/catalog.json`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error("無法讀取股票目錄");
        return r.json();
      })
      .then((c: Catalog) => {
        if (c.version !== 1 || !Array.isArray(c.companies))
          throw Error("目錄格式無效");
        setCatalog(c);
      })
      .catch((e) => {
        if (e.name !== "AbortError")
          setError("無法載入資料目錄，請重試或匯入已驗證的財報 JSON。");
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const company = catalog.companies.find((c) => c.ticker === ticker);
    setPrices([]);
    setPriceImported("");
    setDataset(null);
    setImported(false);
    setLoading(true);
    if (!company?.file || company.status !== "available") {
      setLoading(false);
      return;
    }
    if (!/^[A-Z]+\.json$/.test(company.file)) {
      setError("資料檔案路徑無效");
      setLoading(false);
      return;
    }
    fetch(`${base}data/${company.file}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(validateDataset)
      .then((d) => {
        if (d.ticker !== ticker || d.cik !== company.cik)
          throw Error("公司資料不一致");
        setDataset(d);
        if (d.periods?.includes("quarter") === false) setMode("annual");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(`財報讀取失敗：${e.message}`);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [ticker, catalog]);
  const company =
    catalog.companies.find((c) => c.ticker === ticker) ?? companyFallback;
  const raw = dataset?.facts ?? [];
  const annualOnly = dataset?.periods?.includes("quarter") === false;
  const currency = dataset?.currency ?? company.currency ?? "USD";
  const currencyLabel = currency === "TWD" ? "新臺幣" : "美元";
  const shareUnit = currency === "TWD" ? "新臺幣／普通股" : "美元／股";
  const displayFormat = (v: number | null | undefined, unit = "USD") =>
    format(v, unit, currency);
  const isFinancial = company.sector === "fintech" || company.sector === "bank";
  const visibleGroups = Object.fromEntries(
    Object.entries(financialGroups).filter(
      ([key]) => key !== "banking" || isFinancial,
    ),
  );
  const quarters = useMemo(
    () =>
      annualOnly
        ? annual(dataset?.facts ?? [])
        : normalize(dataset?.facts ?? []),
    [dataset, annualOnly],
  );
  const view = useMemo(
    () => (mode === "annual" ? annual(raw) : quarters),
    [mode, raw, quarters],
  );
  const latestDate = quarters
    .map((f) => f.end)
    .sort()
    .at(-1);
  const cashDates = [
    ...new Set(quarters.filter((f) => f.metric === "ocf").map((f) => f.end)),
  ]
    .sort()
    .slice(-20);
  const cashComplete = cashDates.filter((d) =>
    financialGroups.cashflow.every((m) =>
      quarters.some((f) => f.metric === m && f.end === d),
    ),
  ).length;
  const chartLatest = section === "cashflow" ? cashDates.at(-1) : latestDate;
  const cutoff = chartLatest
    ? `${Number(chartLatest.slice(0, 4)) - years}${chartLatest.slice(4)}`
    : "";
  const dates = [
    ...new Set(
      view
        .filter(
          (f) =>
            (!f.start || f.start <= f.end) &&
            (section !== "cashflow" ||
              financialGroups.cashflow.includes(f.metric)),
        )
        .map((f) => f.end),
    ),
  ]
    .filter((d) => d >= cutoff)
    .sort()
    .slice(-(mode === "annual" ? years : years * 4));
  const unitLabel =
    unit === 1e6
      ? `百萬${currencyLabel}`
      : unit === 1e8
        ? `億${currencyLabel}`
        : currencyLabel;
  function aligned(metric: string, end: string) {
    return view.find((f) => f.metric === metric && f.end === end) ?? null;
  }
  function value(metric: string, end: string): number | null {
    const f = aligned(metric, end);
    if (!f) return null;
    if (mode !== "ttm" || instant.has(metric) || metric === "nim")
      return f.value;
    return ttm(
      quarters.filter((x) => x.metric === metric && x.end <= end).slice(-4),
    );
  }
  function chartValues(metric: string) {
    return dates.map((d) => {
      const current = value(metric, d);
      if (transform === "value")
        return current === null
          ? null
          : current /
              (metric === "eps" || metric === "members" || metric === "products"
                ? 1
                : unit);
      const previousEnd =
        transform === "qoq"
          ? dates[dates.indexOf(d) - 1]
          : [...dates].reverse().find((p) => {
              const days = (Date.parse(d) - Date.parse(p)) / 86400000;
              return days >= 350 && days <= 380;
            });
      const g = growth(
        current,
        previousEnd ? value(metric, previousEnd) : null,
      );
      if (transform === "qoq" && previousEnd) {
        const days = (Date.parse(d) - Date.parse(previousEnd)) / 86400000;
        if (
          mode === "annual" ? days < 350 || days > 380 : days < 70 || days > 105
        )
          return null;
      }
      return g === null ? null : g * 100;
    });
  }
  const chart = (title: string, metrics: string[], dualAxis = false) => (
    <FinancialChart
      title={title}
      dark={dark}
      dates={dates}
      series={metrics.map((m) => ({
        name: labels[m] ?? m,
        values: chartValues(m),
      }))}
      unit={
        transform === "value"
          ? metrics.length === 1 && metrics[0] === "eps"
            ? shareUnit
            : unitLabel
          : "%"
      }
      dualAxis={dualAxis && transform === "value"}
      secondaryUnit={shareUnit}
    />
  );
  const revenue = annualOnly
      ? (last(quarters, "revenue")?.value ?? null)
      : sumTTM(quarters, "revenue"),
    income = annualOnly
      ? (last(quarters, "net_income")?.value ?? null)
      : sumTTM(quarters, "net_income"),
    eps = annualOnly
      ? (last(quarters, "eps")?.value ?? null)
      : sumTTM(quarters, "eps");
  const endingEquity = last(quarters, "equity"),
    endingAssets = last(quarters, "assets");
  function returnOn(metric: string) {
    if (currency === "TWD") return null; // TIFRS earnings must not mix with IASB IFRS balance sheets.
    const end = last(quarters, metric);
    if (!end) return null;
    const prior = [...quarters]
      .reverse()
      .find(
        (f) =>
          f.metric === metric &&
          (Date.parse(end.end) - Date.parse(f.end)) / 86400000 >= 350 &&
          (Date.parse(end.end) - Date.parse(f.end)) / 86400000 <= 380,
      );
    const earnings = annualOnly
      ? (quarters.find((f) => f.metric === "net_income" && f.end === end.end)
          ?.value ?? null)
      : ttm(
          quarters
            .filter((f) => f.metric === "net_income" && f.end <= end.end)
            .slice(-4),
        );
    const earningsEnd = last(
      quarters.filter((f) => f.end <= end.end),
      "net_income",
    )?.end;
    return prior && earningsEnd === end.end
      ? divide(earnings, (end.value + prior.value) / 2)
      : null;
  }
  const lastPrice = prices.at(-1),
    prevPrice = prices.at(-2);
  const matchedLatest =
    currency === "USD" &&
    !annualOnly &&
    !!lastPrice &&
    !!latestDate &&
    lastPrice.date >= latestDate &&
    (Date.parse(lastPrice.date) - Date.parse(latestDate)) / 86400000 <= 180;
  const peValue =
    matchedLatest && eps !== null && eps > 0
      ? divide(lastPrice!.close, eps)
      : null;
  const equityForPB =
    endingEquity &&
    endingEquity.filed < (lastPrice?.date ?? "") &&
    lastPrice &&
    (Date.parse(lastPrice.date) - Date.parse(endingEquity.end)) / 86400000 <=
      180
      ? endingEquity
      : null;
  const sharesForPB = last(quarters, "shares");
  const pb =
    matchedLatest &&
    equityForPB &&
    sharesForPB?.end === equityForPB.end &&
    sharesForPB.filed < lastPrice!.date
      ? divide(lastPrice!.close, divide(equityForPB.value, sharesForPB.value))
      : null;
  const kpis = [
    {
      title: annualOnly ? "年度營業收入" : "TTM 營業收入",
      value: revenue,
      unit: "USD",
      metric: "revenue",
      desc: annualOnly
        ? "官方完整會計年度營收，不推估季度。"
        : "四個連續且相容的單季營收之和；缺任一季不計算。",
    },
    {
      title: "營收年增率",
      value: yoy(quarters, "revenue"),
      unit: "%",
      metric: "revenue",
      desc: annualOnly
        ? "本年度營收 ÷ 上年度營收 − 1；上年度非正數時 N/A。"
        : "本季營收 ÷ 去年同期營收 − 1；去年值非正數時 N/A。",
    },
    {
      title: annualOnly ? "年度稀釋 EPS（普通股）" : "稀釋 EPS · TTM",
      value: eps,
      unit: "USD/shares",
      metric: "eps",
      desc: annualOnly
        ? "官方 IFRS 年度稀釋 EPS，單位為新臺幣／普通股，不等同美國 ADR EPS。"
        : "四個已公布單季稀釋 EPS 合計（依公司 US GAAP 或 IFRS）。不從累積 EPS 相減，股數變動時不等同全年加權 EPS。",
    },
    {
      title: "EPS 年增率",
      value: yoy(quarters, "eps"),
      unit: "%",
      metric: "eps",
      desc: annualOnly
        ? "本年度 IFRS 普通股稀釋 EPS ÷ 上年度 EPS − 1。"
        : "本季 GAAP 稀釋 EPS ÷ 去年同期 EPS − 1；去年值非正數時 N/A。",
    },
    {
      title: annualOnly ? "年度稅後淨利" : "TTM 稅後淨利",
      value: income,
      unit: "USD",
      metric: "net_income",
      desc: annualOnly
        ? "官方完整會計年度歸屬母公司淨利。"
        : "四個連續單季稅後淨利合計。",
    },
    {
      title: "股東權益報酬率",
      value: returnOn("equity"),
      unit: "%",
      metric: "equity",
      desc: "同期間 TTM 淨利 ÷ 期初與期末股東權益平均。",
    },
    {
      title: "資產報酬率",
      value: returnOn("assets"),
      unit: "%",
      metric: "assets",
      desc: "同期間 TTM 淨利 ÷ 期初與期末總資產平均。",
    },
    {
      title: "本益比 P/E",
      value: peValue,
      unit: "x",
      metric: "eps",
      desc: "匯入收盤價 ÷ 正的 TTM GAAP 稀釋 EPS。此卡僅在價格晚於全部所用申報日時顯示。",
    },
    {
      title: "股價淨值比 P/B",
      value: pb,
      unit: "x",
      metric: "equity",
      desc: "收盤價 ÷（同日資產負債表權益 ÷ 發行在外股數），缺相容期間顯示 N/A。",
    },
    {
      title: "淨利差 NIM",
      value: last(quarters, "nim")?.value ?? null,
      unit: "%",
      metric: "nim",
      desc: "平均生息資產與淨利息收入之比。採官方季度平均餘額表揭露的淨利差，不使用期末資產推算。",
    },
    {
      title: "CET1 資本適足率",
      value: last(quarters, "cet1")?.value ?? null,
      unit: "%",
      metric: "cet1",
      desc: "普通股權益第一類資本 ÷ 風險加權資產；此卡明確採 SoFi Technologies 母公司，不能與銀行子公司混用。",
    },
    {
      title: "會員總數",
      value: last(quarters, "members")?.value ?? null,
      unit: "count",
      metric: "members",
      desc: "僅接受官方營運指標揭露；Company Facts 不一定包含。",
    },
  ];
  // Prevent price/earnings mismatch with publication date, including restatements.
  if (
    lastPrice &&
    quarters
      .filter((f) => f.metric === "eps")
      .slice(-4)
      .some((f) => f.filed >= lastPrice.date)
  )
    kpis[7].value = null;
  const annualRevenue = annual(raw).filter((f) => f.metric === "revenue");
  const lastAnnual = annualRevenue.at(-1);
  const revenueCagr = (years: number) => {
    if (!lastAnnual) return null;
    const prior = annualRevenue.find(
      (f) =>
        Math.abs(
          (Date.parse(lastAnnual.end) - Date.parse(f.end)) /
            365.2425 /
            86400000 -
            years,
        ) < 0.03,
    );
    return prior
      ? cagr(prior.value, lastAnnual.value, prior.end, lastAnnual.end)
      : null;
  };
  const revenueGrowth = yoy(quarters, "revenue");
  const summary =
    revenueGrowth === null
      ? "尚無足夠且可比較的財報資料，暫不產生營收趨勢結論。"
      : `${annualOnly ? "本年度營收較上年度" : "本季營收較去年同期"}${revenueGrowth >= 0 ? "增加" : "減少"} ${Math.abs(revenueGrowth * 100).toFixed(1)}%。此變化需要查閱財報附註確認原因。`;
  const riverRows = useMemo(
    () => river(currency === "USD" && !annualOnly ? raw : [], prices),
    [raw, prices, currency, annualOnly],
  );
  const riverDates = riverRows.filter(
    (r) =>
      !prices.at(-1) ||
      r.date >=
        `${Number(prices.at(-1)!.date.slice(0, 4)) - years}${prices.at(-1)!.date.slice(4)}`,
  );
  const results = [
    ...catalog.companies.map((c) => ({
      ticker: c.ticker,
      name: c.name,
      available: c.status === "available",
    })),
    ...catalog.coverage
      .filter((t) => !catalog.companies.some((c) => c.ticker === t))
      .map((t) => ({ ticker: t, name: "尚未收錄財報", available: false })),
  ].filter((c) =>
    `${c.ticker} ${c.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  async function importDataset(file?: File) {
    if (!file) return;
    try {
      const d = validateDataset(JSON.parse(await file.text()));
      if (
        d.ticker !== ticker ||
        d.cik !== catalog.companies.find((c) => c.ticker === ticker)?.cik
      )
        throw Error("請匯入目前所選公司的資料");
      setDataset(d);
      if (d.periods?.includes("quarter") === false) setMode("annual");
      setImported(true);
      setError("");
    } catch (e) {
      setError(`匯入失敗：${(e as Error).message}`);
    }
  }
  async function importPrice(file?: File) {
    if (!file) return;
    try {
      if (!priceConsent) throw Error("請先確認你有權使用這份股價資料");
      const parsed = parsePrices(await file.text(), priceSource);
      setPrices(parsed);
      setPriceImported(new Date().toISOString());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const tableMetrics = Object.values(visibleGroups).flat();
  function exportTable() {
    csvDownload(`${ticker}-${mode}.csv`, [
      ["指標", "單位", ...dates],
      ...tableMetrics.map((m) => [
        labels[m],
        metricUnit(m, unitLabel, shareUnit),
        ...dates.map((d) => {
          const v = value(m, d);
          return v === null ? null : v / metricScale(m, unit);
        }),
      ]),
    ]);
  }
  const availableSections = sections.filter(
    (s) => s.id !== "banking" || isFinancial,
  );
  const navLabels: Record<string, string> = {
    overview: "總覽",
    income: "損益成長",
    cashflow: "現金流",
    balance: "資產負債",
    banking: "銀行指標",
    valuation: "估值",
    statements: "財報明細",
    sources: "資料來源",
  };
  const stockColors: Record<string, string> = {
    SOFI: "#00a8b5",
    TSM: "#da5144",
    NVDA: "#6a9a2b",
    AAPL: "#687789",
    MSFT: "#3878e5",
    GOOGL: "#487ce4",
    GOOG: "#487ce4",
    AMD: "#d55353",
    AMZN: "#c78b2c",
    META: "#397de3",
    PLTR: "#687789",
    MU: "#715bc6",
    TSLA: "#d84e50",
  };
  const color = stockColors[ticker] ?? "#5376e5";
  const shortMoney = (n: number | null | undefined) =>
    n == null
      ? "N/A"
      : `${currency === "TWD" ? "NT$" : "$"}${Math.abs(n) >= 1e8 ? (n / 1e8).toLocaleString("zh-TW", { maximumFractionDigits: 2 }) + " 億" : (n / 1e6).toLocaleString("zh-TW", { maximumFractionDigits: 1 }) + " 百萬"}`;
  function navigate(id: string) {
    setSection(id);
    setMobile(false);
    window.history.replaceState(null, "", `#${id}`);
    pageTop.current?.scrollIntoView?.({ block: "start" });
  }
  function selectCompany(selected: string) {
    const found = catalog.companies.find((c) => c.ticker === selected);
    if (found?.status !== "available" && selected !== "SOFI") {
      setError(`${selected} 尚未收錄。請先完成官方資料更新。`);
      setSearchOpen(false);
      return;
    }
    setTicker(selected);
    setError("");
    setQuery("");
    setSearchOpen(false);
    setMobile(false);
    if (found?.periods?.includes("quarter") === false) setMode("annual");
    if (
      section === "banking" &&
      !["bank", "fintech"].includes(found?.sector ?? "")
    )
      navigate("income");
  }
  function toggleFavorite(selected: string) {
    setFavorites((previous) =>
      previous.includes(selected)
        ? previous.filter((t) => t !== selected)
        : [...previous, selected],
    );
  }
  function openMetric(k: (typeof kpis)[number]) {
    setDetail({
      title: k.title,
      description: k.desc,
      facts: quarters.filter((f) => f.metric === k.metric).slice(-8),
    });
  }
  function metricCard(k: (typeof kpis)[number]) {
    return (
      <button
        className="metric-card"
        key={k.title}
        onClick={() => openMetric(k)}
      >
        <span className="metric-card-label">
          {k.title}
          <ArrowUpRight size={15} />
        </span>
        <strong>
          {k.unit === "USD"
            ? shortMoney(k.value)
            : displayFormat(k.value, k.unit)}
        </strong>
        <span className="metric-card-foot">
          <span>{last(quarters, k.metric)?.end ?? "尚無可用期間"}</span>
          <span>{k.value === null ? "尚無資料" : "查看明細"}</span>
        </span>
      </button>
    );
  }
  const primaryMetrics = [kpis[0], kpis[1], kpis[2], kpis[4]];
  const snapshotMetrics = isFinancial
    ? [kpis[5], kpis[6], kpis[9], kpis[10]]
    : [kpis[5], kpis[6], kpis[7], kpis[8]];
  const remainingMetrics = kpis.filter(
    (k) =>
      !primaryMetrics.includes(k) &&
      !snapshotMetrics.includes(k) &&
      (isFinancial || !["nim", "cet1", "members"].includes(k.metric)),
  );
  const watchlist = catalog.companies.filter(
    (c) => listFilter === "all" || favorites.includes(c.ticker),
  );
  const focusMetric = graphFocus === "net_income" ? "net_income" : "revenue";
  const overviewValue = dates.at(-1) ? value(focusMetric, dates.at(-1)!) : null;
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="drawer-overlay"
          aria-label="關閉選單"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a
          className="brand"
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-icon">
            <ChartNoAxesCombined size={22} />
          </span>
          <span>
            OpenStock<small>YOUR RESEARCH SPACE</small>
          </span>
        </a>
        <button
          className="drawer-close"
          aria-label="關閉導覽"
          onClick={() => setMobile(false)}
        >
          <X size={20} />
        </button>
        <div className="workspace-label">
          <span className="workspace-dot" />
          個人研究工作台
          <ChevronDown size={14} />
        </div>
        <nav className="side-navigation" aria-label="研究導覽">
          {availableSections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={section === s.id ? "active" : ""}
              aria-current={section === s.id ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(s.id);
              }}
            >
              <s.icon size={18} />
              <span>{s.label}</span>
              {section === s.id && <span className="nav-active-dot" />}
            </a>
          ))}
        </nav>
        <div className="watchlist-heading">
          <span>觀察清單</span>
          <span className="count-badge">{catalog.companies.length}</span>
        </div>
        <div
          className="watchlist-filter"
          role="group"
          aria-label="觀察清單篩選"
        >
          <button
            className={listFilter === "all" ? "selected" : ""}
            onClick={() => setListFilter("all")}
          >
            全部股票
          </button>
          <button
            className={listFilter === "favorites" ? "selected" : ""}
            onClick={() => setListFilter("favorites")}
          >
            <Star size={12} />
            已收藏
          </button>
        </div>
        <div className="watchlist">
          {watchlist.map((c) => (
            <button
              className={`watchlist-stock ${ticker === c.ticker ? "selected" : ""}`}
              key={c.ticker}
              onClick={() => selectCompany(c.ticker)}
              aria-label={`切換至 ${c.ticker}`}
            >
              <span
                className="stock-avatar"
                style={{
                  color: stockColors[c.ticker] ?? "#5376e5",
                  background: (stockColors[c.ticker] ?? "#5376e5") + "18",
                }}
              >
                {c.ticker.slice(0, 2)}
              </span>
              <span className="watchlist-name">
                <strong>{c.ticker}</strong>
                <small>{c.name}</small>
              </span>
              {favorites.includes(c.ticker) ? (
                <Star
                  size={12}
                  className="favorite-indicator"
                  fill="currentColor"
                />
              ) : (
                <span className="watchlist-currency">
                  {c.currency ?? "USD"}
                </span>
              )}
            </button>
          ))}
          {!watchlist.length && (
            <p className="watchlist-empty">
              點選股票名稱旁的星號，加入你的觀察清單。
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="source-badge">
            <ShieldCheck size={17} />
            <div>
              <strong>從官方資料出發</strong>
              <small>來源透明，每一季都可追溯</small>
            </div>
          </div>
          <a
            href="https://github.com/boson316/open_AI_stock"
            target="_blank"
            rel="noreferrer"
          >
            開放原始碼
            <ArrowUpRight size={13} />
          </a>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-location">
            <button
              className="mobile-toggle"
              aria-label="開啟選單"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={21} />
            </button>
            <span className="desktop-location">
              股票研究
              <ChevronRight size={14} />
              <strong>{navLabels[section]}</strong>
            </span>
            <span className="mobile-brand">
              <ChartNoAxesCombined size={22} />
            </span>
          </div>
          <div className={`search-wrap ${searchOpen ? "focused" : ""}`}>
            <Search size={18} />
            <input
              ref={searchInput}
              aria-label="搜尋股票"
              placeholder="搜尋股票代號或公司名稱"
              value={query}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSearchOpen(false);
                if (e.key === "Enter") {
                  const result =
                    results.find((c) => c.ticker === query.toUpperCase()) ??
                    results.find((c) => c.available);
                  if (result) selectCompany(result.ticker);
                }
              }}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
            />
            <kbd>⌘ K</kbd>
            {searchOpen && (
              <div className="search-results">
                <div className="search-results-heading">
                  <span>{query ? "搜尋結果" : "快速切換股票"}</span>
                  <button
                    className="close-search"
                    aria-label="關閉搜尋"
                    onClick={() => setSearchOpen(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
                {results.length ? (
                  results.map((c) => (
                    <button
                      key={c.ticker}
                      onClick={() => selectCompany(c.ticker)}
                    >
                      <span
                        className="stock-avatar"
                        style={{ color: stockColors[c.ticker] ?? "#5376e5" }}
                      >
                        {c.ticker.slice(0, 2)}
                      </span>
                      <strong>{c.ticker}</strong>
                      <span>{c.name}</span>
                      <small>{c.available ? "可用" : "尚未收錄"}</small>
                    </button>
                  ))
                ) : (
                  <p>尚未收錄這個代號，請試試其他股票。</p>
                )}
              </div>
            )}
          </div>
          <div className="header-tools">
            <span className="live-data-label">
              <span />
              官方財報資料
            </span>
            <button
              className="icon-button theme-toggle"
              aria-label="切換深色模式"
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <details className="app-actions">
              <summary aria-label="資料操作">
                <Ellipsis size={20} />
              </summary>
              <div className="action-menu">
                <label>
                  <Upload size={16} />
                  匯入財報 JSON
                  <input
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={(e) => {
                      void importDataset(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                <button onClick={exportTable}>
                  <Download size={16} />
                  匯出財務資料
                </button>
                <button onClick={() => navigate("sources")}>
                  <ShieldCheck size={16} />
                  資料來源與核對報告
                </button>
              </div>
            </details>
          </div>
        </header>
        {searchOpen && (
          <button
            className="search-dismiss"
            aria-label="收起搜尋結果"
            onClick={() => setSearchOpen(false)}
          />
        )}
        <main ref={pageTop}>
          <section className="company-overview">
            <div className="company-intro">
              <div
                className="company-monogram"
                style={{ background: color + "16", color }}
              >
                {ticker.slice(0, 2)}
              </div>
              <div>
                <div className="company-title">
                  <h1>{company.name}</h1>
                  <button
                    className={`favorite-button ${favorites.includes(ticker) ? "selected" : ""}`}
                    aria-label={`${favorites.includes(ticker) ? "取消收藏" : "收藏"} ${ticker}`}
                    aria-pressed={favorites.includes(ticker)}
                    onClick={() => toggleFavorite(ticker)}
                  >
                    <Star
                      size={18}
                      fill={
                        favorites.includes(ticker) ? "currentColor" : "none"
                      }
                    />
                  </button>
                </div>
                <div className="company-meta">
                  <span className="ticker-pill">{ticker}</span>
                  <span>{company.exchange}</span>
                  <span className="meta-dot" />
                  <span>
                    {company.sector === "fintech"
                      ? "金融科技"
                      : company.sector === "semiconductor"
                        ? "半導體"
                        : company.sector === "automotive"
                          ? "汽車與能源"
                          : "科技"}
                  </span>
                  <span className="meta-dot" />
                  <span>
                    {currencyLabel} {currency}
                  </span>
                  <a
                    aria-label="官方 Company Facts"
                    href={
                      dataset?.source ??
                      `https://data.sec.gov/api/xbrl/companyfacts/CIK${company.cik}.json`
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={13} />
                    <span>官方來源</span>
                  </a>
                </div>
              </div>
            </div>
            <div className="company-right">
              <div className="data-status">
                <span className={`status ${dataset ? "ok" : ""}`}>
                  <span />
                  {loading
                    ? "載入中"
                    : dataset
                      ? imported
                        ? "使用者匯入財報"
                        : "已載入 SEC 財報"
                      : "等待官方財報"}
                </span>
                <p>財報截至 {latestDate ?? "N/A"}</p>
                {!imported && company.coverage?.core_complete && (
                  <p>近 {company.coverage.quarters} 季核心資料已核對</p>
                )}
              </div>
              <button
                className="button secondary export-main"
                aria-label="匯出財務資料"
                onClick={exportTable}
              >
                <Download size={15} />
                <span>匯出財務資料</span>
              </button>
            </div>
          </section>
          <nav className="page-tabs" aria-label="分析分頁" role="tablist">
            {availableSections.map((s) => (
              <button
                role="tab"
                key={s.id}
                aria-label={s.label}
                aria-selected={section === s.id}
                className={section === s.id ? "active" : ""}
                onClick={() => navigate(s.id)}
              >
                {navLabels[s.id]}
              </button>
            ))}
          </nav>
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button aria-label="關閉錯誤" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {imported && (
            <div className="notice">
              這是使用者匯入的財報資料，僅通過格式檢查，尚未向 SEC
              核實內容。請逐項核對官方申報來源。
            </div>
          )}
          {!dataset && !loading && (
            <div className="notice empty-state">
              <Database size={20} />
              <div>
                <strong>資料尚未收錄，研究介面已就緒</strong>
                <p>
                  尚無可驗證的財報資料。你可以從右上角「資料操作」匯入管線產生的財報
                  JSON；缺值一律保留 N/A。
                </p>
              </div>
            </div>
          )}
          {currency === "TWD" && (
            <details className="basis-notice">
              <summary>
                <CircleHelp size={14} />
                新臺幣財報 · TIFRS／IFRS 口徑說明
                <ChevronDown size={14} />
              </summary>
              <p>
                TSM 季度公告與現金流採 TIFRS，年度損益採 IFRS
                (IASB)，以新臺幣與普通股口徑顯示；部分淨利／EPS
                不可合併，ROE／ROA 暫不混算。美元 ADR 股價未與財報換算，PE／PB
                保留 N/A。請注意財報截至日期。
              </p>
            </details>
          )}
          {section !== "sources" && section !== "banking" && (
            <div className="screen-controls">
              <div className="analysis-toolbar">
                <div className="tabs" role="group" aria-label="報告期間">
                  {(
                    [
                      ["quarter", "季度"],
                      ["annual", "年度"],
                      ["ttm", "TTM"],
                    ] as const
                  ).map(([v, l]) => (
                    <button
                      disabled={annualOnly && v !== "annual"}
                      aria-pressed={mode === v}
                      className={mode === v ? "selected" : ""}
                      key={v}
                      onClick={() => setMode(v)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <div className="toolbar-filters">
                  <select
                    aria-label="數值模式"
                    value={transform}
                    onChange={(e) => setTransform(e.target.value as Transform)}
                  >
                    <option value="value">原始數值</option>
                    <option value="yoy">年增率 YoY</option>
                    <option value="qoq">前期增率（季度為 QoQ）</option>
                  </select>
                  <select
                    aria-label="時間範圍"
                    value={years}
                    onChange={(e) => setYears(Number(e.target.value))}
                  >
                    {[1, 2, 3, 5, 10, 100].map((y) => (
                      <option key={y} value={y}>
                        {y === 100 ? "全部期間" : `近 ${y} 年`}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="顯示單位"
                    value={unit}
                    onChange={(e) => setUnit(Number(e.target.value))}
                  >
                    <option value={1e6}>百萬{currencyLabel}</option>
                    <option value={1e8}>億{currencyLabel}</option>
                    <option value={1}>{currencyLabel}</option>
                  </select>
                </div>
              </div>
            </div>
          )}
          <div className="screen-content" key={section}>
            {section === "overview" && (
              <>
                <div className="section-heading">
                  <div>
                    <h2>財務總覽</h2>
                    <p>從企業的基本面，找到值得追蹤的變化。</p>
                  </div>
                  <span className="subtle-label">
                    TTM · 滾動十二個月
                    <CircleHelp size={13} />
                  </span>
                </div>
                <div className="dashboard-kpis">
                  {primaryMetrics.map(metricCard)}
                </div>
                <div className="overview-grid">
                  <div className="trend-panel panel">
                    <div className="trend-heading">
                      <div>
                        <span className="muted small">
                          {mode === "annual"
                            ? "最新年度"
                            : mode === "ttm"
                              ? "最新 TTM"
                              : "最新單季"}
                          {focusMetric === "net_income" ? "淨利" : "營收"}
                        </span>
                        <strong>{shortMoney(overviewValue)}</strong>
                        <span className="trend-period">
                          {dates.at(-1) ?? "尚無可用期間"} · {currency}
                        </span>
                      </div>
                      <div
                        className="chart-focus"
                        role="group"
                        aria-label="趨勢指標"
                      >
                        {(
                          [
                            ["both", "營收與淨利"],
                            ["revenue", "營收"],
                            ["net_income", "淨利"],
                          ] as const
                        ).map(([id, label]) => (
                          <button
                            aria-pressed={graphFocus === id}
                            key={id}
                            className={graphFocus === id ? "selected" : ""}
                            onClick={() => setGraphFocus(id)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <FinancialChart
                      title="營收與淨利"
                      dark={dark}
                      height={340}
                      dates={dates}
                      initialType="area"
                      unit={transform === "value" ? unitLabel : "%"}
                      series={(graphFocus === "both"
                        ? ["revenue", "net_income"]
                        : [graphFocus]
                      ).map((m) => ({
                        name: labels[m],
                        values: chartValues(m),
                      }))}
                    />
                    <div className="chart-provenance">
                      <span>
                        <span className="source-dot" />
                        官方申報 · 實際財季
                      </span>
                      <button onClick={() => navigate("income")}>
                        深入損益分析
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                  <aside className="overview-aside">
                    <section className="panel snapshot-panel">
                      <div className="compact-panel-heading">
                        <h3>財務快照</h3>
                        <span>最新可得期間</span>
                      </div>
                      {snapshotMetrics.map((k) => (
                        <button
                          className="snapshot-row"
                          key={k.title}
                          onClick={() => openMetric(k)}
                        >
                          <span>
                            {k.title}
                            <small>
                              {last(quarters, k.metric)?.end ?? "期間 N/A"}
                            </small>
                          </span>
                          <strong>
                            {displayFormat(k.value, k.unit)}
                            <ChevronRight size={14} />
                          </strong>
                        </button>
                      ))}
                    </section>
                    <section className="panel coverage-panel">
                      <div className="coverage-icon">
                        <ShieldCheck size={20} />
                      </div>
                      <div>
                        <h3>讓每個數字有據可查</h3>
                        <p>
                          {company.coverage?.core_complete && !imported
                            ? `${company.coverage.quarters} 個連續財季，核心資料已核對。`
                            : "尚無已驗證的完整覆蓋紀錄。"}
                          <br />
                          點選指標，即可查閱原始申報。
                        </p>
                      </div>
                      <button onClick={() => navigate("sources")}>
                        查看資料與方法
                        <ArrowUpRight size={14} />
                      </button>
                    </section>
                  </aside>
                </div>
                <section className="panel insight-panel">
                  <span className="insight-mark">
                    <Activity size={20} />
                  </span>
                  <div>
                    <div className="insight-title">
                      <h3>本季財報觀察</h3>
                      <span className="tag">依據實際數據</span>
                    </div>
                    <p>{summary}</p>
                  </div>
                  <button
                    aria-label="查看完整財報分析"
                    onClick={() => navigate("income")}
                  >
                    <ArrowUpRight size={20} />
                  </button>
                </section>
                <details className="panel all-metrics">
                  <summary>
                    更多財務指標
                    <span>
                      {remainingMetrics.length} 項<ChevronDown size={16} />
                    </span>
                  </summary>
                  <div className="additional-metrics">
                    {remainingMetrics.map(metricCard)}
                  </div>
                </details>
                <section className="price-callout">
                  <div>
                    <ChartCandlestick size={20} />
                    <span>
                      {lastPrice
                        ? `${ticker} 匯入收盤價 $${lastPrice.close.toFixed(2)} · ${lastPrice.date}`
                        : "想一起研究價格與估值？"}
                      <small>
                        {lastPrice && prevPrice
                          ? `相鄰匯入交易日 ${displayFormat(growth(lastPrice.close, prevPrice.close), "%")}`
                          : "匯入你有權使用的股價 CSV，查看歷史本益比與估值河流圖。"}
                      </small>
                    </span>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => navigate("valuation")}
                  >
                    {lastPrice ? "開啟估值研究" : "匯入行情"}
                    <ArrowRight size={14} />
                  </button>
                </section>
              </>
            )}
            {section === "income" && (
              <>
                <section id="income">
                  <SectionTitle
                    eyebrow="EARNINGS & GROWTH"
                    title="損益與成長分析"
                  />
                  <div className="chart-grid">
                    {chart("營收與淨利", ["revenue", "net_income"])}
                    {chart(
                      "營業利益與每股盈餘",
                      ["operating_income", "eps"],
                      true,
                    )}
                  </div>
                  {isFinancial && (
                    <div className="notice" data-testid="gross-margin-na">
                      <CircleHelp size={18} />
                      <div>
                        <strong>毛利率不適用</strong>
                        <p>
                          {ticker}{" "}
                          為金融科技公司，淨營收為利息與非利息收入的合計，沒有商品銷貨成本，故不顯示毛利率；亦不以營業利益替代。
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="chart-grid">
                    <RatioChart
                      title="獲利能力"
                      dates={dates}
                      dark={dark}
                      get={(m, d) => value(m, d)}
                      series={[
                        ...(isFinancial
                          ? []
                          : [["毛利率", "gross_profit", "revenue"]]),
                        ["營業利益率", "operating_income", "revenue"],
                        ["淨利率", "net_income", "revenue"],
                      ]}
                    />
                    <FinancialChart
                      title="營收與 EPS 年增率"
                      dark={dark}
                      unit="%"
                      initialType="line"
                      dates={dates}
                      series={["revenue", "eps"].map((m) => ({
                        name: labels[m],
                        values: dates.map((d) => {
                          const prev = dates.find((p) => {
                            const n =
                              (Date.parse(d) - Date.parse(p)) / 86400000;
                            return n >= 350 && n <= 380;
                          });
                          const g = growth(
                            value(m, d),
                            prev ? value(m, prev) : null,
                          );
                          return g === null ? null : g * 100;
                        }),
                      }))}
                    />
                  </div>
                </section>
                <div className="mini-metrics">
                  <span>
                    營收 3 年 CAGR
                    <strong>{displayFormat(revenueCagr(3), "%")}</strong>
                  </span>
                  <span>
                    營收 5 年 CAGR
                    <strong>{displayFormat(revenueCagr(5), "%")}</strong>
                  </span>
                </div>
                <RuleAnalysis
                  facts={quarters}
                  currency={currency}
                  sector={company.sector}
                  annualOnly={annualOnly}
                />
              </>
            )}
            {section === "cashflow" && (
              <>
                <section id="cashflow">
                  <SectionTitle eyebrow="CASH FLOW" title="現金流分析" />
                  <div className="notice cash-coverage">
                    <ShieldCheck size={18} />
                    <div>
                      <strong>
                        近 {cashDates.length} 季現金流 · {cashComplete}{" "}
                        季五項資料齊全
                      </strong>
                      <p>
                        {cashDates[0] ?? "尚無資料"} —{" "}
                        {cashDates.at(-1) ?? "尚無資料"}
                        。單季值以官方三個月數據或相容累計值相減；每季來源可於財報明細查閱。歷史季度保留可取得的申報口徑；年度比較期若後續修訂，可能無法逐季重編。
                        {cashDates.at(-1) !== latestDate
                          ? " 最新盈餘公告與完整現金流申報時間不同。"
                          : ""}
                      </p>
                      {["SOFI", "NVDA", "AMZN"].includes(ticker) && (
                        <p>
                          資本支出包含設備、軟體及其他無形資產（官方 Productive
                          Assets 定義）。
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="chart-grid">
                    {chart("現金流結構", ["ocf", "icf", "financing_cf"])}
                    <FinancialChart
                      title="自由現金流與股票薪酬"
                      dark={dark}
                      dates={dates}
                      unit={unitLabel}
                      series={[
                        {
                          name: isFinancial
                            ? "自由現金流（金融機構解釋有限）"
                            : "自由現金流",
                          values: dates.map((d) => {
                            const o = value("ocf", d),
                              c = value("capex", d);
                            return o === null || c === null
                              ? null
                              : (o - Math.abs(c)) / unit;
                          }),
                        },
                        {
                          name: "股票基礎薪酬",
                          values: dates.map((d) => {
                            const v = value("sbc", d);
                            return v === null ? null : v / unit;
                          }),
                        },
                      ]}
                    />
                  </div>
                  <div className="chart-grid">
                    <RatioChart
                      title="現金流品質"
                      dark={dark}
                      dates={dates}
                      get={(m, d) => value(m, d)}
                      series={[["營業現金流／淨利", "ocf", "net_income"]]}
                    />
                    <FinancialChart
                      title="自由現金流率"
                      dark={dark}
                      unit="%"
                      dates={dates}
                      initialType="line"
                      series={[
                        {
                          name: isFinancial
                            ? "FCF／營收（金融機構解釋有限）"
                            : "FCF／營收",
                          values: dates.map((d) => {
                            const o = value("ocf", d),
                              c = value("capex", d);
                            const r = divide(
                              o === null || c === null ? null : o - Math.abs(c),
                              value("revenue", d),
                            );
                            return r === null ? null : r * 100;
                          }),
                        },
                      ]}
                    />
                  </div>
                </section>
              </>
            )}
            {section === "balance" && (
              <>
                <section id="balance">
                  <SectionTitle
                    eyebrow="BALANCE SHEET"
                    title="資產與負債結構"
                  />
                  <div className="chart-grid">
                    {chart("資產負債結構", ["assets", "liabilities", "equity"])}
                    {chart("現金與存款", ["cash", "deposits"])}
                  </div>
                  <div className="notice">
                    <CircleHelp size={18} />
                    <p>
                      總負債不等於有息負債。尚未驗證債務組成，總債務、淨債務維持
                      N/A。帳面每股淨值僅使用同一資產負債表日的權益與股數。
                    </p>
                  </div>
                  <div className="mini-metrics">
                    <span>
                      總債務 <strong>N/A</strong>
                    </span>
                    <span>
                      淨債務 <strong>N/A</strong>
                    </span>
                    <span>
                      每股淨值{" "}
                      <strong>
                        {displayFormat(
                          endingEquity && sharesForPB?.end === endingEquity.end
                            ? divide(endingEquity.value, sharesForPB.value)
                            : null,
                          "USD/shares",
                        )}
                      </strong>
                    </span>
                    <span>
                      最新資產{" "}
                      <strong>{displayFormat(endingAssets?.value)}</strong>
                    </span>
                  </div>
                </section>
              </>
            )}
            {section === "banking" && (
              <>
                <section
                  id={isFinancial ? "banking" : "sector"}
                  className="sector-note"
                >
                  <div className="sector-icon">
                    <ShieldCheck size={24} />
                  </div>
                  <div>
                    <span className="eyebrow">SECTOR-AWARE ANALYTICS</span>
                    <h3>
                      {company.sector === "fintech"
                        ? "用金融機構的角度，理解 SoFi"
                        : "依產業解讀財務數據"}
                    </h3>
                    <p>
                      {company.sector === "fintech"
                        ? "存款、放款與信用成本影響金融機構的現金流。傳統 FCF、ROIC / WACC 不宜直接作為 SoFi 的核心估值結論；請優先關注 P/B、ROE、信用品質及資本適足率。"
                        : "比較公司時，請確認會計口徑與商業模式相容。衍生估值屬研究假設，並非官方財報指標。"}
                    </p>
                    {isFinancial && (
                      <details>
                        <summary>查看金融機構專屬指標與缺值</summary>
                        <div className="bank-grid">
                          {financialGroups.banking.map((m) => (
                            <div key={m}>
                              {labels[m]}
                              <strong>
                                {displayFormat(
                                  last(quarters, m)?.value,
                                  last(quarters, m)?.unit,
                                )}
                              </strong>
                              <small>
                                {last(quarters, m)?.end ?? "尚未取得"}
                              </small>
                            </div>
                          ))}
                          {missingBanking.map((m) => (
                            <div key={m}>
                              {m}
                              <strong>N/A</strong>
                              <small>待官方揭露解析與口徑驗證</small>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </section>
              </>
            )}
            {section === "valuation" && (
              <>
                <section id="valuation">
                  <SectionTitle eyebrow="VALUATION LAB" title="估值研究" />
                  <div className="panel import-panel">
                    <div>
                      <h3>使用你有權使用的歷史股價</h3>
                      <p className="muted">
                        未確認免費來源的再散布授權，因此不抓取非官方即時報價。CSV
                        僅在本次瀏覽器工作階段使用，不會上傳。
                      </p>
                      <code>Date,Open,High,Low,Close,AdjustedClose,Volume</code>
                      <p className="small muted">
                        每筆為交易所本地日期 YYYY-MM-DD；AdjustedClose
                        可留白。估值使用未調整 Close，配對當時已公布
                        EPS；匯入區間須無股票分割，否則請先以一致股數基礎處理。
                      </p>
                    </div>
                    <div className="import-form">
                      <input
                        aria-label="股價資料來源"
                        placeholder="資料來源、授權或取得方式"
                        value={priceSource}
                        onChange={(e) => setPriceSource(e.target.value)}
                      />
                      <label className="small checkbox">
                        <input
                          type="checkbox"
                          checked={priceConsent}
                          onChange={(e) => setPriceConsent(e.target.checked)}
                        />
                        我有權使用此資料，且已確認區間沒有未處理的股票分割
                      </label>
                      <label className="button secondary">
                        <Upload size={15} />
                        匯入 {ticker} 股價 CSV
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          hidden
                          onChange={(e) => {
                            void importPrice(e.target.files?.[0]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {lastPrice && (
                        <span className="small accent">
                          <Check size={13} />
                          已匯入 {prices.length} 筆 · 截至 {lastPrice.date}
                          <br />
                          來源：{lastPrice.source}
                          <br />
                          匯入時間：{priceImported}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="valuation-head">
                    <p className="muted small">
                      GAAP 稀釋 EPS · 公布翌日起生效 · 當時可得資料 · 至少 20
                      筆有效 PE 後產生分位數
                    </p>
                    <label className="small checkbox">
                      <input
                        type="checkbox"
                        checked={log}
                        onChange={(e) => setLog(e.target.checked)}
                      />
                      對數 Y 軸
                    </label>
                  </div>
                  <FinancialChart
                    title="本益比估值河流圖"
                    dates={riverDates.map((r) => r.date)}
                    dark={dark}
                    unit="美元／股"
                    initialType="line"
                    log={log}
                    series={[
                      ...[10, 25, 50, 75, 90].map((q, i) => ({
                        name: `PE ${q} 分位估值`,
                        values: riverDates.map((r) => r.bands[i]),
                      })),
                      {
                        name: "歷史收盤價",
                        values: riverDates.map((r) => r.price),
                      },
                    ]}
                  />
                  <p className="muted small">
                    分位數採截至各交易日的擴展樣本，不引用未來股價。EPS ≤
                    0、缺季度或分割口徑未確認時不得作正 PE 結論。Adjusted /
                    Normalized EPS 尚無可靠資料，維持 N/A。
                  </p>
                  <WaccPanel sector={company.sector} />
                </section>
              </>
            )}
            {section === "statements" && (
              <>
                <section id="statements">
                  <SectionTitle
                    eyebrow="FINANCIAL STATEMENTS"
                    title="完整財務報表"
                  />
                  <div className="panel statement">
                    <div className="panel-head">
                      <h3>
                        {mode === "quarter"
                          ? "單季"
                          : mode === "annual"
                            ? "年度"
                            : "滾動十二個月"}
                        財務資料
                      </h3>
                      <button
                        className="button secondary"
                        onClick={exportTable}
                      >
                        <ArrowDownToLine size={14} />
                        CSV
                      </button>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <caption className="sr-only">
                          {ticker} 財務報表，{unitLabel}
                        </caption>
                        <thead>
                          <tr>
                            <th>財務指標</th>
                            {dates.length ? (
                              [...dates]
                                .reverse()
                                .map((d) => <th key={d}>{d}</th>)
                            ) : (
                              <th>期間 N/A</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(visibleGroups).map(
                            ([group, metrics]) => (
                              <TableGroup
                                key={group}
                                title={
                                  {
                                    income: "損益表",
                                    cashflow: "現金流量表",
                                    balance: "資產負債表",
                                    banking: "金融機構指標",
                                  }[group]!
                                }
                                metrics={metrics}
                                dates={[...dates].reverse()}
                                get={value}
                                fact={aligned}
                                unit={unit}
                                shareUnit={shareUnit}
                                onDetail={(f) =>
                                  setDetail({
                                    title: labels[f.metric],
                                    description:
                                      "數值與期間、申報版本及原始標籤可追溯。衍生單季請核對計算血緣。",
                                    facts:
                                      mode === "ttm" &&
                                      !instant.has(f.metric) &&
                                      !isRatio(f.metric)
                                        ? quarters
                                            .filter(
                                              (x) =>
                                                x.metric === f.metric &&
                                                x.end <= f.end,
                                            )
                                            .slice(-4)
                                        : [f],
                                  })
                                }
                              />
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              </>
            )}
            {section === "sources" && (
              <>
                <section id="sources">
                  <SectionTitle
                    eyebrow="RESEARCH INTEGRITY"
                    title="研究風險與資料來源"
                  />
                  <div className="chart-grid">
                    <div className="panel prose">
                      <h3>財務健康評分</h3>
                      <strong className="score">
                        N/A <small>/ 100</small>
                      </strong>
                      <p>資料不足，拒絕產生總分。</p>
                      <p className="muted">
                        {isFinancial
                          ? "金融機構研究模型預定權重：獲利 20%、成長 15%、財務強度 15%、信用風險 20%、資本適足 20%、估值 10%。缺少任何維度即不計總分；目前尚未校準評分門檻。"
                          : "非金融企業評分模型尚未校準，產業資料亦未完整，不產生總分或客觀排名。"}
                      </p>
                    </div>
                    <div className="panel prose">
                      <h3>值得追蹤的風險</h3>
                      <ul>
                        {(isFinancial
                          ? [
                              "信用損失、淨沖銷與逾期率需核對正式揭露。",
                              "存款成本、母公司及銀行子公司資本口徑需分別核對。",
                            ]
                          : company.sector === "semiconductor"
                            ? [
                                "庫存、產能利用率、資本支出與客戶集中度需核對正式揭露。",
                                "不同會計年度、產業週期與匯率可能影響可比性。",
                              ]
                            : company.sector === "automotive"
                              ? [
                                  "交付量、產品組合、售價與監管揭露需另外核對。",
                                  "不能僅由營收總額推斷需求或競爭變化。",
                                ]
                              : [
                                  "研發、客戶集中度、產品與地區組合需核對正式揭露。",
                                  "不同會計年度與會計概念可能影響公司比較。",
                                ]
                        )
                          .concat([
                            "一次性損益、收購、股數稀釋及重編需要查閱附註；不由總額推斷原因。",
                            "追蹤同口徑營收、稀釋 EPS、利潤率及現金流變化。",
                          ])
                          .map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                      </ul>
                    </div>
                  </div>
                  <div className="panel prose">
                    <div className="panel-head">
                      <h3>來源與可追溯性</h3>
                      <span className="tag">OFFICIAL FIRST</span>
                    </div>
                    <p>
                      <a
                        href="https://www.sec.gov/edgar/sec-api-documentation"
                        target="_blank"
                        rel="noreferrer"
                      >
                        SEC EDGAR API 文件 ↗
                      </a>{" "}
                      <a
                        href={
                          dataset?.source ??
                          `https://data.sec.gov/api/xbrl/companyfacts/CIK${company.cik}.json`
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        Company Facts 原始資料 ↗
                      </a>{" "}
                      <a
                        href="https://www.sec.gov/os/accessing-edgar-data"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Fair Access Policy ↗
                      </a>
                    </p>
                    <p>
                      <a
                        href={`${base}data/coverage.json`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        近五年逐季覆蓋與來源核對報告 ↗
                      </a>
                      （核心欄位：營收、淨利、直接披露稀釋 EPS；其他缺值另列）
                    </p>
                    <p className="muted">
                      Company Facts
                      並未完整涵蓋公司自訂及分部指標。管線可依明確映射解析官方
                      Inline XBRL 的合併報表數值；未驗證的自訂及分部欄位一律
                      N/A。TSM 支援官方 6-K 季度公告與 IFRS
                      年度資料，以新臺幣及普通股 EPS 顯示；美元 ADR
                      估值尚未換算。所有顯示數值均提供申報日期、期間、單位及來源；資料更新失敗時保留上一有效版本。
                    </p>
                    {dataset?.warnings.map((w) => (
                      <p className="small muted" key={w}>
                        • {w}
                      </p>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
          <footer>
            <span>
              <ChartNoAxesCombined size={16} />
              OpenStock Analytics
            </span>
            <span>公開資料，審慎研究。僅供研究輔助，不構成投資建議。</span>
            <span>繁體中文 · {currency}</span>
          </footer>
        </main>
      </div>
      <nav className="bottom-navigation" aria-label="手機主要功能">
        {[
          { id: "overview", label: "總覽", icon: LayoutDashboard },
          { id: "income", label: "財務", icon: ChartNoAxesCombined },
          { id: "statements", label: "報表", icon: FileText },
          { id: "valuation", label: "估值", icon: ChartCandlestick },
          { id: "sources", label: "來源", icon: ShieldCheck },
        ].map((s) => (
          <button
            key={s.id}
            className={
              section === s.id ||
              (s.id === "income" &&
                ["cashflow", "balance", "banking"].includes(section))
                ? "active"
                : ""
            }
            onClick={() => navigate(s.id)}
            aria-current={section === s.id ? "page" : undefined}
          >
            <s.icon size={20} />
            <span>{s.label}</span>
          </button>
        ))}
      </nav>
      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-label={detail.title}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-head">
              <h2>{detail.title}</h2>
              <button
                aria-label="關閉明細"
                autoFocus
                onClick={() => setDetail(null)}
              >
                <X size={20} />
              </button>
            </div>
            <p>{detail.description}</p>
            {!detail.facts.length ? (
              <div className="notice">N/A — 尚無可核實資料來源。</div>
            ) : (
              detail.facts.map((f) => (
                <div className="fact-detail" key={`${f.metric}-${f.end}`}>
                  <strong>
                    {displayFormat(f.value, f.unit)} · {f.end}
                  </strong>
                  <dl>
                    <dt>會計期間</dt>
                    <dd>
                      {f.start ?? "時點"} → {f.end}
                    </dd>
                    <dt>申報日</dt>
                    <dd>{f.filed}</dd>
                    <dt>會計口徑</dt>
                    <dd>
                      {f.tag.startsWith("disclosure:tsm.")
                        ? "TIFRS（官方公告／完整報表）"
                        : f.tag.startsWith("ifrs-full:")
                          ? "IFRS (IASB)（年度報表）"
                          : "US GAAP"}
                    </dd>
                    <dt>原始標籤</dt>
                    <dd>{f.tag}</dd>
                    <dt>Accession</dt>
                    <dd>{f.accession}</dd>
                    <dt>品質</dt>
                    <dd>{f.quality === "derived" ? "衍生單季" : "官方申報"}</dd>
                  </dl>
                  {f.lineage.map((l) => (
                    <code key={l}>{l}</code>
                  ))}
                  {f.source_refs
                    ?.filter((url) => url !== f.source)
                    .map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer">
                        另一筆累計值來源 ↗
                      </a>
                    ))}
                  <a href={f.source} target="_blank" rel="noreferrer">
                    檢視官方 Filing ↗
                  </a>
                </div>
              ))
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="section-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
    </div>
  );
}
function RatioChart({
  title,
  dates,
  dark,
  get,
  series,
}: {
  title: string;
  dates: string[];
  dark: boolean;
  get: (m: string, d: string) => number | null;
  series: string[][];
}) {
  return (
    <FinancialChart
      title={title}
      dates={dates}
      dark={dark}
      unit="%"
      initialType="line"
      series={series.map(([name, n, d]) => ({
        name,
        values: dates.map((date) => {
          const x = divide(get(n, date), get(d, date));
          return x === null ? null : x * 100;
        }),
      }))}
    />
  );
}
function TableGroup({
  title,
  metrics,
  dates,
  get,
  fact,
  unit,
  shareUnit,
  onDetail,
}: {
  title: string;
  metrics: string[];
  dates: string[];
  get: (m: string, d: string) => number | null;
  fact: (m: string, d: string) => Fact | null;
  unit: number;
  shareUnit: string;
  onDetail: (f: Fact) => void;
}) {
  return (
    <>
      <tr className="table-group">
        <th colSpan={Math.max(dates.length, 1) + 1}>{title}</th>
      </tr>
      {metrics.map((m) => (
        <tr key={m}>
          <th
            title={`${labels[m]}；${metricUnit(m, "所選幣別單位", shareUnit)}`}
          >
            {labels[m]}
            <small>{metricUnit(m, "", shareUnit)}</small>
          </th>
          {dates.length ? (
            dates.map((d) => {
              const v = get(m, d),
                f = fact(m, d);
              return (
                <td key={d} className={v !== null && v < 0 ? "negative" : ""}>
                  <button
                    disabled={!f}
                    title="查看申報來源"
                    onClick={() => f && onDetail(f)}
                  >
                    {v === null
                      ? "N/A"
                      : (v / metricScale(m, unit)).toLocaleString("zh-TW", {
                          maximumFractionDigits: 2,
                        })}
                  </button>
                </td>
              );
            })
          ) : (
            <td>N/A</td>
          )}
        </tr>
      ))}
    </>
  );
}
function WaccPanel({ sector }: { sector: string }) {
  const [v, setV] = useState<Record<string, string>>({
    ebit: "",
    tax: "",
    capital: "",
    equity: "",
    debt: "",
    rf: "",
    beta: "",
    erp: "",
    kd: "",
  });
  const fields = [
    ["ebit", "EBIT（百萬美元）"],
    ["tax", "正常化稅率 %"],
    ["capital", "平均投入資本（百萬美元）"],
    ["equity", "權益市值（百萬美元）"],
    ["debt", "債務市值（百萬美元）"],
    ["rf", "無風險利率 %"],
    ["beta", "Beta"],
    ["erp", "權益風險溢酬 %"],
    ["kd", "債務成本 %"],
  ];
  const complete = Object.values(v).every(
      (x) => x.trim() !== "" && Number.isFinite(Number(x)),
    ),
    n = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)]));
  const valid =
    complete &&
    n.tax >= 0 &&
    n.tax <= 100 &&
    n.capital > 0 &&
    n.equity >= 0 &&
    n.debt >= 0 &&
    n.equity + n.debt > 0 &&
    n.rf >= 0 &&
    n.erp >= 0 &&
    n.kd >= 0;
  const ke = (n.rf + n.beta * n.erp) / 100,
    nopat = n.ebit * (1 - n.tax / 100),
    roic = valid ? nopat / n.capital : null,
    wacc = valid
      ? (n.equity * ke + ((n.debt * n.kd) / 100) * (1 - n.tax / 100)) /
        (n.equity + n.debt)
      : null;
  return (
    <details className="panel prose">
      <summary>
        ROIC / WACC 假設實驗室 ·{" "}
        {sector === "fintech" ? "金融機構不適用一般解讀" : "非金融公司研究"}
      </summary>
      <p className="muted">
        全部輸入皆為使用者假設，未預填無來源的市場利率、Beta 或風險溢酬。ROIC =
        EBIT × (1 − 稅率) ÷ 平均投入資本；WACC 按市值加權股債資金成本。
      </p>
      <div className="assumption-grid">
        {fields.map(([k, l]) => (
          <label key={k}>
            {l}
            <input
              type="number"
              step="any"
              value={v[k]}
              onChange={(e) => setV({ ...v, [k]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="mini-metrics">
        <span>
          NOPAT <strong>{valid ? nopat.toFixed(2) + " 百萬" : "N/A"}</strong>
        </span>
        <span>
          股權成本 <strong>{format(valid ? ke : null, "%")}</strong>
        </span>
        <span>
          ROIC <strong>{format(roic, "%")}</strong>
        </span>
        <span>
          WACC <strong>{format(wacc, "%")}</strong>
        </span>
        <span>
          利差{" "}
          <strong>
            {format(roic !== null && wacc !== null ? roic - wacc : null, "%")}
          </strong>
        </span>
      </div>
      <p>
        {valid
          ? `在你輸入的假設下，每投入 100 美元資本，年化 NOPAT 為 ${(roic! * 100).toFixed(2)} 美元，資金成本為 ${(wacc! * 100).toFixed(2)} 美元。`
          : "請輸入完整且有效的假設，才會產生計算結果。"}
      </p>
    </details>
  );
}
