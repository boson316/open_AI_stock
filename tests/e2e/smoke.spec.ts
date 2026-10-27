import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  // Explicit no-data catalog fixture for deterministic empty-state checks;
  // production public/data remains exclusively official SEC data.
  await page.route("**/data/catalog.json", (route) =>
    route.fulfill({
      json: {
        version: 1,
        companies: [
          {
            ticker: "SOFI",
            cik: "0001818874",
            name: "SoFi Technologies",
            sector: "fintech",
            exchange: "NASDAQ",
            status: "unavailable",
            file: null,
            updated: null,
          },
        ],
        coverage: ["NVDA"],
      },
    }),
  );
});
test("static application: navigation, dark mode, CSV export, responsive and no-data integrity", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "讓財報，成為洞察。" }),
  ).toBeVisible();
  await expect(page.getByText("資料尚未收錄，研究介面已就緒")).toBeVisible();
  await page.getByRole("button", { name: "切換深色模式" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "年度", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "年度財務資料", exact: true }),
  ).toBeAttached();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "匯出財務資料", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("SOFI-annual.csv");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "開啟選單" }).click();
  await page.getByRole("link", { name: "完整財務報表" }).click();
  await expect(
    page.getByRole("heading", { name: "完整財務報表", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("real chart renderer responds to imported validated financial JSON", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  const fixture = {
    version: 1,
    ticker: "SOFI",
    cik: "0001818874",
    name: "Synthetic test fixture only",
    sector: "fintech",
    updated: "2025-02-01T00:00:00Z",
    source: "https://data.sec.gov/api/xbrl/companyfacts/CIK0001818874.json",
    warnings: ["TEST ONLY"],
    facts: [
      {
        metric: "revenue",
        value: 100,
        unit: "USD",
        start: "2024-01-01",
        end: "2024-03-31",
        filed: "2024-05-01",
        accession: "test-only",
        tag: "us-gaap:Revenues",
        source: "https://www.sec.gov/test-fixture",
        form: "10-Q",
        quality: "reported",
        lineage: [],
      },
    ],
  };
  await expect(page.getByText("資料尚未收錄，研究介面已就緒")).toBeVisible();
  await page
    .locator('input[type=file][accept="application/json,.json"]')
    .setInputFiles({
      name: "test-only.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(fixture)),
    });
  await expect(page.getByText("使用者匯入財報")).toBeVisible();
  await expect(page.getByText(/僅通過格式檢查，尚未向 SEC 核實內容/)).toBeVisible();
  const chart = page.getByRole("region", { name: "營收與淨利", exact: true });
  await expect(chart.locator("canvas,svg").first()).toBeAttached();
  await page.getByLabel("營收與淨利圖表類型").selectOption("line");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "營收與淨利匯出 CSV", exact: true })
    .click();
  expect((await download).suggestedFilename()).toContain("營收與淨利");
  expect(errors).toEqual([]);
  const png=page.waitForEvent("download");
  await chart.getByRole("button",{name:"PNG",exact:true}).click();
  expect((await png).suggestedFilename()).toMatch(/\.png$/);
  const svg=page.waitForEvent("download");
  await chart.getByRole("button",{name:"SVG",exact:true}).click();
  expect((await svg).suggestedFilename()).toMatch(/\.svg$/);
});

test("official persisted data loads through the repository base path with correct financial units",async({page})=>{
  await page.unroute("**/data/catalog.json");
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto("./");
  await expect(page.getByText("已載入 SEC 財報")).toBeVisible();
  await expect(page.getByRole("button",{name:/TTM 營業收入/})).not.toContainText("N/A");
  await expect(page.getByRole("button",{name:/淨利差 NIM/})).toContainText("%");
  await expect(page.getByRole("button",{name:/CET1 資本適足率/})).toContainText("%");
  await page.getByRole("button",{name:/淨利差 NIM/}).click();
  await expect(page.getByRole("dialog")).toContainText("disclosure:sofi.nim");
  await expect(page.getByRole("dialog").getByRole("link",{name:/檢視官方 Filing/}).first()).toHaveAttribute("href",/^https:\/\/www.sec.gov\/Archives\/edgar\/data\/1818874\//);
  await page.getByRole("button",{name:"關閉明細"}).click();
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
