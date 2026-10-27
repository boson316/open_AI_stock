import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
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
};
const base = import.meta.env.BASE_URL;
type Mode = "quarter" | "annual" | "ttm";
type Transform = "value" | "yoy" | "qoq";
type Detail = { title: string; description: string; facts: Fact[] };
const isRatio = (metric: string) => metric === "nim" || metric === "cet1";
const metricScale = (metric: string, currencyScale: number) => isRatio(metric) ? .01 : ["eps","shares","members","products"].includes(metric) ? 1 : currencyScale;
const metricUnit = (metric: string, currencyUnit: string) => isRatio(metric) ? "%" : metric === "eps" ? "美元／股" : metric === "shares" ? "股" : ["members","products"].includes(metric) ? "人／項" : currencyUnit;

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
  const quarters = useMemo(() => normalize(dataset?.facts ?? []), [dataset]);
  const view = useMemo(
    () => (mode === "annual" ? annual(raw) : quarters),
    [mode, raw, quarters],
  );
  const latestDate = quarters
    .map((f) => f.end)
    .sort()
    .at(-1);
  const cutoff = latestDate
    ? `${Number(latestDate.slice(0, 4)) - years}${latestDate.slice(4)}`
    : "";
  const dates = [
    ...new Set(
      view.filter((f) => !f.start || f.start <= f.end).map((f) => f.end),
    ),
  ]
    .filter((d) => d >= cutoff)
    .sort();
  const unitLabel =
    unit === 1e6 ? "百萬美元" : unit === 1e8 ? "億美元" : "美元";
  function aligned(metric: string, end: string) {
    return view.find((f) => f.metric === metric && f.end === end) ?? null;
  }
  function value(metric: string, end: string): number | null {
    const f = aligned(metric, end);
    if (!f) return null;
    if (mode !== "ttm" || instant.has(metric) || metric === "nim") return f.value;
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
        const days = (Date.parse(d)-Date.parse(previousEnd))/86400000;
        if (mode === "annual" ? days < 350 || days > 380 : days < 70 || days > 105) return null;
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
            ? "美元／股"
            : unitLabel
          : "%"
      }
      dualAxis={dualAxis && transform === "value"}
    />
  );
  const revenue = sumTTM(quarters, "revenue"),
    income = sumTTM(quarters, "net_income"),
    eps = sumTTM(quarters, "eps");
  const endingEquity = last(quarters, "equity"),
    endingAssets = last(quarters, "assets");
  function returnOn(metric: string) {
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
    const earnings = ttm(
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
    !!lastPrice &&
    !!latestDate &&
    lastPrice.date >= latestDate &&
    (Date.parse(lastPrice.date) - Date.parse(latestDate)) / 86400000 <= 180;
  const peValue =
    matchedLatest && eps !== null && eps > 0
      ? divide(lastPrice!.close, eps)
      : null;
  const equityForPB =
    endingEquity && endingEquity.filed < (lastPrice?.date ?? "") && lastPrice && (Date.parse(lastPrice.date)-Date.parse(endingEquity.end))/86400000 <= 180
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
      title: "TTM 營業收入",
      value: revenue,
      unit: "USD",
      metric: "revenue",
      desc: "四個連續且相容的單季營收之和；缺任一季不計算。",
    },
    {
      title: "營收年增率",
      value: yoy(quarters, "revenue"),
      unit: "%",
      metric: "revenue",
      desc: "本季營收 ÷ 去年同期營收 − 1；去年值非正數時 N/A。",
    },
    {
      title: "稀釋 EPS · TTM",
      value: eps,
      unit: "USD/shares",
      metric: "eps",
      desc: "四個已公布單季 GAAP 稀釋 EPS 合計。不從累積 EPS 相減，股數變動時不等同全年加權 EPS。",
    },
    {
      title: "EPS 年增率",
      value: yoy(quarters, "eps"),
      unit: "%",
      metric: "eps",
      desc: "本季 GAAP 稀釋 EPS ÷ 去年同期 EPS − 1；去年值非正數時 N/A。",
    },
    {
      title: "TTM 稅後淨利",
      value: income,
      unit: "USD",
      metric: "net_income",
      desc: "四個連續單季稅後淨利合計。",
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
      value: last(quarters,"nim")?.value ?? null,
      unit: "%",
      metric: "nim",
      desc: "平均生息資產與淨利息收入之比。採官方季度平均餘額表揭露的淨利差，不使用期末資產推算。",
    },
    {
      title: "CET1 資本適足率",
      value: last(quarters,"cet1")?.value ?? null,
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
      : `本季營收較去年同期${revenueGrowth >= 0 ? "增加" : "減少"} ${Math.abs(revenueGrowth * 100).toFixed(1)}%。此變化需要查閱財報附註確認原因。`;
  const riverRows = useMemo(() => river(raw, prices), [raw, prices]);
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
  const tableMetrics = Object.values(financialGroups).flat();
  function exportTable() {
    csvDownload(`${ticker}-${mode}.csv`, [
      ["指標", "單位", ...dates],
      ...tableMetrics.map((m) => [
        labels[m],
        metricUnit(m,unitLabel),
        ...dates.map((d) => {
          const v = value(m, d);
          return v === null
            ? null
            : v / metricScale(m,unit);
        }),
      ]),
    ]);
  }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a
          className="brand"
          href="#overview"
          onClick={() => setSection("overview")}
        >
          <span className="brand-icon">
            <BarChart3 size={22} />
          </span>
          <span>
            OpenStock<small>ANALYTICS</small>
          </span>
        </a>
        <p className="nav-label">RESEARCH WORKSPACE</p>
        <nav aria-label="研究導覽">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={section === s.id ? "active" : ""}
              onClick={() => {
                setSection(s.id);
                setMobile(false);
              }}
            >
              <s.icon size={18} />
              {s.label}
              {section === s.id && <ChevronRight size={15} />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="source-badge">
            <ShieldCheck size={17} />
            <span>公開資料 · 透明方法</span>
          </div>
          <p>
            免費、開放的財報研究工具
            <br />
            每個數字，都應有據可查。
          </p>
          <a
            href="https://github.com/boson316/open_AI_stock"
            target="_blank"
            rel="noreferrer"
          >
            GitHub 專案 <ArrowUpRight size={13} />
          </a>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-toggle"
              aria-label="開啟選單"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={20} />
            </button>
            <span>研究工作台</span>
            <ChevronRight size={14} />
            <strong>{sections.find((s) => s.id === section)?.label}</strong>
          </div>
          <div className="header-tools">
            <div className="search-wrap">
              <Search size={16} />
              <input
                aria-label="搜尋股票"
                placeholder="搜尋公司或代號…"
                value={query}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchOpen(true);
                }}
              />
              <kbd>⌕</kbd>
              {searchOpen && (
                <div className="search-results">
                  <button
                    className="close-search"
                    onClick={() => setSearchOpen(false)}
                  >
                    關閉
                  </button>
                  {results.length ? (
                    results.map((c) => (
                      <button
                        key={c.ticker}
                        onClick={() => {
                          if (c.available || c.ticker === "SOFI") {
                            setTicker(c.ticker);
                            setQuery("");
                          } else
                            setError(
                              `${c.ticker} 尚未收錄。請先執行資料生成指令並通過驗證。`,
                            );
                          setSearchOpen(false);
                        }}
                      >
                        <strong>{c.ticker}</strong>
                        <span>{c.name}</span>
                        <small>{c.available ? "可用" : "尚未收錄"}</small>
                      </button>
                    ))
                  ) : (
                    <p>尚未收錄此股票</p>
                  )}
                </div>
              )}
            </div>
            <button
              className="icon-button"
              aria-label="切換深色模式"
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <span className="avatar">OS</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="eyebrow">EQUITY RESEARCH / {ticker}</p>
              <h1>讓財報，成為洞察。</h1>
              <p className="muted">
                從官方申報出發，理解企業的成長、獲利與風險。
              </p>
            </div>
            <div className="heading-actions">
              <label className="button secondary">
                <Upload size={15} />
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
              <button className="button primary" onClick={exportTable}>
                <ArrowDownToLine size={15} />
                匯出財務資料
              </button>
            </div>
          </div>
          {error && (
            <div className="notice error" role="alert">
              {error}
              <button aria-label="關閉錯誤" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          <section id="overview" className="panel company-overview">
            <div className="company-intro">
              <div className="company-monogram">{ticker.slice(0, 2)}</div>
              <div>
                <div className="company-title">
                  <h2>{company.name}</h2>
                  <span className="ticker-pill">{ticker}</span>
                </div>
                <p className="muted small">
                  {company.exchange} <span className="dot">·</span>{" "}
                  {company.sector === "fintech"
                    ? "金融科技 / 銀行業務"
                    : company.sector === "semiconductor"
                      ? "半導體"
                      : "科技"}{" "}
                  <span className="dot">·</span> 美國美元 USD
                </p>
              </div>
            </div>
            <div className="price">
              <strong>
                {lastPrice ? `$${lastPrice.close.toFixed(2)}` : "N/A"}
              </strong>
              <span className="muted small">
                {lastPrice
                  ? `${lastPrice.date} 收盤價 · 使用者匯入`
                  : "尚無已授權股價資料"}
              </span>
              {lastPrice && prevPrice && (
                <span>
                  {format(growth(lastPrice.close, prevPrice.close), "%")}
                  （相鄰匯入交易日）
                </span>
              )}
            </div>
            <div className="data-status">
              <span className={`status ${dataset ? "ok" : ""}`}>
                <span />
                {loading
                  ? "載入中"
                  : dataset
                  ? imported ? "使用者匯入財報" : "已載入 SEC 財報"
                    : "等待官方財報"}
              </span>
              <p>財報截至 {latestDate ?? "N/A"}</p>
              <p>更新 {dataset?.updated.slice(0, 10) ?? "N/A"}</p>
            </div>
          </section>
          {imported && <div className="notice">這是使用者匯入的財報資料，僅通過格式檢查，尚未向 SEC 核實內容。請逐項核對官方申報來源。</div>}
          <div className="insight">
            <span className="insight-icon">
              <Activity size={19} />
            </span>
            <div>
              <strong>財報觀察</strong>
              <p>{summary}</p>
            </div>
            <span className="tag">規則分析</span>
          </div>
          {!dataset && !loading && (
            <div className="notice">
              <Database size={19} />
              <div>
                <strong>資料尚未收錄，研究介面已就緒</strong>
                <p>
                  請以正式 SEC 聯絡資訊執行資料更新，或匯入管線產生的財報
                  JSON。所有缺值保留 N/A；這裡不使用示範財務數字。
                </p>
                <code>python -m openstock.pipeline --ticker {ticker}</code>
              </div>
            </div>
          )}
          <div className="section-title">
            <div>
              <span className="eyebrow">AT A GLANCE</span>
              <h2>核心財務指標</h2>
            </div>
            <span className="muted small">
              點選卡片查看定義與申報來源 <CircleHelp size={14} />
            </span>
          </div>
          <div className="kpi-grid">
            {kpis.map((k) => (
              <button
                className="kpi panel"
                key={k.title}
                onClick={() =>
                  setDetail({
                    title: k.title,
                    description: k.desc,
                    facts: quarters
                      .filter((f) => f.metric === k.metric)
                      .slice(-8),
                  })
                }
              >
                <div className="kpi-label">
                  {k.title}
                  <ArrowUpRight size={15} />
                </div>
                <strong>{format(k.value, k.unit)}</strong>
                <div className="kpi-footer">
                  <span>{last(quarters, k.metric)?.end ?? "期間 N/A"}</span>
                  <span className={k.value === null ? "muted" : "accent"}>
                    {k.value === null ? "資料不足" : "查看來源"}
                  </span>
                </div>
              </button>
            ))}
          </div>
          <section id="banking" className="sector-note">
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
              <details>
                <summary>查看金融機構專屬指標與缺值</summary>
                <div className="bank-grid">
                  {financialGroups.banking.map((m) => (
                    <div key={m}>
                      {labels[m]}
                      <strong>
                        {format(
                          last(quarters, m)?.value,
                          last(quarters, m)?.unit,
                        )}
                      </strong>
                      <small>{last(quarters, m)?.end ?? "尚未取得"}</small>
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
            </div>
          </section>
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
                <option value={1e6}>百萬美元</option>
                <option value={1e8}>億美元</option>
                <option value={1}>美元</option>
              </select>
            </div>
          </div>
          <section id="income">
            <SectionTitle eyebrow="EARNINGS & GROWTH" title="損益與成長分析" />
            <div className="chart-grid">
              {chart("營收與淨利", ["revenue", "net_income"])}
              {chart("營業利益與每股盈餘", ["operating_income", "eps"], true)}
            </div>
            <div className="chart-grid">
              <RatioChart
                title="獲利能力"
                dates={dates}
                dark={dark}
                get={(m, d) => value(m, d)}
                series={[
                  ["毛利率", "gross_profit", "revenue"],
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
                      const n = (Date.parse(d) - Date.parse(p)) / 86400000;
                      return n >= 350 && n <= 380;
                    });
                    const g = growth(value(m, d), prev ? value(m, prev) : null);
                    return g === null ? null : g * 100;
                  }),
                }))}
              />
            </div>
          </section>
          <div className="mini-metrics">
            <span>
              營收 3 年 CAGR<strong>{format(revenueCagr(3), "%")}</strong>
            </span>
            <span>
              營收 5 年 CAGR<strong>{format(revenueCagr(5), "%")}</strong>
            </span>
          </div>
          <RuleAnalysis facts={quarters} />
          <section id="cashflow">
            <SectionTitle eyebrow="CASH FLOW" title="現金流分析" />
            <div className="chart-grid">
              {chart("現金流結構", ["ocf", "icf", "financing_cf"])}
              <FinancialChart
                title="自由現金流與股票薪酬"
                dark={dark}
                dates={dates}
                unit={unitLabel}
                series={[
                  {
                    name: "自由現金流（金融機構解釋有限）",
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
                    name: "FCF／營收（金融機構解釋有限）",
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
          <section id="balance">
            <SectionTitle eyebrow="BALANCE SHEET" title="資產與負債結構" />
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
                  {format(
                    endingEquity && sharesForPB?.end === endingEquity.end
                      ? divide(endingEquity.value, sharesForPB.value)
                      : null,
                    "USD/shares",
                  )}
                </strong>
              </span>
              <span>
                最新資產 <strong>{format(endingAssets?.value)}</strong>
              </span>
            </div>
          </section>
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
                GAAP 稀釋 EPS · 公布翌日起生效 · 當時可得資料 · 至少 20 筆有效
                PE 後產生分位數
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
                { name: "歷史收盤價", values: riverDates.map((r) => r.price) },
              ]}
            />
            <p className="muted small">
              分位數採截至各交易日的擴展樣本，不引用未來股價。EPS ≤
              0、缺季度或分割口徑未確認時不得作正 PE 結論。Adjusted / Normalized
              EPS 尚無可靠資料，維持 N/A。
            </p>
            <WaccPanel sector={company.sector} />
          </section>
          <section id="statements">
            <SectionTitle eyebrow="FINANCIAL STATEMENTS" title="完整財務報表" />
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
                <button className="button secondary" onClick={exportTable}>
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
                        dates.map((d) => <th key={d}>{d}</th>)
                      ) : (
                        <th>期間 N/A</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(financialGroups).map(([group, metrics]) => (
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
                        dates={dates}
                        get={value}
                        fact={aligned}
                        unit={unit}
                        onDetail={(f) =>
                          setDetail({
                            title: labels[f.metric],
                            description:
                              "數值與期間、申報版本及原始標籤可追溯。衍生單季請核對計算血緣。",
                            facts:
                              mode === "ttm" && !instant.has(f.metric) && !isRatio(f.metric)
                                ? quarters
                                    .filter(
                                      (x) =>
                                        x.metric === f.metric && x.end <= f.end,
                                    )
                                    .slice(-4)
                                : [f],
                          })
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
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
                  金融機構研究模型預定權重：獲利 20%、成長 15%、財務強度
                  15%、信用風險 20%、資本適足 20%、估值
                  10%。缺少任何維度即不計總分；目前尚未校準評分門檻，不提供客觀排名。
                </p>
              </div>
              <div className="panel prose">
                <h3>值得追蹤的風險</h3>
                <ul>
                  <li>
                    個人貸款信用品質、淨沖銷及逾期率：目前缺官方解析值，無法判定趨勢。
                  </li>
                  <li>
                    存款成本與資本適足率：需核對銀行子公司及母公司的報告口徑。
                  </li>
                  <li>
                    一次性損益、收購、股數稀釋與重編：需查閱財報附註，不能僅由總額推斷原因。
                  </li>
                  <li>
                    下一季觀察：營收、稀釋
                    EPS、存款、信用成本及資本適足率的同口徑變化。
                  </li>
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
                    "https://data.sec.gov/api/xbrl/companyfacts/CIK0001818874.json"
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  官方 Company Facts ↗
                </a>{" "}
                <a
                  href="https://www.sec.gov/os/accessing-edgar-data"
                  target="_blank"
                  rel="noreferrer"
                >
                  Fair Access Policy ↗
                </a>
              </p>
              <p className="muted">
                Company Facts
                並未完整涵蓋公司自訂及分部指標。管線可依明確映射解析官方 Inline
                XBRL 的合併報表數值；未驗證的自訂及分部欄位一律 N/A。TSM 的 20-F
                / 6-K、IFRS 與 ADR
                口徑尚待支援，不列為可用。所有顯示數值均提供申報日期、期間、單位及來源；資料更新失敗時保留上一有效版本。
              </p>
              {dataset?.warnings.map((w) => (
                <p className="small muted" key={w}>
                  • {w}
                </p>
              ))}
            </div>
          </section>
          <footer>
            <span className="footer-brand">
              <BarChart3 size={17} />
              OpenStock Analytics
            </span>
            <span>公開資料，審慎研究。僅供研究輔助，不構成投資建議。</span>
            <span>繁體中文 · USD</span>
          </footer>
        </main>
      </div>
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
                    {format(f.value, f.unit)} · {f.end}
                  </strong>
                  <dl>
                    <dt>會計期間</dt>
                    <dd>
                      {f.start ?? "時點"} → {f.end}
                    </dd>
                    <dt>申報日</dt>
                    <dd>{f.filed}</dd>
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
  onDetail,
}: {
  title: string;
  metrics: string[];
  dates: string[];
  get: (m: string, d: string) => number | null;
  fact: (m: string, d: string) => Fact | null;
  unit: number;
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
            title={`${labels[m]}；${metricUnit(m,"所選美元單位")}`}
          >
            {labels[m]}
            <small>
              {metricUnit(m,"")}
            </small>
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
                      : (
                          v / metricScale(m,unit)
                        ).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}
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
