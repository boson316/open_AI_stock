import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { applyPrices, validateResearch, type PriceFile } from "../../src/lib/research";

const research = validateResearch(JSON.parse(readFileSync("public/data/research.json", "utf8")));

it("較新的週股價覆蓋收盤價，倍數依股價比例調整", () => {
  const c = research.companies.NVDA;
  const old = c.close ?? c.price;
  const prices: PriceFile = {
    version: 1, source: "x", note: "", updated: "2026-11-01",
    tickers: { NVDA: { asof: "2026-10-30", close: old * 1.1, hi52: old * 1.2, lo52: old * 0.5, weekly: [] } },
  };
  const n = applyPrices(research, prices).companies.NVDA;
  expect(n.close).toBeCloseTo(old * 1.1);
  expect(n.pe!).toBeCloseTo(c.pe! * 1.1);
  expect(n.close_asof).toContain("2026-10-30");
  // 其他公司不受影響
  expect(applyPrices(research, prices).companies.MSFT).toEqual(research.companies.MSFT);
});

it("較舊或無效的股價不覆蓋", () => {
  const prices: PriceFile = {
    version: 1, source: "x", note: "", updated: "",
    tickers: { NVDA: { asof: "2020-01-01", close: 1, hi52: 2, lo52: 0.5, weekly: [] }, MSFT: { asof: "2026-12-01", close: -1, hi52: 1, lo52: 1, weekly: [] } },
  };
  const out = applyPrices(research, prices);
  expect(out.companies.NVDA).toEqual(research.companies.NVDA);
  expect(out.companies.MSFT).toEqual(research.companies.MSFT);
  expect(applyPrices(research, null)).toBe(research);
});
