import { useEffect, useState } from "react";
import { RiverBands } from "./RiverBands";

export type ExternalPoint = {
  date: string;
  label: string;
  price: number;
  eps_q: number | null;
  eps_ttm: number | null;
  pe: number | null;
  bands: number[] | null;
};
export type ExternalValuation = {
  version: 1;
  as_of: string;
  note: string;
  basis?: Record<string, string>;
  companies: Record<string, ExternalPoint[]>;
};

/** 最小驗證：結構、數值有限、價格為正、價格帶遞增；有問題的資料拒絕使用。 */
export function validateExternal(raw: unknown): ExternalValuation {
  const d = raw as ExternalValuation;
  if (!d || d.version !== 1 || typeof d.companies !== "object")
    throw Error("外部估值資料格式無效");
  for (const [t, rows] of Object.entries(d.companies)) {
    if (!Array.isArray(rows) || !rows.length) throw Error(`${t} 沒有資料`);
    for (const r of rows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) throw Error(`${t} 日期無效`);
      if (!Number.isFinite(r.price) || r.price <= 0)
        throw Error(`${t} ${r.date} 價格無效`);
      for (const v of [r.eps_q, r.eps_ttm, r.pe])
        if (v !== null && !Number.isFinite(v)) throw Error(`${t} ${r.date} 數值無效`);
      if (r.bands && r.bands.some((b, i) => !Number.isFinite(b) || (i > 0 && b < r.bands![i - 1])))
        throw Error(`${t} ${r.date} 價格帶無效`);
    }
  }
  return d;
}

export function ExternalValuationPanel({
  base,
  ticker,
  dark,
}: {
  base: string;
  ticker: string;
  dark: boolean;
}) {
  const [data, setData] = useState<ExternalValuation | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${base}data/external-valuation.json`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => setData(validateExternal(j)))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [base]);

  if (error) return <div className="notice error" role="alert">外部估值資料讀取失敗：{error}</div>;
  if (!data) return null;
  const rows = data.companies[ticker];
  if (!rows)
    return (
      <div className="notice">
        <div>
          <strong>{ticker} 沒有外部估值資料</strong>
          <p>
            目前外部提供的季末估值資料涵蓋 {Object.keys(data.companies).join("、")}
            。若要查看 {ticker} 的估值，請在下方匯入你有權使用的歷史股價 CSV。
          </p>
        </div>
      </div>
    );
  const basis = data.basis?.[ticker];
  const money = basis ? "美元／ADR" : "美元／股";
  return (
    <div className="external-valuation">
      <div className="notice">
        <div>
          <strong>外部提供的估值資料（非 SEC 官方）</strong>
          <p>
            季末收盤價、EPS 與歷史本益比分位價格帶來自使用者提供的外部資料，截至 {data.as_of}
            ；未逐筆向交易所核對，授權與再散布條件由提供者負責。季度 EPS 已與本站官方 SEC 資料逐季比對，差異皆不超過 0.03 美元（拆股前季度以拆股倍數換算後比對；TSM 為 ADR 口徑未比對）。
            {basis ? `${ticker}：${basis.replace(/。$/, "")}。` : ""}
            色帶為自家近 20 季本益比 P10–P90 等距切成六個倍數 × 各季 TTM EPS（配色仿財報狗，越往上代表股價隱含的本益比越高），TTM EPS ≤ 0 時留空。財報狗用自己的方法挑倍數，數值會和本頁不同。僅供研究，不構成投資建議。
          </p>
        </div>
      </div>
      <RiverBands ticker={ticker} rows={rows} dark={dark} unit={money} />
    </div>
  );
}
