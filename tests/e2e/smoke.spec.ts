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
    page.getByRole("heading", { name: "SoFi Technologies" }),
  ).toBeVisible();
  await expect(page.getByText("資料尚未收錄，研究介面已就緒")).toBeVisible();
  await page.getByRole("button", { name: "切換深色模式" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "年度", exact: true }).click();
  await page.getByRole("tab", { name: "完整財務報表", exact: true }).click();
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
  await expect(
    page.getByText(/僅通過格式檢查，尚未向 SEC 核實內容/),
  ).toBeVisible();
  const chart = page.getByRole("region", { name: "營收與淨利", exact: true });
  await expect(chart.locator("canvas,svg").first()).toBeAttached();
  await page.getByLabel("營收與淨利圖表類型").selectOption("line");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "營收與淨利匯出 CSV", exact: true })
    .click();
  expect((await download).suggestedFilename()).toContain("營收與淨利");
  expect(errors).toEqual([]);
  const png = page.waitForEvent("download");
  await chart.getByRole("button", { name: "PNG", exact: true }).click();
  expect((await png).suggestedFilename()).toMatch(/\.png$/);
  const svg = page.waitForEvent("download");
  await chart.getByRole("button", { name: "SVG", exact: true }).click();
  expect((await svg).suggestedFilename()).toMatch(/\.svg$/);
});

test("official persisted data loads through the repository base path with correct financial units", async ({
  page,
}) => {
  await page.unroute("**/data/catalog.json");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(page.getByText("已載入 SEC 財報")).toBeVisible();
  // 預設開啟 TSM：新臺幣口徑；SOFI 專屬指標需先切換公司。
  await expect(page.locator(".ticker-pill")).toHaveText("TSM");
  await expect(
    page.getByRole("button", { name: /TTM 營業收入/ }),
  ).toContainText("NT$");
  await page.getByRole("button", { name: "切換至 SOFI", exact: true }).click();
  await expect(page.locator(".ticker-pill")).toHaveText("SOFI");
  await expect(
    page.getByRole("button", { name: /TTM 營業收入/ }),
  ).not.toContainText("N/A");
  await expect(page.getByRole("button", { name: /淨利差 NIM/ })).toContainText(
    "%",
  );
  await expect(
    page.getByRole("button", { name: /CET1 資本適足率/ }),
  ).toContainText("%");
  await page.getByRole("button", { name: /淨利差 NIM/ }).click();
  await expect(page.getByRole("dialog")).toContainText("disclosure:sofi.nim");
  await expect(
    page
      .getByRole("dialog")
      .getByRole("link", { name: /檢視官方 Filing/ })
      .first(),
  ).toHaveAttribute(
    "href",
    /^https:\/\/www.sec.gov\/Archives\/edgar\/data\/1818874\//,
  );
  await page.getByRole("button", { name: "關閉明細" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test("every requested ticker loads its own verified data and TSM keeps TIFRS quarters separate from IFRS annual TWD", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.unroute("**/data/catalog.json");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(page.getByText("已載入 SEC 財報")).toBeVisible();
  for (const ticker of [
    "GOOGL",
    "GOOG",
    "NVDA",
    "AMD",
    "TSM",
    "MSFT",
    "AAPL",
    "AMZN",
    "META",
    "PLTR",
    "MU",
    "TSLA",
  ]) {
    const search = page.getByRole("textbox", { name: "搜尋股票" });
    await search.fill(ticker);
    await page
      .locator(".search-results button")
      .filter({
        has: page.locator("strong", { hasText: new RegExp(`^${ticker}$`) }),
      })
      .click();
    await expect(page.locator(".ticker-pill")).toHaveText(ticker);
    await expect(page.getByText("已載入 SEC 財報")).toBeVisible();
    await expect(page.getByRole("button", { name: /淨利差 NIM/ })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("link", { name: "官方 Company Facts" }),
    ).toHaveAttribute(
      "href",
      /^https:\/\/data.sec.gov\/api\/xbrl\/companyfacts\/CIK\d{10}\.json$/,
    );
    if (ticker === "TSM") {
      await expect(
        page.getByRole("button", { name: /TTM 營業收入/ }),
      ).toContainText("NT$");
      await expect(
        page.getByRole("button", { name: "季度", exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: /股東權益報酬率/ }),
      ).toContainText("N/A");
      await page.getByRole("button", { name: "年度", exact: true }).click();
      await page
        .getByRole("tab", { name: "完整財務報表", exact: true })
        .click();
      // Annual card remains labelled TTM only for quarterly-capable issuers;
      // financial table explicitly shows the IASB IFRS annual basis.
      await expect(
        page.getByRole("heading", { name: "年度財務資料", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".company-overview")).toContainText("新臺幣");
      await expect(
        page.getByRole("button", { name: "季度", exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "年度", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("tab", { name: "研究總覽", exact: true }).click();
      await page
        .locator(".basis-notice")
        .evaluate((e) => e.setAttribute("open", ""));
    } else {
      await expect(
        page.getByRole("button", { name: "季度", exact: true }),
      ).toBeEnabled();
    }
  }
  expect(errors).toEqual([]);
});

test("cash flow screen exposes 20 real quarters per stock and mobile favorites persist", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.unroute("**/data/catalog.json");
  await page.goto("./");
  await expect(page.getByText("已載入 SEC 財報")).toBeVisible();
  await page.getByRole("tab", { name: "現金流分析", exact: true }).click();
  for (const ticker of [
    "SOFI",
    "GOOGL",
    "GOOG",
    "NVDA",
    "AMD",
    "TSM",
    "MSFT",
    "AAPL",
    "AMZN",
    "META",
    "PLTR",
    "MU",
    "TSLA",
  ]) {
    await page
      .getByRole("button", { name: `切換至 ${ticker}`, exact: true })
      .click();
    await expect(page.locator(".ticker-pill")).toHaveText(ticker);
    await expect(page.getByText("已載入 SEC 財報")).toBeVisible();
    await expect(page.locator(".cash-coverage")).toContainText(
      "近 20 季現金流 · 20 季五項資料齊全",
    );
    const waiting = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "現金流結構匯出 CSV", exact: true })
      .click();
    const download = await waiting;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream!) chunks.push(chunk);
    const rows = Buffer.concat(chunks).toString("utf8").trim().split(/\r?\n/);
    expect(rows).toHaveLength(21);
    expect(
      rows
        .slice(1)
        .every(
          (r) =>
            r.split(",").length === 4 && !r.endsWith(",") && !r.includes(",,"),
        ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: /^(收藏|取消收藏) TSLA$/ }).click();
  const saved = await page.evaluate(() =>
    localStorage.getItem("openstock-favorites"),
  );
  await page.reload();
  expect(
    await page.evaluate(() => localStorage.getItem("openstock-favorites")),
  ).toBe(saved);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("navigation", { name: "手機主要功能" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "手機主要功能" })
    .getByRole("button", { name: "報表", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "完整財務報表", exact: true }),
  ).toBeVisible();
});

test("gross margin line has 20 real quarters per eligible stock and SoFi is marked not applicable", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.unroute("**/data/catalog.json");
  await page.goto("./");
  await expect(page.getByText("已載入 SEC 財報")).toBeVisible();
  const coverage = await (await page.request.get("data/coverage.json")).json();
  await page.getByRole("tab", { name: "損益與成長", exact: true }).click();
  for (const company of coverage.companies) {
    const ticker: string = company.ticker;
    await page
      .getByRole("button", { name: `切換至 ${ticker}`, exact: true })
      .click();
    await expect(page.locator(".ticker-pill")).toHaveText(ticker);
    await expect(page.getByText("已載入 SEC 財報")).toBeVisible();
    const waiting = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "獲利能力匯出 CSV", exact: true })
      .click();
    const stream = await (await waiting).createReadStream();
    const chunks = [];
    for await (const chunk of stream!) chunks.push(chunk);
    const rows = Buffer.concat(chunks)
      .toString("utf8")
      .replace(/^\uFEFF/, "")
      .trim()
      .split(/\r?\n/)
      .map((r) => r.split('","').map((c) => c.replace(/^"|"$/g, "")));
    const column = rows[0].findIndex((h) => h.startsWith("毛利率"));
    if (company.gross_margin.status === "not_applicable") {
      expect(column).toBe(-1);
      await expect(page.getByTestId("gross-margin-na")).toContainText(
        "毛利率不適用",
      );
      continue;
    }
    expect(column).toBeGreaterThan(0);
    const body = rows.slice(1);
    expect(body.length).toBeGreaterThanOrEqual(20);
    const byDate = new Map(body.map((r) => [r[0], r[column]]));
    for (const period of company.gross_margin.periods) {
      const shown = byDate.get(period.end);
      expect(shown, `${ticker} ${period.end}`).toBeTruthy();
      expect(Math.abs(Number(shown) - period.margin_pct)).toBeLessThan(0.01);
    }
  }
});

test("AI analysis pack copies a 20-quarter, source-tied summary for every stock", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.unroute("**/data/catalog.json");
  await page.goto("./");
  await expect(page.getByText("已載入 SEC 財報")).toBeVisible();
  for (const ticker of ["SOFI", "NVDA", "TSM", "MU"]) {
    await page
      .getByRole("button", { name: `切換至 ${ticker}`, exact: true })
      .click();
    await expect(page.locator(".ticker-pill")).toHaveText(ticker);
    await page.getByRole("button", { name: "複製 AI 分析包" }).click();
    await expect(page.getByRole("status")).toContainText("已複製");
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain(`（${ticker}）財務分析資料包`);
    expect(text).toContain("不提供買賣建議");
    expect(text).not.toMatch(/NaN|undefined/);
    expect(text.split("\n").filter((l) => /^\| \d{4}-\d{2}-\d{2} /.test(l))).toHaveLength(20);
    if (ticker === "SOFI") expect(text).toContain("不適用");
    if (ticker === "TSM") expect(text).toContain("新臺幣");
  }
});

test("one-click export downloads every stock in a single AI analysis pack", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.unroute("**/data/catalog.json");
  await page.goto("./");
  await expect(page.getByText("已載入 SEC 財報")).toBeVisible();
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "一鍵匯出股票 AI 分析包" }).click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe("stocks-ai-analysis-pack.md");
  const chunks = [];
  for await (const chunk of (await download.createReadStream())!) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  for (const t of ["SOFI","GOOGL","GOOG","NVDA","AMD","TSM","MSFT","AAPL","AMZN","META","PLTR","MU","TSLA"])
    expect(text).toContain(`（${t}）財務分析資料包`);
  expect(text).not.toMatch(/NaN|undefined/);
});

test("multi-stock comparison charts 20 aligned quarters and exports ratios", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.unroute("**/data/catalog.json");
  await page.goto("./");
  await expect(page.getByText("已載入 SEC 財報")).toBeVisible();
  await page.getByRole("button", { name: "切換至 NVDA", exact: true }).click();
  await page.getByRole("tab", { name: "多股比較", exact: true }).click();
  await expect(page.getByRole("heading", { name: "多股比較", exact: true })).toBeVisible();
  const group = page.getByRole("group", { name: "比較公司" });
  await group.getByRole("button", { name: "MSFT", exact: true }).click();
  await group.getByRole("button", { name: "SOFI", exact: true }).click();
  await expect(page.locator(".compare-table-panel tbody tr")).toHaveCount(5);
  const coverage = await (await page.request.get("data/coverage.json")).json();
  const nvda = coverage.companies.find((c: { ticker: string }) => c.ticker === "NVDA");
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "多股比較：毛利率匯出 CSV", exact: true }).click();
  const chunks = [];
  for await (const chunk of (await (await waiting).createReadStream())!) chunks.push(chunk);
  const rows = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/).map((r) => r.split('","').map((c) => c.replace(/^"|"$/g, "")));
  const col = rows[0].findIndex((h) => h.startsWith("NVDA"));
  expect(col).toBeGreaterThan(0);
  const filled = rows.slice(1).filter((r) => r[col] !== "");
  expect(filled.length).toBeGreaterThanOrEqual(20);
  const last = nvda.gross_margin.periods.at(-1);
  expect(filled.some((r) => Math.abs(Number(r[col]) - last.margin_pct) < 0.01)).toBe(true);
  const sofi = rows[0].findIndex((h) => h.startsWith("SOFI"));
  expect(rows.slice(1).every((r) => r[sofi] === "")).toBe(true);
  await expect(page.locator(".compare-table-panel")).toContainText("N/A");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
});

test("default company is TSM and the screener filters by TTM gross margin using official figures", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.unroute("**/data/catalog.json");
  await page.goto("./");
  await expect(page.getByText("已載入 SEC 財報")).toBeVisible();
  await expect(page.locator(".ticker-pill")).toHaveText("TSM");
  const coverage = await (await page.request.get("data/coverage.json")).json();
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const expected = coverage.companies
    .filter((c: { gross_margin: { status: string } }) => c.gross_margin.status !== "not_applicable")
    .filter((c: { gross_margin: { periods: { gross_profit: number; revenue: number }[] } }) => {
      const p = c.gross_margin.periods.slice(-4);
      return (sum(p.map((x) => x.gross_profit)) / sum(p.map((x) => x.revenue))) * 100 >= 70;
    })
    .map((c: { ticker: string }) => c.ticker)
    .sort();
  await page.getByRole("tab", { name: "選股篩選", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("符合條件 13 / 13");
  await page.getByRole("spinbutton", { name: "毛利率（TTM） 下限" }).fill("70");
  await expect(page.getByRole("status")).toContainText(`符合條件 ${expected.length} / 13`);
  const shown = (await page.locator(".compare-table-panel tbody tr th .link-button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")?.replace("查看 ", "")))).sort();
  expect(shown).toEqual(expected);
  expect(shown).not.toContain("SOFI");
  await page.getByRole("button", { name: `查看 ${expected[0]}` }).click();
  await expect(page.locator(".ticker-pill")).toHaveText(expected[0]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});
