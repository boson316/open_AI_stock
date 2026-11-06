import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
  Sparkles,
  Moon,
  Search,
  ShieldCheck,
  Sun,
  Upload,
  Users,
  Globe,
  Wallet,
  X,
} from "lucide-react";
import { RuleAnalysis } from "./components/RuleAnalysis";
import { StockSnapshot } from "./components/StockSnapshot";
import { EarningsCall } from "./components/EarningsCall";
import {
  buildAnalysisPack,
  buildCombinedPack,
  downloadText,
} from "./lib/analysisPack";
import { FinancialChart } from "./components/FinancialChart";
import { ChartGuideBox } from "./components/ChartGuideBox";
import { Scorecard } from "./components/Scorecard";
import type { ScoreItem } from "./components/Scorecard";
import { BANK_GUIDE, SNAPSHOT_GUIDE } from "./lib/chartGuides";
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
import {
  adjustForSplits,
  betaFromWeekly,
  sharesAt,
  weeklyToPrices,
} from "./lib/finance";
import { useResearch } from "./lib/research";
import { quarterPricesFromWeekly } from "./lib/intrinsic";
import { loadPriceFile } from "./lib/research";
import type { PriceEntry, PriceFile } from "./lib/research";
/** TSM：1 股 ADR = 5 股普通股。 */
// 不在首頁的分頁按需載入，首次開啟只下載總覽需要的程式。
const Compare = lazy(() => import("./components/Compare").then((m) => ({ default: m.Compare })));
const Screener = lazy(() => import("./components/Screener").then((m) => ({ default: m.Screener })));
const ExternalValuationPanel = lazy(() => import("./components/ExternalValuation").then((m) => ({ default: m.ExternalValuationPanel })));
const ValuationTools = lazy(() => import("./components/ValuationTools").then((m) => ({ default: m.ValuationTools })));
const IntrinsicValue = lazy(() => import("./components/IntrinsicValue").then((m) => ({ default: m.IntrinsicValue })));
const HealthPanels = lazy(() => import("./components/HealthPanels").then((m) => ({ default: m.HealthPanels })));
const Gurus = lazy(() => import("./components/Gurus").then((m) => ({ default: m.Gurus })));
const Market = lazy(() => import("./components/Market").then((m) => ({ default: m.Market })));
const Portfolio = lazy(() => import("./components/Portfolio").then((m) => ({ default: m.Portfolio })));
const Reconciliation = lazy(() => import("./components/Supplement").then((m) => ({ default: m.Reconciliation })));
const Supplement = lazy(() => import("./components/Supplement").then((m) => ({ default: m.Supplement })));
const ADR_RATIO = 5;

const sections = [
  { id: "overview", label: "研究總覽", icon: Layers3 },
  { id: "income", label: "損益與成長", icon: BarChart3 },
  { id: "cashflow", label: "現金流分析", icon: Activity },
  { id: "balance", label: "資產與負債", icon: Database },
  { id: "banking", label: "金融機構指標", icon: ShieldCheck },
  { id: "screener", label: "選股篩選", icon: Search },
  { id: "compare", label: "多股比較", icon: Layers3 },
  { id: "valuation", label: "估值研究", icon: Activity },
  { id: "gurus", label: "13F 大師", icon: Users },
  { id: "market", label: "台美估值", icon: Globe },
  { id: "portfolio", label: "我的持股", icon: Wallet },
  { id: "statements", label: "完整財務報表", icon: FileText },
  { id: "sources", label: "資料與方法", icon: CircleHelp },
];
const financialGroups: Record<string, string[]> = {
  income: ["revenue", "gross_profit", "operating_income", "net_income", "eps"],
  cashflow: ["ocf", "icf", "financing_cf", "capex", "sbc"],
  balance: [
    "assets",
    "liabilities",
    "equity",
    "cash",
    "shares",
    "current_assets",
    "current_liabilities",
    "receivables",
    "inventory",
    "payables",
    "short_borrowings",
    "debt_current",
    "long_term_debt",
  ],
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
    [packStatus, setPackStatus] = useState(""),
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
    [log, setLog] = useState(false),
    [autoPrice, setAutoPrice] = useState<PriceEntry | null>(null),
    [fxFile, setFxFile] = useState<PriceFile["fx"] | null>(null);
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
        // 預設開啟台積電；目錄沒有 TSM 時維持原本的備援公司。
        if (
          c.companies.some(
            (x) => x.ticker === "TSM" && x.status === "available",
          )
        )
          setTicker("TSM");
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
    setAutoPrice(null);
    // 預設載入每週自動更新的股價；使用者匯入 CSV 時會覆蓋。
    loadPriceFile(base).then((pf) => {
      const entry = pf?.tickers[ticker];
      if (!controller.signal.aborted) setFxFile(pf?.fx ?? null);
      if (controller.signal.aborted || !entry || !Array.isArray(entry.weekly)) return;
      const series = weeklyToPrices(entry.weekly, `${entry.source ?? "Stooq"}（每週自動更新）`);
      if (!series.length) return;
      setAutoPrice(entry);
      setPrices((cur) => (cur.length ? cur : series));
    });
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
  const endingAssets = last(quarters, "assets");
  function returnOn(metric: string) {
    // TSM：損益與資產負債表都用 6-K 的 TIFRS，不與 20-F 的 IFRS (IASB) 混算。
    const rq = currency === "TWD" ? tifrsQuarters : quarters;
    const end = last(rq, metric);
    if (!end) return null;
    const prior = [...rq]
      .reverse()
      .find(
        (f) =>
          f.metric === metric &&
          (Date.parse(end.end) - Date.parse(f.end)) / 86400000 >= 350 &&
          (Date.parse(end.end) - Date.parse(f.end)) / 86400000 <= 380,
      );
    const earnings = annualOnly
      ? (rq.find((f) => f.metric === "net_income" && f.end === end.end)
          ?.value ?? null)
      : ttm(
          rq
            .filter((f) => f.metric === "net_income" && f.end <= end.end)
            .slice(-4),
        );
    const earningsEnd = last(
      rq.filter((f) => f.end <= end.end),
      "net_income",
    )?.end;
    return prior && earningsEnd === end.end
      ? divide(earnings, (end.value + prior.value) / 2)
      : null;
  }
  const lastPrice = prices.at(-1),
    prevPrice = prices.at(-2);
  // 自動股價已按分割調整：把當時申報的 EPS／股數換算到目前股數基礎再計算倍數。
  const splits = useMemo(() => autoPrice?.splits ?? [], [autoPrice]);
  const adjQuarters = useMemo(
    () => adjustForSplits(quarters, splits),
    [quarters, splits],
  );
  const adjRaw = useMemo(
    () => adjustForSplits(raw, splits),
    [raw, splits],
  );
  // TSM：季度損益與資產負債表都採 6-K 的 TIFRS（同一口徑），不與 20-F 的 IFRS (IASB) 混算。
  const isAdr = currency === "TWD";
  const tifrsRaw = useMemo(
    () => (isAdr ? raw.filter((f) => f.tag.startsWith("disclosure:tsm.")) : []),
    [raw, isAdr],
  );
  const tifrsQuarters = useMemo(() => normalize(tifrsRaw), [tifrsRaw]);
  // 新臺幣普通股 → 每 ADR 美元：1 ADR = 5 股普通股，匯率取股價日（含）之前 14 天內最近一筆（BIS／聯準會 H.10）。
  const fxWeekly = useMemo(
    () => (isAdr ? (fxFile?.USDTWD?.weekly ?? []) : []),
    [isAdr, fxFile],
  );
  const fxAt = (d: string) => {
    const hit = fxWeekly.filter(([x]: [string, number]) => x <= d).at(-1);
    return hit && (Date.parse(d) - Date.parse(hit[0])) / 86400000 <= 14
      ? hit[1]
      : null;
  };
  const perShareUsd = (d: string) => {
    if (!isAdr) return 1;
    const r = fxAt(d);
    return r ? ADR_RATIO / r : null;
  };
  const toUsd = (d: string) => {
    if (!isAdr) return 1;
    const r = fxAt(d);
    return r ? 1 / r : null;
  };
  /** 股價日之前已公布的財報（時點正確）：TTM EPS、每股淨值、股數與營收／自由現金流。 */
  const pit = useMemo(() => {
    if (!lastPrice || annualOnly) return null;
    if (currency !== "USD" && !isAdr) return null;
    const asOf = new Date(Date.parse(lastPrice.date) - 86400000)
      .toISOString()
      .slice(0, 10);
    const q = normalize(isAdr ? tifrsRaw : adjRaw, asOf);
    const epsUnit = isAdr ? "TWD/shares" : "USD/shares";
    const epsFacts = q.filter((f) => f.metric === "eps" && f.unit === epsUnit);
    const epsLocal = sumTTM(epsFacts, "eps");
    const epsEnd = epsFacts.at(-1)?.end ?? null;
    const k = perShareUsd(lastPrice.date),
      m = toUsd(lastPrice.date);
    const fresh = (end: string | null | undefined) =>
      !!end && (Date.parse(lastPrice.date) - Date.parse(end)) / 86400000 <= 200;
    const equity = last(q, "equity");
    const sh = equity ? sharesAt(q, equity.end) : null;
    const latestShares = (() => {
      const ends = [...new Set(q.filter((f) => f.metric.includes("shares")).map((f) => f.end))].sort();
      for (const end of ends.reverse()) {
        const s = sharesAt(q, end);
        if (s) return { ...s, end };
      }
      return null;
    })();
    // 營收與自由現金流：股價日前的四季不連續時（例如第四季只能由隔天才申報的年報還原），改用最新完整四季。
    const latestQ = isAdr ? tifrsQuarters : quarters;
    const rev = sumTTM(q, "revenue") ?? sumTTM(latestQ, "revenue");
    const ocfA = sumTTM(q, "ocf"),
      capexA = sumTTM(q, "capex");
    const [ocf, capex] =
      ocfA !== null && capexA !== null
        ? [ocfA, capexA]
        : [sumTTM(latestQ, "ocf"), sumTTM(latestQ, "capex")];
    const fcf = ocf !== null && capex !== null ? ocf - Math.abs(capex) : null;
    const ordinaryPerQuote = isAdr ? ADR_RATIO : 1;
    const mcap =
      latestShares && fresh(latestShares.end)
        ? (lastPrice.close * latestShares.value) / ordinaryPerQuote
        : null;
    return {
      epsTtm: epsLocal !== null && k !== null && fresh(epsEnd) ? epsLocal * k : null,
      epsLocal,
      epsEnd,
      bvps:
        equity && sh && k !== null && fresh(equity.end)
          ? (equity.value / sh.value) * k
          : null,
      equityEnd: equity?.end ?? null,
      sharesKind: latestShares?.metric ?? null,
      sharesEnd: latestShares?.end ?? null,
      mcap,
      revUsd: rev !== null && m !== null ? rev * m : null,
      fcfUsd: fcf !== null && m !== null ? fcf * m : null,
      fx: isAdr ? fxAt(lastPrice.date) : null,
    };
  }, [lastPrice, annualOnly, currency, isAdr, tifrsRaw, adjRaw, fxWeekly, quarters, tifrsQuarters]);
  const peValue =
    pit && pit.epsTtm !== null && pit.epsTtm > 0
      ? divide(lastPrice!.close, pit.epsTtm)
      : null;
  const pb =
    pit && pit.bvps !== null && pit.bvps > 0
      ? divide(lastPrice!.close, pit.bvps)
      : null;
  const autoQuarterPrices = useMemo(
    () =>
      autoPrice && currency === "USD" && !annualOnly
        ? quarterPricesFromWeekly(adjQuarters, autoPrice.weekly, {
            date: autoPrice.asof,
            close: autoPrice.close,
          })
        : null,
    [autoPrice, adjQuarters, currency, annualOnly],
  );
  // 以官方財報 × 自動股價計算的行情卡；外部研究資料缺值時也用它補齊。
  const officialQuote =
    autoPrice && pit
      ? {
          close: autoPrice.close,
          asof: autoPrice.asof,
          prev: autoPrice.prev_close ?? null,
          hi52: autoPrice.hi52,
          lo52: autoPrice.lo52,
          source: autoPrice.source ?? "Stooq",
          pe: peValue,
          pb,
          ps: pit.mcap !== null && pit.revUsd ? divide(pit.mcap, pit.revUsd) : null,
          pfcf:
            pit.mcap !== null && pit.fcfUsd !== null && pit.fcfUsd > 0
              ? divide(pit.mcap, pit.fcfUsd)
              : null,
          fcfNegative: pit.fcfUsd !== null && pit.fcfUsd <= 0,
          mcap: pit.mcap,
          sharesEnd: pit.sharesEnd,
          sharesKind: pit.sharesKind,
          epsTtm: pit.epsTtm,
          epsEnd: pit.epsEnd,
          fx: pit.fx,
          adr: isAdr,
        }
      : null;
  // 帳面每股淨值：同一資產負債表日的權益 ÷ 股數（流通股數 → 封面股數 → 加權稀釋股數）。
  const bookPerShare = (() => {
    const bq = currency === "TWD" ? tifrsQuarters : quarters;
    const eq = last(bq, "equity");
    const sh = eq ? sharesAt(bq, eq.end) : null;
    return eq && sh
      ? { value: eq.value / sh.value, end: eq.end, kind: sh.metric }
      : null;
  })();
  // ROIC／WACC 實驗室預設值：官方財報、自動股價與本站研究資料的共同假設，可自行改寫。
  const { data: researchData } = useResearch(base);
  const [benchWeekly, setBenchWeekly] = useState<[string, number][]>([]);
  useEffect(() => {
    loadPriceFile(base).then((pf) => setBenchWeekly(pf?.tickers.SPY?.weekly ?? []));
  }, [base]);
  const waccDefaults = (() => {
    const out: Record<string, { value: number; src: string }> = {};
    if (annualOnly) return out;
    const rq = isAdr ? tifrsQuarters : quarters;
    const m = lastPrice ? toUsd(lastPrice.date) : isAdr ? null : 1;
    const toM = (v: number | null) => (v === null || m === null ? null : (v * m) / 1e6);
    const ebit = toM(sumTTM(rq, "operating_income"));
    if (ebit !== null) out.ebit = { value: Math.round(ebit), src: "SEC 官方 TTM 營業利益" + (isAdr ? "（按匯率換算美元）" : "") };
    const r = researchData?.roic[ticker === "GOOG" ? "GOOGL" : ticker];
    out.tax = r
      ? { value: r.tax, src: "研究資料假設稅率" }
      : { value: isAdr ? 20 : 21, src: isAdr ? "台灣營所稅法定稅率" : "美國聯邦法定稅率" };
    const debtAt = (end: string) => {
      const parts = ["short_borrowings", "debt_current", "long_term_debt"].map(
        (k) => rq.find((f) => f.metric === k && f.end === end)?.value ?? null,
      );
      // 該期沒有任何金融借款科目時以 0 計（預填來源會註明），使用者可自行改寫。
      return parts.reduce<number>((a, x) => a + (x ?? 0), 0);
    };
    const capAt = (end: string) => {
      const eq = rq.find((f) => f.metric === "equity" && f.end === end)?.value ?? null;
      const cash = rq.find((f) => f.metric === "cash" && f.end === end)?.value ?? null;
      const debt = debtAt(end);
      return eq === null || cash === null || debt === null ? null : eq + debt - cash;
    };
    const eqEnd = last(rq, "equity")?.end;
    if (eqEnd) {
      const prior = rq
        .filter((f) => f.metric === "equity")
        .reverse()
        .find((f) => {
          const d = (Date.parse(eqEnd) - Date.parse(f.end)) / 86400000;
          return d >= 350 && d <= 380;
        })?.end;
      const c1 = capAt(eqEnd), c0 = prior ? capAt(prior) : null;
      const cap = toM(c1 !== null && c0 !== null ? (c1 + c0) / 2 : c1);
      if (cap !== null && cap > 0)
        out.capital = { value: Math.round(cap), src: `（權益 + 金融借款 − 現金）${c0 !== null ? `${prior} 與 ${eqEnd} 平均` : eqEnd}` };
      const debt = toM(debtAt(eqEnd));
      const anyDebt = ["short_borrowings", "debt_current", "long_term_debt"].some((k) =>
        rq.some((f) => f.metric === k && f.end === eqEnd),
      );
      if (debt !== null)
        out.debt = {
          value: Math.round(debt),
          src: anyDebt ? `帳面金融借款（${eqEnd}）` : `${eqEnd} 未申報金融借款科目，以 0 計`,
        };
    }
    if (pit?.mcap) out.equity = { value: Math.round(pit.mcap / 1e6), src: `市值（${lastPrice?.date} 收盤）` };
    if (researchData) out.rf = { value: researchData.rf_us10y, src: "美國 10 年期公債殖利率（研究資料）" };
    const computedBeta = autoPrice ? betaFromWeekly(autoPrice.weekly, benchWeekly) : null;
    if (r) out.beta = { value: r.beta, src: r.beta_src };
    else if (computedBeta)
      out.beta = { value: Math.round(computedBeta.beta * 100) / 100, src: `本站以近 ${computedBeta.weeks} 週週報酬對 SPY 迴歸計算` };
    out.erp = { value: r?.erp ?? 4.5, src: "權益風險溢酬假設（與本站研究資料一致）" };
    if (researchData)
      out.kd = { value: Math.round((researchData.rf_us10y + (r?.kd_spread ?? 1)) * 100) / 100, src: "無風險利率 + 1 個百分點信用利差（假設）" };
    return out;
  })();
  // 報表空格的原因：金融業不適用的工商業科目、整段期間都沒申報的科目、或個別期間未揭露。
  const bankNA = new Set(["gross_profit", "operating_income", "current_assets", "current_liabilities", "inventory", "payables", "receivables"]);
  const reported = new Set(raw.map((f) => f.metric));
  const lastReported = (m: string) =>
    raw.filter((f) => f.metric === m).reduce((a, f) => (f.end > a ? f.end : a), "");
  const missingReason = (m: string, d?: string) =>
    d && reported.has(m) && d > lastReported(m)
      ? {
          text: "尚未申報",
          title: `這一季的完整報表（資產負債表、現金流量表）公司尚未向 SEC 申報；最新已申報期為 ${lastReported(m)}。台積電通常在法說會後約一個月才申報完整合併財報。`,
        }
      : isFinancial && bankNA.has(m)
      ? { text: "不適用", title: "金融機構不區分流動／非流動，也不揭露毛利、營業利益、存貨等工商業科目" }
      : !reported.has(m)
        ? { text: "未申報", title: "公司在 SEC 申報中沒有使用此科目（常見原因：沒有這類資產負債，或改用公司自訂科目）" }
        : { text: "未揭露", title: "這一期沒有相容的官方數字（例如只在年報揭露，或季度無法由累計值還原）" };
  // 金融機構補充指標：只用官方數字直接計算，不估計。
  const bankComputed: Record<string, { text: string; note: string }> = (() => {
    const out: Record<string, { text: string; note: string }> = {};
    const eq = last(quarters, "equity");
    if (eq) {
      const gw = quarters.find((f) => f.metric === "goodwill" && f.end === eq.end);
      const ia = quarters.find((f) => f.metric === "intangibles" && f.end === eq.end);
      if (gw && ia)
        out["有形帳面價值"] = {
          text: displayFormat(eq.value - gw.value - ia.value),
          note: `${eq.end}：股東權益 − 商譽 − 無形資產`,
        };
    }
    const mem = last(quarters, "members");
    const prod = mem ? quarters.find((f) => f.metric === "products" && f.end === mem.end) : null;
    if (mem && prod && mem.value > 0)
      out["每會員產品數"] = {
        text: (prod.value / mem.value).toFixed(2),
        note: `${mem.end}：產品總數 ÷ 會員總數`,
      };
    return out;
  })();
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
      period: last(currency === "TWD" ? tifrsQuarters : quarters, "equity")?.end,
      desc:
        currency === "TWD"
          ? "TIFRS 季度 TTM 淨利 ÷ 期初與期末歸屬母公司權益平均（皆取自 6-K 合併財報，不與 20-F 的 IFRS 混算）。"
          : "同期間 TTM 淨利 ÷ 期初與期末股東權益平均。",
    },
    {
      title: "資產報酬率",
      value: returnOn("assets"),
      unit: "%",
      metric: "assets",
      period: last(currency === "TWD" ? tifrsQuarters : quarters, "assets")?.end,
      desc:
        currency === "TWD"
          ? "TIFRS 季度 TTM 淨利 ÷ 期初與期末總資產平均（皆取自 6-K 合併財報）。"
          : "同期間 TTM 淨利 ÷ 期初與期末總資產平均。",
    },
    {
      title: "本益比 P/E",
      value: peValue,
      unit: "x",
      metric: "eps",
      period: pit?.epsEnd,
      desc:
        currency === "TWD"
          ? `ADR 收盤價 ÷ 每 ADR TTM EPS（TIFRS 普通股 EPS × 5 ÷ 當日 USD/TWD 匯率${pit?.fx ? ` ${pit.fx}` : ""}）。只用股價日以前已公布的季度。`
          : "收盤價 ÷ 正的 TTM GAAP 稀釋 EPS；只用股價日以前已公布的季度（財報當天公布的數字從隔天起算）。",
    },
    {
      title: "股價淨值比 P/B",
      value: pb,
      unit: "x",
      metric: "equity",
      period: pit?.equityEnd,
      desc:
        currency === "TWD"
          ? "ADR 收盤價 ÷ 每 ADR 帳面淨值（TIFRS 歸屬母公司權益 ÷ 普通股數 × 5 ÷ 匯率）。"
          : "收盤價 ÷（同一資產負債表日的權益 ÷ 股數）；股數依序採流通股數、申報封面股數、加權平均稀釋股數。",
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
  // 本益比與股價淨值比已改為「股價日前一天以前已公布」的財報（pit），不會配到股價之後才公布的數字。
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
    () =>
      isAdr
        ? fxWeekly.length
          ? river(tifrsRaw, prices, { epsUnit: "TWD/shares", perShare: perShareUsd })
          : []
        : river(currency === "USD" && !annualOnly ? adjRaw : [], prices),
    // eslint 未啟用 hooks 規則；perShareUsd 只依賴 fxWeekly。
    [adjRaw, tifrsRaw, prices, currency, annualOnly, isAdr, fxWeekly],
  );
  // 總覽體檢卡：五個面向的燈號，全部由官方財報與自動股價計算。
  const scoreItems: ScoreItem[] = (() => {
    if (!dataset || annualOnly) return [];
    const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
    const out: ScoreItem[] = [];
    const g = yoy(quarters, "revenue");
    out.push(
      g === null
        ? { name: "成長", light: "na", verdict: "缺少去年同期營收", rule: "最新一季營收 vs 去年同一季" }
        : {
            name: "成長",
            light: g >= 0.15 ? "good" : g >= 0 ? "ok" : "bad",
            verdict: `營收年增 ${pct(g)}${g >= 0.15 ? "，高成長" : g >= 0 ? "，溫和成長" : "，營收衰退"}`,
            rule: "營收年增率：≥ 15% 佳、0–15% 普通、< 0% 注意",
          },
    );
    if (isFinancial) {
      const roe = returnOn("equity");
      out.push(
        roe === null
          ? { name: "獲利", light: "na", verdict: "缺少可比 ROE", rule: "金融業看股東權益報酬率" }
          : {
              name: "獲利",
              light: roe >= 0.12 ? "good" : roe >= 0.06 ? "ok" : "bad",
              verdict: `ROE ${pct(roe)}`,
              rule: "金融業 ROE：≥ 12% 佳、6%–12% 普通、< 6% 注意",
            },
      );
      out.push({ name: "現金流", light: "na", verdict: "放款增減會讓營業現金流大幅波動，不適用一般標準", rule: "金融業不以自由現金流判斷" });
      const cet1 = last(quarters, "cet1")?.value ?? null;
      out.push(
        cet1 === null
          ? { name: "財務體質", light: "na", verdict: "缺少 CET1 資本適足率", rule: "CET1：≥ 10.5% 佳" }
          : {
              name: "財務體質",
              light: cet1 >= 0.105 ? "good" : cet1 >= 0.07 ? "ok" : "bad",
              verdict: `CET1 ${pct(cet1)}${cet1 >= 0.105 ? "，資本充足" : ""}`,
              rule: "CET1 資本適足率：≥ 10.5% 佳、7%–10.5% 普通、< 7% 注意",
            },
      );
    } else {
      const rev = sumTTM(quarters, "revenue"), op = sumTTM(quarters, "operating_income");
      const om = rev && op !== null ? op / rev : null;
      out.push(
        om === null
          ? { name: "獲利", light: "na", verdict: "缺少連續四季營業利益", rule: "近四季營業利益率" }
          : {
              name: "獲利",
              light: om >= 0.2 ? "good" : om >= 0.08 ? "ok" : "bad",
              verdict: `營業利益率 ${pct(om)}${om >= 0.2 ? "，本業很賺錢" : om >= 0.08 ? "" : "，獲利偏薄"}`,
              rule: "近四季營業利益率：≥ 20% 佳、8%–20% 普通、< 8% 注意",
            },
      );
      const ocf = sumTTM(quarters, "ocf"), ni = sumTTM(quarters, "net_income"), capex = sumTTM(quarters, "capex");
      const fcf = ocf !== null && capex !== null ? ocf - Math.abs(capex) : null;
      const q = ocf !== null && ni !== null && ni > 0 ? ocf / ni : null;
      out.push(
        q === null || fcf === null
          ? { name: "現金流", light: "na", verdict: "缺少連續四季現金流或淨利為負", rule: "營業現金流 ÷ 淨利、自由現金流" }
          : {
              name: "現金流",
              light: q >= 0.8 && fcf > 0 ? "good" : q >= 0.5 ? "ok" : "bad",
              verdict: `現金流 ÷ 淨利 ${pct(q)}，自由現金流${fcf > 0 ? "為正" : "為負（投資大於營業現金流）"}`,
              rule: "營業現金流 ÷ 淨利 ≥ 80% 且自由現金流為正：佳；≥ 50% 普通；其他注意",
            },
      );
      const li = last(quarters, "liabilities"), as = last(quarters, "assets");
      const lev = li && as && li.end === as.end && as.value > 0 ? li.value / as.value : null;
      out.push(
        lev === null
          ? { name: "財務體質", light: "na", verdict: "缺少同期總負債與總資產", rule: "負債 ÷ 資產" }
          : {
              name: "財務體質",
              light: lev < 0.5 ? "good" : lev < 0.7 ? "ok" : "bad",
              verdict: `負債占資產 ${pct(lev)}${lev < 0.5 ? "，財務穩健" : lev < 0.7 ? "" : "，槓桿偏高"}`,
              rule: "負債 ÷ 資產：< 50% 佳、50%–70% 普通、≥ 70% 注意（含應付帳款等營運負債）",
            },
      );
    }
    const pes = riverRows.map((r) => r.pe).filter((v): v is number => v !== null && v > 0);
    const nowPe = riverRows.at(-1)?.pe ?? null;
    if (nowPe !== null && pes.length >= 52) {
      const rank = pes.filter((v) => v <= nowPe).length / pes.length;
      out.push({
        name: "估值",
        light: rank < 0.3 ? "good" : rank <= 0.75 ? "ok" : "bad",
        verdict: `本益比 ${nowPe.toFixed(1)}×，高於近 ${Math.round(pes.length / 52)} 年 ${Math.round(rank * 100)}% 的時間${rank < 0.3 ? "，歷史相對便宜" : rank <= 0.75 ? "，歷史合理區間" : "，歷史偏貴"}`,
        rule: "和自己過去的本益比比：低於 30% 分位相對便宜、30%–75% 合理、高於 75% 偏貴",
      });
    } else {
      out.push({ name: "估值", light: "na", verdict: "股價或盈餘歷史不足，無法和過去比較", rule: "需要至少一年、EPS 為正的週資料" });
    }
    return out;
  })();
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
      setAutoPrice(null);
      setPriceImported(new Date().toISOString());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const packReady = !!dataset && !imported && !annualOnly;
  async function copyPack() {
    if (!dataset) return;
    const text = buildAnalysisPack(dataset, quarters);
    try {
      await navigator.clipboard.writeText(text);
      setPackStatus("已複製，貼到 Claude／ChatGPT 即可分析");
    } catch {
      downloadText(`${ticker}-ai-analysis-pack.md`, text);
      setPackStatus("瀏覽器不允許複製，已改為下載 .md 檔");
    }
    setTimeout(() => setPackStatus(""), 4000);
  }
  async function exportAllPacks() {
    const targets = catalog.companies.filter(
      (c) =>
        c.status === "available" &&
        c.file &&
        /^[A-Z]+\.json$/.test(c.file) &&
        (listFilter === "all" || favorites.includes(c.ticker)),
    );
    if (!targets.length) {
      setError("沒有可匯出的股票，請先收藏股票或切回「全部股票」。");
      return;
    }
    setPackStatus(`正在彙整 ${targets.length} 檔…`);
    try {
      const packs = [];
      for (const c of targets) {
        const r = await fetch(`${base}data/${c.file}`);
        if (!r.ok) throw Error(`${c.ticker} HTTP ${r.status}`);
        const d = validateDataset(await r.json());
        if (d.ticker !== c.ticker || d.cik !== c.cik)
          throw Error(`${c.ticker} 公司資料不一致`);
        packs.push({ dataset: d, quarters: normalize(d.facts) });
      }
      downloadText("stocks-ai-analysis-pack.md", buildCombinedPack(packs));
      setPackStatus(
        `已下載 ${packs.length} 檔 AI 分析包（stocks-ai-analysis-pack.md）`,
      );
    } catch (e) {
      setPackStatus("");
      setError(`匯出失敗：${(e as Error).message}`);
      return;
    }
    setTimeout(() => setPackStatus(""), 5000);
  }
  function downloadPack() {
    if (!dataset) return;
    downloadText(
      `${ticker}-ai-analysis-pack.md`,
      buildAnalysisPack(dataset, quarters),
    );
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
    screener: "選股篩選",
    compare: "多股比較",
    valuation: "估值",
    gurus: "13F 大師",
    market: "台美估值",
    portfolio: "我的持股",
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
    GOOG: "#2b9a6b",
    AMD: "#d55353",
    AMZN: "#c78b2c",
    META: "#397de3",
    PLTR: "#3c4252",
    MU: "#715bc6",
    TSLA: "#d84e50",
  };
  const color = stockColors[ticker] ?? "#5376e5";
  const shortMoney = (n: number | null | undefined) =>
    n == null
      ? "N/A"
      : `${currency === "TWD" ? "NT$" : "$"}${Math.abs(n) >= 1e8 ? (n / 1e8).toLocaleString("zh-TW", { maximumFractionDigits: 2 }) + " 億" : (n / 1e6).toLocaleString("zh-TW", { maximumFractionDigits: 1 }) + " 百萬"}`;
  // KPI 卡：金額不帶幣別符號、≥ 1 兆改用「兆」，幣別寫在數字下方，手機上不會超出卡片。
  const compactMoney = (n: number) =>
    Math.abs(n) >= 1e12
      ? { text: (n / 1e12).toLocaleString("zh-TW", { maximumFractionDigits: 2 }), scale: "兆" }
      : Math.abs(n) >= 1e8
        ? { text: (n / 1e8).toLocaleString("zh-TW", { maximumFractionDigits: 2 }), scale: "億" }
        : { text: (n / 1e6).toLocaleString("zh-TW", { maximumFractionDigits: 1 }), scale: "百萬" };
  const kpiValue = (k: { value: number | null; unit: string }) => {
    if (k.value === null) return { text: "N/A", note: "" };
    if (k.unit === "USD") {
      const m = compactMoney(k.value);
      return { text: m.text, note: `${m.scale}${currencyLabel}` };
    }
    if (k.unit.endsWith("/shares"))
      return { text: k.value.toFixed(2), note: `${currencyLabel}／股` };
    return { text: displayFormat(k.value, k.unit), note: "" };
  };
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
        <strong>{kpiValue(k).text}</strong>
        {/* 沒有單位的卡也保留同高度的一行，四張卡上下對齊 */}
        <small className="metric-card-unit">
          {kpiValue(k).note ? `單位：${kpiValue(k).note}` : "\u00a0"}
        </small>
        <span className="metric-card-foot">
          <span>{k.period ?? last(quarters, k.metric)?.end ?? "尚無可用期間"}</span>
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
          <button
            className="watchlist-export"
            aria-label="一鍵匯出股票 AI 分析包"
            title={
              listFilter === "favorites"
                ? "匯出已收藏股票 AI 分析包"
                : "匯出全部股票 AI 分析包"
            }
            onClick={() => void exportAllPacks()}
          >
            <Sparkles size={14} />
            一鍵匯出
          </button>
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
                  color: "#fff",
                  background: stockColors[c.ticker] ?? "#5376e5",
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
                <button onClick={() => void exportAllPacks()}>
                  <Sparkles size={16} />
                  {listFilter === "favorites"
                    ? "匯出已收藏股票 AI 分析包"
                    : "匯出全部股票 AI 分析包"}
                </button>
                <button disabled={!packReady} onClick={downloadPack}>
                  <Sparkles size={16} />
                  下載 AI 分析包（.md）
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
                style={{ background: color, color: "#fff" }}
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
              <button
                className="button export-main ai-pack"
                aria-label="複製 AI 分析包"
                disabled={!packReady}
                onClick={() => void copyPack()}
              >
                <Sparkles size={15} />
                <span>複製 AI 分析包</span>
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
          {packStatus && (
            <div className="notice" role="status">
              {packStatus}
            </div>
          )}
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
                不可合併。ROE／ROA 只用 6-K 的 TIFRS 季度損益與資產負債表計算；本益比、股價淨值比按
                1 ADR = 5 股普通股與國際清算銀行（BIS）公布的 USD/TWD 匯率換算成每 ADR 美元。請注意財報截至日期。
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
            <Suspense fallback={<div className="panel muted" aria-busy="true">載入中…</div>}>
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
                <Scorecard items={scoreItems} asOf={latestDate ?? null} />
                <div className="dashboard-kpis">
                  {primaryMetrics.map(metricCard)}
                </div>
                <EarningsCall
                  base={base}
                  ticker={ticker}
                  quarters={quarters}
                  shareUnit={shareUnit}
                />
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
                              {k.period ?? last(quarters, k.metric)?.end ?? "尚無可用期間"}
                            </small>
                          </span>
                          <strong>
                            {displayFormat(k.value, k.unit)}
                            <ChevronRight size={14} />
                          </strong>
                        </button>
                      ))}
                    </section>
                    <ChartGuideBox guide={isFinancial ? BANK_GUIDE : SNAPSHOT_GUIDE} label="怎麼看這些指標" />
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
                <StockSnapshot
                  base={base}
                  ticker={ticker}
                  onGurus={() => navigate("gurus")}
                  official={officialQuote}
                />
                <section className="price-callout">
                  <div>
                    <ChartCandlestick size={20} />
                    <span>
                      {lastPrice
                        ? autoPrice
                          ? `${ticker} 收盤價 $${autoPrice.close.toFixed(2)} · ${autoPrice.asof}（${autoPrice.source ?? "Stooq"}）`
                          : `${ticker} 匯入收盤價 $${lastPrice.close.toFixed(2)} · ${lastPrice.date}`
                        : "想一起研究價格與估值？"}
                      <small>
                        {autoPrice
                          ? `${autoPrice.prev_close ? `前一交易日 ${displayFormat(growth(autoPrice.close, autoPrice.prev_close), "%")} · ` : ""}${prevPrice ? `近一週 ${displayFormat(growth(lastPrice!.close, prevPrice.close), "%")} · ` : ""}本益比 ${peValue !== null ? `${peValue.toFixed(1)}×` : "N/A"} · 每週自動更新，非即時報價`
                          : lastPrice && prevPrice
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
                    <strong>
                      {revenueCagr(5) !== null ? (
                        displayFormat(revenueCagr(5), "%")
                      ) : (
                        <small>
                          年度資料自 {annualRevenue[0]?.end.slice(0, 4) ?? "—"} 年起，不足 5 年
                        </small>
                      )}
                    </strong>
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
                    {isFinancial
                      ? chart("現金與存款", ["cash", "deposits"])
                      : chart("現金及約當現金", ["cash"])}
                  </div>
                  <div className="notice">
                    <CircleHelp size={18} />
                    <p>
                      總負債不等於有息負債：要付利息的借款見下方「長短期金融借款」。帳面每股淨值僅使用同一資產負債表日的權益與股數。
                    </p>
                  </div>
                  <div className="mini-metrics">
                    <span>
                      每股淨值{" "}
                      <strong>
                        {displayFormat(
                          bookPerShare ? bookPerShare.value : null,
                          "USD/shares",
                        )}
                      </strong>
                      {bookPerShare && (
                        <small className="muted">
                          {bookPerShare.end} · 股數採
                          {labels[bookPerShare.kind]}
                        </small>
                      )}
                    </span>
                    <span>
                      最新資產{" "}
                      <strong>{displayFormat(endingAssets?.value)}</strong>
                    </span>
                  </div>
                  <HealthPanels
                    dark={dark}
                    quarters={quarters}
                    unit={unit}
                    unitLabel={unitLabel}
                    isFinancial={isFinancial}
                    years={years}
                  />
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
                                {last(quarters, m)
                                  ? displayFormat(last(quarters, m)!.value, last(quarters, m)!.unit)
                                  : "—"}
                              </strong>
                              <small>
                                {last(quarters, m)?.end ??
                                  (m === "allowance"
                                    ? "未以本站對應的備抵科目申報（部分放款採公允價值衡量，不提列備抵）"
                                    : "本期未揭露")}
                              </small>
                            </div>
                          ))}
                          {missingBanking.map((m) => {
                            const c = bankComputed[m];
                            return (
                              <div key={m}>
                                {m}
                                <strong>{c ? c.text : "—"}</strong>
                                <small>{c ? c.note : "官方財報新聞稿有揭露，本站尚未解析（不以估計值代替）"}</small>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    )}
                  </div>
                </section>
                <ChartGuideBox guide={BANK_GUIDE} label="怎麼看這些指標" />
              </>
            )}
            {section === "screener" && (
              <Screener
                catalog={catalog}
                base={base}
                colors={stockColors}
                onSelect={(t) => {
                  selectCompany(t);
                  navigate("overview");
                }}
              />
            )}
            {section === "compare" && (
              <Compare
                catalog={catalog}
                base={base}
                dark={dark}
                current={ticker}
                colors={stockColors}
              />
            )}
            {section === "valuation" && (
              <>
                <section id="valuation">
                  <SectionTitle eyebrow="VALUATION LAB" title="估值研究" />
                  <div className="panel import-panel">
                    <div>
                      <h3>
                        {autoPrice
                          ? "已載入每週自動更新的股價"
                          : "使用你有權使用的歷史股價"}
                      </h3>
                      <p className="muted">
                        {autoPrice
                          ? `近 5 年週收盤（${autoPrice.source ?? "Stooq"} 免費日線，已按股票分割調整、未還原股息），僅供個人研究，非即時報價。分割前申報的 EPS 會換算成目前股數基礎再計算本益比。也可以匯入你自己的 CSV 覆蓋。`
                          : "這檔目前沒有自動股價（或你已匯入自己的資料）。CSV 僅在本次瀏覽器工作階段使用，不會上傳。"}
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
                          {autoPrice ? "已載入" : "已匯入"} {prices.length} 筆 ·
                          截至 {lastPrice.date}
                          <br />
                          來源：{lastPrice.source}
                          {autoPrice && splits.length > 0 && (
                            <>
                              <br />
                              分割事件：
                              {splits
                                .map((x) => `${x.date}（1 拆 ${x.ratio}）`)
                                .join("、")}
                            </>
                          )}
                          {priceImported && (
                            <>
                              <br />
                              匯入時間：{priceImported}
                            </>
                          )}
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
                  <ExternalValuationPanel
                    base={base}
                    ticker={ticker}
                    dark={dark}
                  />
                  <ValuationTools base={base} ticker={ticker} />
                  <IntrinsicValue
                    base={base}
                    ticker={ticker}
                    dark={dark}
                    quarters={quarters}
                    raw={adjRaw}
                    isFinancial={isFinancial}
                    fallbackRows={autoQuarterPrices}
                  />
                  {riverDates.length > 0 && (
                    <FinancialChart
                      title={`本益比估值河流圖（${autoPrice ? "自動週收盤" : "你匯入的股價"}）`}
                      dates={riverDates.map((r) => r.date)}
                      dark={dark}
                      unit={isAdr ? "美元／ADR" : "美元／股"}
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
                  )}
                  {riverDates.length > 0 && (
                    <FinancialChart
                      title="股價 × TTM EPS 疊圖"
                      dates={riverDates.map((r) => r.date)}
                      dark={dark}
                      unit="股價（美元）"
                      secondaryUnit={isAdr ? "TTM EPS（美元／ADR）" : "TTM EPS（美元／股）"}
                      dualAxis
                      initialType="line"
                      series={[
                        {
                          name: "歷史收盤價",
                          values: riverDates.map((r) => r.price),
                        },
                        {
                          name: "TTM EPS（公布翌日起生效）",
                          values: riverDates.map((r) => r.eps),
                        },
                      ]}
                    />
                  )}
                  <p className="muted small">
                    分位數採截至各交易日的擴展樣本，不引用未來股價。EPS ≤
                    0、缺季度或分割口徑未確認時不得作正 PE 結論。Adjusted /
                    Normalized EPS（排除一次性項目的調整後 EPS）尚無可靠官方資料，本站一律使用 GAAP EPS。
                  </p>
                  <WaccPanel
                    key={ticker}
                    sector={company.sector}
                    defaults={waccDefaults}
                  />
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
                                missing={missingReason}
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
                  <Supplement base={base} ticker={ticker} />
                </section>
              </>
            )}
            {section === "gurus" && (
              <Gurus
                base={base}
                catalog={catalog}
                onSelect={(t) => {
                  selectCompany(t);
                  navigate("overview");
                }}
              />
            )}
            {section === "market" && (
              <Market
                base={base}
                dark={dark}
                onSelect={(t) => {
                  selectCompany(t);
                  navigate("overview");
                }}
              />
            )}
            {section === "portfolio" && (
              <Portfolio
                base={base}
                onSelect={(t) => {
                  selectCompany(t);
                  navigate("overview");
                }}
              />
            )}
            {section === "sources" && (
              <>
                <section id="sources">
                  <SectionTitle
                    eyebrow="RESEARCH INTEGRITY"
                    title="研究風險與資料來源"
                  />
                  <Reconciliation base={base} />
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
            </Suspense>
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
          { id: "compare", label: "比較", icon: Layers3 },
          { id: "valuation", label: "估值", icon: ChartCandlestick },
        ].map((s) => (
          <button
            key={s.id}
            className={
              section === s.id ||
              (s.id === "income" &&
                ["cashflow", "balance", "banking"].includes(section)) ||
              (s.id === "compare" && section === "screener")
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
  missing,
}: {
  title: string;
  metrics: string[];
  dates: string[];
  get: (m: string, d: string) => number | null;
  fact: (m: string, d: string) => Fact | null;
  unit: number;
  shareUnit: string;
  onDetail: (f: Fact) => void;
  /** 空格的原因：不適用、公司未申報此科目、或該期未揭露。 */
  missing?: (m: string, d: string) => { text: string; title: string };
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
              const why = v === null ? (missing?.(m, d) ?? { text: "未揭露", title: "該期沒有相容的官方數字" }) : null;
              return (
                <td key={d} className={v !== null && v < 0 ? "negative" : why ? "muted" : ""}>
                  <button
                    disabled={!f}
                    title={why ? why.title : "查看申報來源"}
                    onClick={() => f && onDetail(f)}
                  >
                    {why
                      ? why.text
                      : (v! / metricScale(m, unit)).toLocaleString("zh-TW", {
                          maximumFractionDigits: 2,
                        })}
                  </button>
                </td>
              );
            })
          ) : (
            <td className="muted">尚無期間</td>
          )}
        </tr>
      ))}
    </>
  );
}
function WaccPanel({
  sector,
  defaults,
}: {
  sector: string;
  defaults: Record<string, { value: number; src: string }>;
}) {
  const keys = ["ebit", "tax", "capital", "equity", "debt", "rf", "beta", "erp", "kd"];
  const [v, setV] = useState<Record<string, string>>(() =>
    Object.fromEntries(keys.map((k) => [k, defaults[k] ? String(defaults[k].value) : ""])),
  );
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
        已依本站官方財報、自動股價與研究資料預填（每格下方註明來源），全部可自行改寫。ROIC =
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
            {defaults[k] && (
              <small className="muted">
                {String(defaults[k].value) === v[k] ? "預填：" : "你已修改；原預填："}
                {defaults[k].src}
              </small>
            )}
          </label>
        ))}
      </div>
      <div className="mini-metrics">
        <span>
          NOPAT <strong>{valid ? nopat.toLocaleString("zh-TW", { maximumFractionDigits: 0 }) + " 百萬美元" : "—"}</strong>
        </span>
        <span>
          股權成本 <strong>{pctOrDash(valid ? ke : null)}</strong>
        </span>
        <span>
          ROIC <strong>{pctOrDash(roic)}</strong>
        </span>
        <span>
          WACC <strong>{pctOrDash(wacc)}</strong>
        </span>
        <span>
          利差{" "}
          <strong>
            {pctOrDash(roic !== null && wacc !== null ? roic - wacc : null)}
          </strong>
        </span>
      </div>
      <p>
        {valid
          ? `在你輸入的假設下，每投入 100 美元資本，年化 NOPAT 為 ${(roic! * 100).toFixed(2)} 美元，資金成本為 ${(wacc! * 100).toFixed(2)} 美元。`
          : sector === "fintech"
            ? "金融機構的營業利益與投入資本定義不同（存款即營運資金），ROIC／WACC 不適用一般解讀，因此不預填；仍可自行輸入試算。"
            : "請輸入完整且有效的假設，才會產生計算結果。"}
      </p>
    </details>
  );
}

const pctOrDash = (v: number | null) =>
  v === null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`;
