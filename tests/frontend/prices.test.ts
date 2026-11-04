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

it("分割前申報的 EPS 換算到目前股數基礎，河流圖本益比在分割前後一致", async () => {
  const { adjustForSplits, river, weeklyToPrices } = await import("../../src/lib/finance");
  const q = (end: string, start: string, filed: string, value: number) => ({
    metric: "eps", value, unit: "USD/shares", start, end, filed, accession: `a-${end}`,
    tag: "us-gaap:EarningsPerShareDiluted", source: "x", form: "10-Q", quality: "reported" as const, lineage: [],
  });
  // 四季 EPS 各 4 元（分割前申報），2024-06-10 一拆十；之後的股價為分割調整後
  const facts = [
    q("2023-06-30", "2023-04-01", "2023-08-01", 4),
    q("2023-09-30", "2023-07-01", "2023-11-01", 4),
    q("2023-12-31", "2023-10-01", "2024-02-01", 4),
    q("2024-03-31", "2024-01-01", "2024-05-01", 4),
  ];
  const splits = [{ date: "2024-06-10", ratio: 10 }];
  const adj = adjustForSplits(facts, splits);
  expect(adj.map((f) => f.value)).toEqual([0.4, 0.4, 0.4, 0.4]);
  // 分割後申報的數字不再調整
  expect(adjustForSplits([q("2024-06-30", "2024-04-01", "2024-08-01", 0.5)], splits)[0].value).toBe(0.5);
  const prices = weeklyToPrices([["2024-05-20", 32], ["2024-07-01", 32], ["bad", 1]], "test");
  expect(prices).toHaveLength(2);
  const rows = river(adj, prices);
  expect(rows[0].pe).toBeCloseTo(20);
  expect(rows[1].pe).toBeCloseTo(20);
});

it("沒有外部估值資料時，以週收盤組出季末股價與 TTM EPS", async () => {
  const { quarterPricesFromWeekly } = await import("../../src/lib/intrinsic");
  const q = (start: string, end: string, value: number) => ({
    metric: "eps", value, unit: "USD/shares", start, end, filed: end, accession: end,
    tag: "us-gaap:EarningsPerShareDiluted", source: "x", form: "10-Q", quality: "reported" as const, lineage: [],
  });
  const quarters = [
    q("2025-01-01", "2025-03-31", 1), q("2025-04-01", "2025-06-30", 1),
    q("2025-07-01", "2025-09-30", 1), q("2025-10-01", "2025-12-31", 1),
  ];
  const rows = quarterPricesFromWeekly(
    quarters,
    [["2025-03-28", 50], ["2025-06-27", 55], ["2025-09-26", 60], ["2025-12-26", 80], ["2025-12-31", 81]],
    { date: "2026-01-09", close: 90 },
  );
  expect(rows.map((r) => r.price)).toEqual([50, 55, 60, 81, 90]);
  expect(rows.at(-2)!.eps_ttm).toBe(4);
  expect(rows.at(-1)).toMatchObject({ label: "最新", eps_ttm: 4 });
});

it("股數依序採流通股數、封面股數、加權平均稀釋股數；Beta 由週報酬迴歸", async () => {
  const { sharesAt, betaFromWeekly } = await import("../../src/lib/finance");
  const f = (metric: string, value: number, end: string) => ({
    metric, value, unit: "shares", start: null, end, filed: end, accession: end, tag: "x", source: "x", form: "10-Q", quality: "reported" as const, lineage: [],
  });
  expect(sharesAt([f("diluted_shares", 3, "2026-09-30"), f("shares_cover", 2, "2026-09-30")], "2026-09-30")).toMatchObject({ value: 2, metric: "shares_cover" });
  expect(sharesAt([f("diluted_shares", 3, "2026-09-30")], "2026-09-30")).toMatchObject({ metric: "diluted_shares" });
  expect(sharesAt([], "2026-09-30")).toBeNull();
  // 個股報酬恰為基準的 1.5 倍 → Beta 1.5
  const bench: [string, number][] = [], stock: [string, number][] = [];
  let b = 100, s = 100;
  for (let i = 0; i < 150; i++) {
    const r = Math.sin(i) / 50;
    b *= 1 + r; s *= 1 + 1.5 * r;
    const d = new Date(Date.UTC(2023, 0, 6) + i * 7 * 86400000).toISOString().slice(0, 10);
    bench.push([d, b]); stock.push([d, s]);
  }
  expect(betaFromWeekly(stock, bench)!.beta).toBeCloseTo(1.5, 6);
  expect(betaFromWeekly(stock.slice(0, 50), bench)).toBeNull();
});

it("林區法成長率：期初虧損時改用較短年期，全部不可算時說明原因", async () => {
  const { epsGrowthBest } = await import("../../src/lib/intrinsic");
  const y = (year: number, value: number) => ({
    metric: "eps", value, unit: "USD/shares", start: `${year}-01-01`, end: `${year}-12-31`, filed: `${year + 1}-02-01`,
    accession: `a${year}`, tag: "x", source: "x", form: "10-K", quality: "reported" as const, lineage: [],
  });
  const r = epsGrowthBest([y(2020, -1), y(2021, -0.5), y(2022, 1), y(2023, 2), y(2024, 4), y(2025, 8)]);
  expect(r.years).toBe(3);
  expect(r.value).toBeCloseTo(1, 2);
  expect(epsGrowthBest([y(2024, -1), y(2025, -2)]).reason).toContain("EPS ≤ 0");
});
