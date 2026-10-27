import { divide, format, growth, last, yoy } from "../lib/finance";
import type { Fact } from "../lib/finance";
export function RuleAnalysis({ facts }: { facts: Fact[] }) {
  const latest = (m: string) => last(facts, m);
  const matchedRatio = (numerator: string, denominator: string) => {
    const a = latest(numerator),
      b = latest(denominator);
    return a && b && a.end === b.end ? divide(a.value, b.value) : null;
  };
  const trend = (metric: string) => {
    const g = yoy(facts, metric);
    return g === null
      ? "資料不足，無法比較去年同期。"
      : `年增率 ${format(g, "%")}。此變化需要查閱財報附註確認原因。`;
  };
  const depositGrowth = yoy(facts, "deposits");
  const deposits = latest("deposits"),
    cash = latest("cash");
  const n = latest("net_income"),
    r = latest("revenue");
  const before = facts
    .filter((f) => f.metric === "net_income" && f.end < (n?.end ?? ""))
    .at(-1);
  const incomeDelta = growth(n?.value ?? null, before?.value ?? null);
  const rules = [
    ["營收成長", trend("revenue")],
    ["EPS 與淨利", `稀釋 EPS：${trend("eps")} 淨利：${trend("net_income")}`],
    [
      "利潤率",
      `最新同期間淨利率 ${format(matchedRatio("net_income", "revenue"), "%")}。分子與分母期間不一致即不計算。`,
    ],
    [
      "現金流",
      `最近可得單季營業現金流為 ${format(latest("ocf")?.value)}（${latest("ocf")?.end ?? "期間 N/A"}）；金融機構的存放款變動會影響解讀。`,
    ],
    [
      "財務槓桿",
      `負債／資產 ${format(matchedRatio("liabilities", "assets"), "%")}。這是帳面比例，不能直接視為銀行資本適足率。`,
    ],
    [
      "資產負債表",
      `最新存款 ${format(deposits?.value)}（${deposits?.end ?? "N/A"}），現金 ${format(cash?.value)}（${cash?.end ?? "N/A"}）。未評估流動性監管門檻，不作安全性結論。`,
    ],
    [
      "估值",
      "須具備授權股價、當時已公布且為正的完整 TTM EPS 才能研究 PE；未滿足時不判斷高低估。",
    ],
    [
      "一次性項目",
      `最近兩個可得單季淨利增率 ${format(incomeDelta, "%")}。總額變化不足以辨識一次性損益，需查閱財報附註確認。`,
    ],
    [
      "產業風險",
      `存款年增率 ${format(depositGrowth, "%")}。信用損失、逾期及銀行子公司資本口徑需分別核對，不以存款成長推斷信用品質。`,
    ],
    [
      "下一季觀察",
      "追蹤同口徑營收、GAAP EPS、信用成本、存款成本及 CET1；缺資料時不產生方向性預測。",
    ],
  ];
  return (
    <details className="panel prose">
      <summary>規則式財報分析 · 10 項可追溯觀察</summary>
      <p className="muted small">
        依已載入資料計算；不使用 AI
        API，不推測變動原因。各輸入值可於財務報表與指標卡查閱申報來源。
      </p>
      <div className="rule-grid">
        {rules.map(([title, text]) => (
          <div key={title}>
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        ))}
      </div>
      {n && r && n.end !== r.end && (
        <p>營收與淨利的最新期間不同，淨利率維持 N/A。</p>
      )}
    </details>
  );
}
