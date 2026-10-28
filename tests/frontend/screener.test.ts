import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PRESETS, applyFilters, buildRow, ttmRevenueGrowth } from "../../src/lib/screener";
import { normalize, validateDataset } from "../../src/lib/finance";

const coverage = JSON.parse(readFileSync("public/data/coverage.json", "utf8"));
const catalog = JSON.parse(readFileSync("public/data/catalog.json", "utf8"));
const rows = catalog.companies.map((c: { ticker: string; name: string; sector: string }) => {
  const d = validateDataset(JSON.parse(readFileSync(`public/data/${c.ticker}.json`, "utf8")));
  return buildRow(c.ticker, c.name, d.currency ?? "USD", normalize(d.facts), c.sector === "fintech");
});
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

it("TTM 毛利率與 coverage 最近四季合計一致，SOFI 為 N/A", () => {
  for (const r of rows) {
    const cov = coverage.companies.find((c: { ticker: string }) => c.ticker === r.ticker);
    if (r.ticker === "SOFI") {
      expect(r.values.gross_margin).toBeNull();
      continue;
    }
    const p = cov.gross_margin.periods.slice(-4);
    const expected = sum(p.map((x: { gross_profit: number }) => x.gross_profit)) / sum(p.map((x: { revenue: number }) => x.revenue));
    expect(Math.abs(r.values.gross_margin! - expected), r.ticker).toBeLessThan(1e-9);
  }
});

it("TTM 營收年增率與 coverage 的前後各四季營收一致", () => {
  for (const r of rows) {
    const cov = coverage.companies.find((c: { ticker: string }) => c.ticker === r.ticker);
    const rev = cov.periods.map((p: { metrics: { revenue: { value: number } } }) => p.metrics.revenue.value);
    const expected = sum(rev.slice(-4)) / sum(rev.slice(-8, -4)) - 1;
    expect(Math.abs(r.values.revenue_ttm_growth! - expected), r.ticker).toBeLessThan(1e-9);
  }
  expect(ttmRevenueGrowth([])).toBeNull();
});

it("篩選：N/A 不符合啟用條件、範圍條件正確、快速條件結果可由 coverage 獨立推得", () => {
  const withGm = applyFilters(rows, { gross_margin: { min: "0", max: "" } });
  expect(withGm.some((r) => r.ticker === "SOFI")).toBe(false);
  expect(withGm).toHaveLength(12);
  expect(applyFilters(rows, {})).toHaveLength(13);
  expect(applyFilters(rows, { gross_margin: { min: "", max: "" } })).toHaveLength(13);
  const high = applyFilters(rows, { gross_margin: { min: "70", max: "" } }).map((r) => r.ticker);
  const expected = coverage.companies
    .filter((c: { gross_margin: { status: string } }) => c.gross_margin.status !== "not_applicable")
    .filter((c: { gross_margin: { periods: { gross_profit: number; revenue: number }[] } }) => {
      const p = c.gross_margin.periods.slice(-4);
      return (sum(p.map((x) => x.gross_profit)) / sum(p.map((x) => x.revenue))) * 100 >= 70;
    })
    .map((c: { ticker: string }) => c.ticker);
  expect(high.sort()).toEqual(expected.sort());
  expect(high.length).toBeGreaterThan(0);
  for (const p of PRESETS) expect(Array.isArray(applyFilters(rows, p.filters))).toBe(true);
});
