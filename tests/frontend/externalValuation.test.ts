import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateExternal } from "../../src/components/ExternalValuation";
import { normalize, validateDataset } from "../../src/lib/finance";

const ext = validateExternal(JSON.parse(readFileSync("public/data/external-valuation.json", "utf8")));

it("外部估值資料：9 檔、每檔 21 點、價格帶遞增、日期遞增、最新點日期為截止日", () => {
  expect(Object.keys(ext.companies).sort()).toEqual(["AMD", "AMZN", "GOOGL", "META", "MSFT", "MU", "NVDA", "PLTR", "TSM"]);
  for (const [t, rows] of Object.entries(ext.companies)) {
    expect(rows, t).toHaveLength(21);
    expect(rows.at(-1)!.date).toBe(ext.as_of);
    expect(rows.every((r, i) => i === 0 || r.date > rows[i - 1].date)).toBe(true);
  }
});

it("缺值不補零：TTM EPS ≤ 0 的點沒有 PE 與價格帶", () => {
  for (const rows of Object.values(ext.companies))
    for (const r of rows) {
      if (r.eps_ttm === null || r.eps_ttm <= 0) {
        expect(r.pe).toBeNull();
        expect(r.bands).toBeNull();
      }
    }
});

it("季度 EPS 與本站官方資料一致；差異只允許拆股倍數（官方歷史 EPS 未統一拆股調整）", () => {
  const splitFactors = [2, 3, 4, 5, 10, 15, 20, 40];
  for (const [t, rows] of Object.entries(ext.companies)) {
    if (t === "TSM") continue; // ADR 美元口徑 vs 官方新臺幣普通股
    const d = validateDataset(JSON.parse(readFileSync(`public/data/${t}.json`, "utf8")));
    const official = normalize(d.facts).filter((f) => f.metric === "eps");
    let exact = 0,
      matched = 0;
    for (const r of rows) {
      if (r.eps_q === null || r.label === "最新") continue;
      const f = official.find((x) => x.end.startsWith(r.date.slice(0, 7)));
      if (!f) continue;
      matched++;
      if (Math.abs(f.value - r.eps_q) < 0.035) {
        exact++;
        continue;
      }
      expect(
        splitFactors.some((k) => Math.abs(f.value / k - r.eps_q!) < 0.035),
        `${t} ${r.label}: official ${f.value} vs external ${r.eps_q}`,
      ).toBe(true);
    }
    expect(matched, t).toBeGreaterThanOrEqual(15);
    expect(exact, t).toBeGreaterThanOrEqual(3);
  }
});

it("格式不符的資料會被拒絕", () => {
  expect(() => validateExternal({ version: 1, companies: { X: [{ date: "2026-01-31", label: "a", price: -1, eps_q: 1, eps_ttm: 1, pe: 1, bands: null }] } })).toThrow();
  expect(() => validateExternal({ version: 1, companies: { X: [{ date: "2026-01-31", label: "a", price: 1, eps_q: 1, eps_ttm: 1, pe: 1, bands: [3, 2, 1, 4, 5] }] } })).toThrow();
});
