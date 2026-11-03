import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { normalize, validateDataset } from "../../src/lib/finance";
import { dcf, fcfYieldHistory, impliedGrowth, lynch } from "../../src/lib/intrinsic";

const ext = JSON.parse(readFileSync("public/data/external-valuation.json", "utf8"));

it("DCF 與反推成長率互為反函數", () => {
  const base = { fcf: 10, gt: 0.025, r: 0.09 };
  const v = dcf({ ...base, g1: 0.12, g2: 0.12 })!.value;
  expect(impliedGrowth(v, base)).toBeCloseTo(0.12, 4);
  expect(dcf({ ...base, g1: 0, g2: 0, gt: 0.1 })).toBeNull();
});

it("林區合理本益比 = 成長率 + 殖利率", () => {
  const r = lynch(5, 20, 15, 2);
  expect(r.fairPe).toBe(17);
  expect(r.fairValue).toBe(85);
  expect(r.ratio).toBeCloseTo(0.85);
});

it("各檔 FCF 殖利率歷史有值且數量級合理", () => {

  for (const [t, rows] of Object.entries(ext.companies)) {
    const d = validateDataset(JSON.parse(readFileSync(`public/data/${t}.json`, "utf8")));
    const h = fcfYieldHistory(normalize(d.facts), rows as never);
    const ys = h.filter((x) => x.fcfYield !== null).map((x) => x.fcfYield!);
    expect(ys.length, t).toBeGreaterThan(5);
    for (const y of ys) expect(Math.abs(y), t).toBeLessThan(0.3);
  }
});
