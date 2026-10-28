import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { calendarBucket, metricSeries, ttmSummary } from "../../src/lib/compare";
import { normalize, validateDataset } from "../../src/lib/finance";

const load = (t: string) =>
  validateDataset(JSON.parse(readFileSync(`public/data/${t}.json`, "utf8")));
const coverage = JSON.parse(readFileSync("public/data/coverage.json", "utf8"));

it("非曆年財年對齊到最近曆季季末", () => {
  expect(calendarBucket("2026-07-26")).toBe("2026-06-30"); // NVDA
  expect(calendarBucket("2026-09-03")).toBe("2026-09-30"); // MU
  expect(calendarBucket("2021-12-02")).toBe("2021-12-31"); // MU
  expect(calendarBucket("2021-09-25")).toBe("2021-09-30"); // AAPL/AMD
  expect(calendarBucket("2024-12-31")).toBe("2024-12-31");
});

it("各公司毛利率序列與 coverage 一致，SOFI 為 N/A，且曆季桶不重複", () => {
  for (const c of coverage.companies) {
    const d = load(c.ticker);
    const q = normalize(d.facts);
    const fin = c.ticker === "SOFI";
    const s = metricSeries(q, "gross_margin", fin);
    if (fin) {
      expect([...s.values()].every((v) => v === null)).toBe(true);
      continue;
    }
    for (const p of c.gross_margin.periods) {
      const v = s.get(calendarBucket(p.end));
      expect(v, `${c.ticker} ${p.end}`).not.toBeNull();
      expect(Math.abs(v! * 100 - p.margin_pct)).toBeLessThan(0.001);
    }
    const last20 = q
      .filter((f) => f.metric === "revenue")
      .map((f) => f.end)
      .sort()
      .slice(-20);
    expect(new Set(last20.map(calendarBucket)).size, c.ticker).toBe(20);
  }
});

it("TTM 比較表：FCF 率與 coverage 的四季合計一致，負淨利時現金流品質為 N/A", () => {
  const d = load("GOOGL");
  const q = normalize(d.facts);
  const t = ttmSummary(q, false);
  const cov = coverage.companies.find((c: { ticker: string }) => c.ticker === "GOOGL");
  const last4 = cov.cashflow.periods.slice(-4);
  const fcf = last4.reduce((a: number, p: { fcf: number }) => a + p.fcf, 0);
  const rev = q.filter((f) => f.metric === "revenue" && f.start).sort((a, b) => a.end.localeCompare(b.end)).slice(-4).reduce((a, f) => a + f.value, 0);
  expect(Math.abs(t.fcf_margin! - fcf / rev)).toBeLessThan(1e-9);
  const s = ttmSummary(normalize(load("SOFI").facts), true);
  expect(s.gross_margin).toBeNull();
});
