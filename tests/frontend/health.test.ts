import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { Fact } from "../../src/lib/finance";
import { normalize, validateDataset } from "../../src/lib/finance";
import { cccHistory, ddm, debtHistory, piotroski, piotroskiHistory } from "../../src/lib/health";

const fact = (metric: string, value: number, end: string, start?: string): Fact =>
  ({
    metric, value, end, start: start ?? null, unit: "USD", filed: end, accession: "a", tag: `t:${metric}`,
    source: "https://www.sec.gov/x", form: "10-Q", quality: "reported", lineage: [],
  }) as unknown as Fact;

const qEnds = ["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31"];
const qStart = (end: string) => {
  const d = new Date(end);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() - 1).padStart(2, "0")}-01`;
};

function company(improving: boolean): Fact[] {
  const out: Fact[] = [];
  qEnds.forEach((end, i) => {
    const k = improving ? 1 + i * 0.05 : 1 - i * 0.03;
    const start = qStart(end);
    out.push(fact("revenue", 100 * k, end, start), fact("gross_profit", 50 * k * (improving ? 1 + i * 0.01 : 1 - i * 0.01), end, start));
    out.push(fact("cost_revenue", 100 * k - 50 * k, end, start), fact("net_income", 20 * k, end, start), fact("ocf", 25 * k, end, start));
    out.push(fact("assets", 1000, end), fact("shares", improving ? 100 : 100 + i, end));
    out.push(fact("current_assets", improving ? 300 + i * 10 : 300 - i * 10, end), fact("current_liabilities", 150, end));
    out.push(fact("long_term_debt", improving ? 200 - i * 10 : 200 + i * 10, end));
    out.push(fact("receivables", 40, end), fact("inventory", 60, end), fact("payables", 30, end), fact("cash", 500, end), fact("equity", 600, end));
  });
  return out;
}

it("Piotroski：體質全面改善得 9 分、全面惡化得低分", () => {
  const good = piotroski(company(true), "2026-12-31");
  expect(good.scorable).toBe(9);
  expect(good.score).toBe(9);
  const bad = piotroski(company(false), "2026-12-31");
  expect(bad.scorable).toBe(9);
  expect(bad.score).toBeLessThanOrEqual(3);
  expect(piotroskiHistory(company(true)).at(-1)!.end).toBe("2026-12-31");
});

it("現金週轉循環 = 應收天數 + 存貨天數 − 應付天數", () => {
  const last = cccHistory(company(true)).at(-1)!;
  expect(last.dso! + last.dio! - last.dpo!).toBeCloseTo(last.ccc!);
  expect(last.dso).toBeGreaterThan(0);
});

it("金融借款缺科目視為 0、合計正確", () => {
  const rows = debtHistory(company(true));
  expect(rows.at(-1)!.total).toBe(rows.at(-1)!.longTerm);
});

it("DDM：零成長時等於 D/(r−g) 的高登模型", () => {
  const v = ddm(2, 0.03, 0.03, 0.08)!.value;
  expect(v).toBeCloseTo((2 * 1.03) / 0.05, 6);
  expect(ddm(2, 0.03, 0.09, 0.08)).toBeNull();
});

it("缺少長期借款資料時，長期負債項目不白拿分", () => {
  const d = validateDataset(JSON.parse(readFileSync("public/data/MSFT.json", "utf8")));
  const q = normalize(d.facts.filter((f) => f.metric !== "long_term_debt"));
  const r = piotroski(q, q.filter((f) => f.metric === "revenue").at(-1)!.end);
  expect(r.tests.find((t) => t.key === "lev")!.pass).toBeNull();
  expect(r.scorable).toBeGreaterThanOrEqual(5);
});
