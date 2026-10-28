import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildAnalysisPack } from "../../src/lib/analysisPack";
import { normalize, validateDataset } from "../../src/lib/finance";

const load = (t: string) =>
  validateDataset(JSON.parse(readFileSync(`public/data/${t}.json`, "utf8")));
const coverage = JSON.parse(readFileSync("public/data/coverage.json", "utf8"));
const rows = (md: string) =>
  md.split("\n").filter((l) => /^\| \d{4}-\d{2}-\d{2} /.test(l));

it("每檔資料包含 20 季、無 NaN／undefined，且毛利率與 coverage 一致", () => {
  for (const c of coverage.companies) {
    const d = load(c.ticker);
    const md = buildAnalysisPack(d, normalize(d.facts), "2026-01-01T00:00:00Z");
    expect(md, c.ticker).not.toMatch(/NaN|undefined|Infinity/);
    expect(rows(md), c.ticker).toHaveLength(20);
    expect(md).toContain("不提供買賣建議");
    for (const r of rows(md)) {
      const cells = r.split("|").map((x) => x.trim());
      const date = cells[1];
      if (c.gross_margin.status === "not_applicable") {
        expect(cells[3]).toBe("不適用");
        continue;
      }
      const p = c.gross_margin.periods.find((x: { end: string }) => x.end === date);
      if (p) expect(Math.abs(parseFloat(cells[4]) - p.margin_pct)).toBeLessThan(0.06);
    }
  }
});

it("現金流自由現金流 = OCF − |CapEx|，缺值不補零", () => {
  const d = load("GOOGL");
  const md = buildAnalysisPack(d, normalize(d.facts));
  const cells = rows(md).at(-1)!.split("|").map((x) => x.trim());
  const [ocf, capex, fcf] = [10, 11, 12].map((i) => parseFloat(cells[i].replace(/,/g, "")));
  expect(Math.abs(ocf - capex - fcf)).toBeLessThan(0.2);
  expect(md).toContain("資料限制");
});

it("合併資料包：每檔一節、只有一份指示、幣別提醒", async () => {
  const { buildCombinedPack } = await import("../../src/lib/analysisPack");
  const packs = coverage.companies.map((c: { ticker: string }) => {
    const d = load(c.ticker);
    return { dataset: d, quarters: normalize(d.facts) };
  });
  const md = buildCombinedPack(packs, "2026-01-01T00:00:00Z");
  expect(md.match(/## 給 AI 的指示/g)).toHaveLength(1);
  expect(md.match(/財務分析資料包$/gm)).toHaveLength(13);
  expect(md).toContain("不同幣別不可直接相加");
  expect(md).not.toMatch(/NaN|undefined/);
});
