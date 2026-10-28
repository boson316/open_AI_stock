import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { analyze, parseCsvHoldings, parsePortfolio } from "../../src/components/Portfolio";
import { requiredGrowth, scenarioReturn, validateResearch, wacc } from "../../src/lib/research";

const raw = JSON.parse(readFileSync("public/data/research.json", "utf8"));
const data = validateResearch(raw);
const text = readFileSync("public/data/research.json", "utf8");

it("研究資料：通過驗證，核對數字自洽，個人資料與依記憶整理的資料不收錄", () => {
  const r = data.reconciliation;
  expect(r.checked).toBe(r.matched + r.mismatches.length);
  expect(r.mismatches.length).toBeGreaterThan(0);
  for (const m of r.mismatches) expect(m.external).not.toBe(m.official);
  expect(raw.companies.TSM.mcap ?? null).toBeNull();
  expect(text).not.toMatch(/dd2022|"PORT"/);
  expect(Object.keys(data.commentary)).not.toContain("PORT");
  for (const c of data.risk ? Object.values(data.risk) : []) expect(JSON.stringify(c)).not.toMatch(/2022/);
});

it("研究資料：驗證拒絕缺欄位或錯誤型別", () => {
  expect(() => validateResearch(null)).toThrow();
  expect(() => validateResearch({ ...raw, companies: [] })).toThrow();
  expect(() => validateResearch({ ...raw, gurus: "x" })).toThrow();
});

it("情境報酬、所需成長率與 WACC 的公式", () => {
  const s = scenarioReturn(100, 5, { eps_cagr: 10, exit_pe: 20, years: 3 })!;
  expect(s.target).toBeCloseTo(5 * 1.1 ** 3 * 20, 9);
  expect(s.annual).toBeCloseTo((s.target / 100) ** (1 / 3) - 1, 12);
  expect(scenarioReturn(100, -1, { eps_cagr: 10, exit_pe: 20, years: 3 })).toBeNull();
  // 以所需成長率回推，報酬剛好等於門檻
  const g = requiredGrowth(100, 5, 20, 3, 8)!;
  expect(scenarioReturn(100, 5, { eps_cagr: g * 100, exit_pe: 20, years: 3 })!.annual).toBeCloseTo(0.08, 12);
  expect(requiredGrowth(100, 0, 20, 3, 8)).toBeNull();
  const w = wacc({ rf: 4, beta: 1.5, erp: 5, kdSpread: 1, tax: 20, debtWeight: 0.2 });
  expect(w.ke).toBeCloseTo(11.5, 12);
  expect(w.kd).toBeCloseTo(4, 12);
  expect(w.wacc).toBeCloseTo(0.8 * 11.5 + 0.2 * 4, 12);
});

it("我的持股：解析只保留允許欄位，市值、占比與 ETF 穿透曝險正確，沒有價格不估計", () => {
  expect(parsePortfolio({ holdings: [{ ticker: "nvda", shares: 1, cost: 1, secret: "x" }, { ticker: "<script>", shares: 1, cost: 1 }], cash: "abc" })).toEqual({
    holdings: [{ ticker: "NVDA", shares: 1, cost: 1, price: null }],
    cash: 0,
  });
  expect(parseCsvHoldings("代號,股數,總成本\nNVDA,100,15000\nSMH,20,9000\nZZZZ,1,10,5")).toEqual([
    { ticker: "NVDA", shares: 100, cost: 15000, price: null },
    { ticker: "SMH", shares: 20, cost: 9000, price: null },
    { ticker: "ZZZZ", shares: 1, cost: 10, price: 5 },
  ]);
  const smh = data.etf.find((e) => e.ticker === "SMH")!;
  const smhPrice = smh.close ?? smh.price;
  const res = analyze(
    { holdings: [{ ticker: "NVDA", shares: 100, cost: 15000 }, { ticker: "SMH", shares: 20, cost: 9000 }, { ticker: "UNKNOWN", shares: 5, cost: 100 }], cash: 20000 },
    data,
  );
  const nvdaValue = data.companies.NVDA.close! * 100;
  expect(res.rows[0].value).toBeCloseTo(nvdaValue, 6);
  expect(res.rows[1].value).toBeCloseTo(smhPrice * 20, 6);
  expect(res.rows[2].value).toBeNull();
  expect(res.stock).toBeCloseTo(nvdaValue + smhPrice * 20, 6);
  expect(res.total).toBeCloseTo(res.stock + 20000, 6);
  const nvdaInSmh = data.etf_holdings.find((h) => h.etf === "SMH" && h.lt_ticker === "NVDA")!.weight;
  const nv = res.exposure.find((e) => e.ticker === "NVDA")!;
  expect(nv.direct).toBeCloseTo(nvdaValue, 6);
  expect(nv.viaEtf).toBeCloseTo((smhPrice * 20 * nvdaInSmh) / 100, 6);
});
