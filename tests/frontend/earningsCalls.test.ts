import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateCalls } from "../../src/components/EarningsCall";

it("法說會資料格式正確且每筆都有官方來源", () => {
  const d = validateCalls(JSON.parse(readFileSync("public/data/earnings-calls.json", "utf8")));
  for (const list of Object.values(d.calls))
    for (const c of list) {
      expect(c.source).toMatch(/^https:\/\//);
      expect(c.summary.length).toBeGreaterThan(0);
    }
  expect(() => validateCalls({ version: 1, calls: { X: [{ date: "bad" }] } })).toThrow();
});
