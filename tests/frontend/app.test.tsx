import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../../src/App";
vi.mock("echarts-for-react/lib/core", () => ({
  default: () => <div data-testid="chart" />,
}));
afterEach(() => vi.unstubAllGlobals());
function mount() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
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
          },
        ],
        coverage: ["NVDA"],
      }),
    }),
  );
  return render(<App />);
}
it("loads static catalog, exposes missing data and switches period and dark mode", async () => {
  mount();
  await screen.findByText("資料尚未收錄，研究介面已就緒");
  expect(screen.getAllByText("N/A").length).toBeGreaterThan(10);
  fireEvent.click(screen.getByRole("button", { name: "年度" }));
  expect(screen.getByRole("button", { name: "年度" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "切換深色模式" }));
  expect(document.documentElement.dataset.theme).toBe("dark");
  fireEvent.click(screen.getByRole("button", { name: /TTM 營業收入/ }));
  expect(screen.getByRole("dialog")).toHaveTextContent("尚無可核實資料來源");
});
it("search reports uncollected tickers rather than showing fabricated company data", async () => {
  mount();
  await screen.findByText("資料尚未收錄，研究介面已就緒");
  fireEvent.focus(screen.getByRole("textbox", { name: "搜尋股票" }));
  fireEvent.change(screen.getByRole("textbox", { name: "搜尋股票" }), {
    target: { value: "NVDA" },
  });
  fireEvent.click(screen.getByRole("button", { name: /NVDA 尚未收錄/ }));
  expect(screen.getByRole("alert")).toHaveTextContent("NVDA 尚未收錄");
});
it("shows a load error when catalog request fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
  render(<App />);
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("無法載入資料目錄"),
  );
});
