import { describe, expect, it } from "vitest";
import {
  cagr,
  normalize,
  parsePrices,
  river,
  ttm,
  validateDataset,
  quantile,
} from "../../src/lib/finance";
import type { Fact } from "../../src/lib/finance";
const fact = (
  value: number,
  start: string,
  end: string,
  filed = "2025-02-01",
): Fact => ({
  metric: "eps",
  value,
  unit: "USD/shares",
  start,
  end,
  filed,
  accession: "synthetic-test-only",
  tag: "us-gaap:EarningsPerShareDiluted",
  source: "https://www.sec.gov/test-fixture",
  form: "10-Q",
  quality: "reported",
  lineage: [],
});
const eps = [
  fact(1, "2024-01-01", "2024-03-31"),
  fact(1, "2024-04-01", "2024-06-30"),
  fact(1, "2024-07-01", "2024-09-30"),
  fact(1, "2024-10-01", "2024-12-31"),
];
describe("financial integrity", () => {
  it("uses actual elapsed years and rejects negative CAGR bases",()=>{
    expect(cagr(100,121,"2022-01-01","2024-01-01")).toBeCloseTo(.1,3);
    expect(cagr(-100,121,"2022-01-01","2024-01-01")).toBeNull();
  });
  it("requires four contiguous quarters and no duplicate counting", () => {
    expect(ttm(eps)).toBe(4);
    expect(ttm(eps.slice(1))).toBeNull();
    expect(ttm([eps[0], eps[0], eps[2], eps[3]])).toBeNull();
  });
  it("derives Q4 with lineage but never subtracts EPS", () => {
    const fs = [
      fact(9, "2024-01-01", "2024-09-30"),
      fact(14, "2024-01-01", "2024-12-31"),
    ];
    expect(normalize(fs)).toEqual([]);
    const q = normalize(
      fs.map((f) => ({ ...f, metric: "revenue", unit: "USD" })),
    );
    expect(q[0].value).toBe(5);
    expect(q[0].start).toBe("2024-10-01");
    expect(q[0].lineage).toHaveLength(2);
  });
  it("rejects malformed exported company data", () => {
    expect(() => validateDataset({ version: 1, facts: [] })).toThrow();
  });
  it("does not use future filings or future valuation samples", () => {
    const p = (date: string, close: number) => ({
      date,
      close,
      open: close,
      high: close,
      low: close,
      adjustedClose: null,
      volume: 1,
      source: "test-only",
    });
    const rows = river(eps, [
      p("2025-01-31", 20),
      p("2025-02-01", 20),
      ...Array.from({ length: 20 }, (_, i) =>
        p(`2025-02-${String(i + 2).padStart(2, "0")}`, 20),
      ),
      p("2025-03-01", 1000),
    ]);
    expect(rows[0].pe).toBeNull();
    expect(rows[1].pe).toBeNull();
    expect(rows[2].pe).toBe(5);
    expect(rows[20].bands[2]).toBeNull();
    expect(rows[21].bands[2]).toBe(20);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
  it("validates OHLC, duplicate dates and split-adjusted prices without guessing", () => {
    const header = "Date,Open,High,Low,Close,AdjustedClose,Volume\n";
    const csv = header + "2024-01-02,10,12,9,11,5.5,100";
    expect(parsePrices(csv, "licensed-user-import")[0].adjustedClose).toBe(5.5);
    expect(() => parsePrices(csv, "")).toThrow();
    expect(() =>
      parsePrices(header + "2024-01-02,10,9,9,11,,100", "test"),
    ).toThrow();
    expect(() =>
      parsePrices(csv + "\n2024-01-02,10,12,9,11,,100", "test"),
    ).toThrow();
  });
});
