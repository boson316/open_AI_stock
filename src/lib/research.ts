import { useEffect, useState } from "react";

/** 使用者提供的外部研究資料（非 SEC 官方）；結構見 scripts/import_research.py。 */
export type ResearchCompany = {
  name_zh: string;
  latest_q: string;
  price: number;
  price_asof: string;
  close: number | null;
  close_asof: string;
  hi52: number | null;
  lo52: number | null;
  pe: number | null;
  fwd_pe: number | null;
  pb: number | null;
  ps: number | null;
  pfcf: number | null;
  mcap_100m_usd: number | null;
  pe_n: number;
  pe_min: number | null;
  pe_max: number | null;
  pe_median: number | null;
  pe_rank: number | null;
  basis: string | null;
};
export type ResearchQuarter = {
  quarter: string;
  end: string;
  pretax: number | null;
  acq: number | null;
  sec: number | null;
  buyback: number | null;
  div: number | null;
  cash: number | null;
  debt: number | null;
  net_cash: number | null;
  roe: number | null;
  roa: number | null;
  roic: number | null;
  pe: number | null;
  pb: number | null;
  ev_ebitda: number | null;
  de: number | null;
  cr: number | null;
  fcf_yield: number | null;
};
export type Scenario = {
  scenario: "cons" | "mid" | "opt";
  label: string;
  eps_cagr: number;
  exit_pe: number;
  years: number;
  hurdle: number;
  prem: number;
  basis: string;
};
export type Guru = {
  id: string;
  name: string;
  fund: string;
  quarter: string;
  aum_b: number | null;
  style: string;
  url: string;
  note: string;
};
export type GuruHolding = {
  manager: string;
  ticker: string;
  name: string;
  weight: number | null;
  chg: number | null;
  action: string;
  option: string | null;
  note: string;
};
export type Etf = {
  ticker: string;
  name_zh: string;
  name_en: string;
  issuer: string;
  index: string;
  price: number;
  price_note: string;
  expense: number;
  aum_b: number;
  pe: number | null;
  fwd_pe: number | null;
  div_yield: number | null;
  payout: string;
  inception: string;
  n_holdings: number;
  wk52_lo: number;
  wk52_hi: number;
  ret_1y: number;
  top10_total: number | null;
  top15_total: number | null;
  overlap_total: number | null;
  holdings_asof: string;
  close: number | null;
};
export type Research = {
  version: 1;
  as_of: string;
  note: string;
  companies: Record<string, ResearchCompany>;
  quarterly: Record<string, ResearchQuarter[]>;
  roic: Record<
    string,
    {
      beta: number;
      beta_src: string;
      beta_asof: string;
      erp: number;
      kd_spread: number;
      tax: number;
      note: string;
      debt_weight: number;
      roic_latest: number;
      roic_avg4: number;
      roic_quarter: string;
      debt_weight_note: string | null;
    }
  >;
  rf_us10y: number;
  scenarios: Record<string, Scenario[]>;
  risk: Record<string, { label: string; group: string; rate_risk: string; ai_exposure: string; buffer: string }>;
  commentary: Record<string, { kind: string; text: string }[]>;
  gurus: Guru[];
  guru_holdings: GuruHolding[];
  market: {
    metrics: {
      id: string;
      metric: string;
      unit: string;
      tw_now: number | null;
      tw_asof: string | null;
      tw_ref: number | null;
      tw_ref_label: string | null;
      tw_src: string | null;
      us_now: number | null;
      us_asof: string | null;
      us_ref: number | null;
      us_ref_label: string | null;
      us_src: string | null;
      note: string;
    }[];
    cape_us: { t: number; cape: number; label: string }[];
    cape_country: { country: string; cape_2026: number; cape_2025: number }[];
    yields: { id: string; label: string; tw: number; us: number; note: string }[];
    macro: { id: string; label: string; value: string; detail: string; asof: string; url: string }[];
  };
  etf: Etf[];
  etf_holdings: {
    etf: string;
    rank: number;
    name: string;
    weight: number;
    in_scope: number;
    lt_ticker: string | null;
  }[];
  defensive: {
    ticker: string;
    name: string;
    close: number;
    pe: number | null;
    fwd_pe: number | null;
    beta: number | null;
    div_yield: number | null;
    note: string;
  }[];
  checklist: { id: string; n: number; q: string; hint: string; where: string }[];
  reconciliation: {
    checked: number;
    matched: number;
    rule: string;
    mismatches: {
      ticker: string;
      quarter: string;
      end: string;
      field: string;
      official: number;
      external: number;
      unit: string;
    }[];
  };
};

const finiteOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));

/** 結構與數值檢查；不通過就整份拒絕，不顯示半套資料。 */
export function validateResearch(raw: unknown): Research {
  const d = raw as Research;
  const isMap = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  if (
    !d ||
    d.version !== 1 ||
    !isMap(d.companies) ||
    !isMap(d.quarterly) ||
    !isMap(d.commentary) ||
    !isMap(d.market) ||
    !isMap(d.reconciliation) ||
    ![d.gurus, d.guru_holdings, d.etf, d.etf_holdings, d.defensive, d.reconciliation?.mismatches].every(Array.isArray)
  )
    throw Error("研究資料格式無效");
  for (const [t, c] of Object.entries(d.companies)) {
    for (const k of ["price", "pe", "fwd_pe", "hi52", "lo52", "close"] as const)
      if (!finiteOrNull(c[k])) throw Error(`${t} ${k} 數值無效`);
    if (c.hi52 !== null && c.lo52 !== null && c.hi52 < c.lo52) throw Error(`${t} 52 週區間無效`);
  }
  for (const h of d.guru_holdings) {
    if (!d.gurus.some((g) => g.id === h.manager)) throw Error(`未知投資人 ${h.manager}`);
    if (!finiteOrNull(h.weight)) throw Error(`${h.manager} ${h.ticker} 比重無效`);
  }
  if (!Number.isFinite(d.rf_us10y)) throw Error("無風險利率無效");
  return d;
}

let cache: Promise<Research> | null = null;
export function loadResearch(base: string): Promise<Research> {
  cache ??= fetch(`${base}data/research.json`)
    .then((r) => {
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(validateResearch)
    .catch((e) => {
      cache = null;
      throw e;
    });
  return cache;
}

export function useResearch(base: string) {
  const [data, setData] = useState<Research | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    loadResearch(base)
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [base]);
  return { data, error };
}

/** 三情境估值：基期 EPS × (1+g)^n × 退出本益比 → 年化報酬；與所需 EPS 年增率。 */
export function scenarioReturn(price: number, baseEps: number, s: Pick<Scenario, "eps_cagr" | "exit_pe" | "years">) {
  if (!(price > 0) || !(baseEps > 0) || !(s.years > 0)) return null;
  const target = baseEps * (1 + s.eps_cagr / 100) ** s.years * s.exit_pe;
  return { target, annual: (target / price) ** (1 / s.years) - 1 };
}
export function requiredGrowth(price: number, baseEps: number, exitPe: number, years: number, hurdlePct: number) {
  if (!(price > 0) || !(baseEps > 0) || !(exitPe > 0) || !(years > 0)) return null;
  const needed = price * (1 + hurdlePct / 100) ** years;
  return (needed / (exitPe * baseEps)) ** (1 / years) - 1;
}

/** CAPM：Ke = rf + β × ERP；WACC = E/(D+E)·Ke + D/(D+E)·Kd·(1−t)。 */
export function wacc(input: { rf: number; beta: number; erp: number; kdSpread: number; tax: number; debtWeight: number }) {
  const ke = input.rf + input.beta * input.erp;
  const kd = (input.rf + input.kdSpread) * (1 - input.tax / 100);
  return { ke, kd, wacc: (1 - input.debtWeight) * ke + input.debtWeight * kd };
}
