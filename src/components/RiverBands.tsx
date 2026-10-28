import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react/lib/core";
import type { EChartsOption } from "echarts";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { Download } from "lucide-react";
import { csvDownload, quantile } from "../lib/finance";
import type { ExternalPoint } from "./ExternalValuation";

echarts.use([
  LineChart,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer,
]);

// 財報狗式配色：由下（藍、便宜）到上（紅、昂貴）。
const BAND_COLORS = ["#5b8def", "#4fb3a9", "#9ccc65", "#f6c344", "#f39a4b", "#e5534b"];

/** 自家近 20 季本益比 P10–P90 等距切成六個倍數（不含「最新」點，避免用現價定義歷史區間）。 */
export function riverMultiples(rows: ExternalPoint[]): number[] | null {
  const pes = rows
    .filter((r) => r.label !== "最新" && r.pe !== null && r.pe > 0)
    .map((r) => r.pe as number);
  if (pes.length < 8) return null;
  const lo = quantile(pes, 0.1)!,
    hi = quantile(pes, 0.9)!;
  return Array.from({ length: 6 }, (_, k) => lo + ((hi - lo) * k) / 5);
}

export function RiverBands({
  ticker,
  rows,
  dark,
  unit,
}: {
  ticker: string;
  rows: ExternalPoint[];
  dark: boolean;
  unit: string;
}) {
  const [years, setYears] = useState(5);
  const [focus, setFocus] = useState(true);
  const multiples = useMemo(() => riverMultiples(rows), [rows]);
  const cutoff = rows.length
    ? `${Number(rows.at(-1)!.date.slice(0, 4)) - years}${rows.at(-1)!.date.slice(4)}`
    : "";
  const shown = rows.filter((r) => r.date >= cutoff);
  const lines =
    multiples?.map((m) =>
      shown.map((r) =>
        r.eps_ttm !== null && r.eps_ttm > 0 ? +(m * r.eps_ttm).toFixed(2) : null,
      ),
    ) ?? [];
  const pes = rows
    .filter((r) => r.label !== "最新" && r.pe !== null && r.pe > 0)
    .map((r) => r.pe as number);
  const median = quantile(pes, 0.5);
  const latest = rows.at(-1);
  const above = latest?.pe
    ? (pes.filter((p) => p < latest.pe!).length / pes.length) * 100
    : null;
  const prices = shown.map((r) => r.price);
  const text = dark ? "#b4c0d6" : "#5d6684";
  const grid = dark ? "#2a3248" : "#eceef5";
  const labels = shown.map((r) => (r.label === "最新" ? "最新" : r.label));

  const river: EChartsOption = {
    backgroundColor: "transparent",
    textStyle: { color: text, fontFamily: "system-ui", fontSize: 12 },
    tooltip: {
      trigger: "axis",
      formatter: (items) => {
        const list = Array.isArray(items) ? items : [items];
        const i = list[0]?.dataIndex ?? 0;
        const r = shown[i];
        const rowsHtml = (multiples ?? [])
          .map(
            (m, k) =>
              `<span style="color:${BAND_COLORS[k]}">●</span> ${m.toFixed(1)}× ：${
                lines[k][i] === null ? "N/A" : lines[k][i]!.toLocaleString("zh-TW")
              }`,
          )
          .reverse()
          .join("<br/>");
        return `<b>${r.label === "最新" ? `最新（${r.date}）` : r.date}</b><br/>收盤價：${r.price}<br/>本益比：${
          r.pe ?? "N/A（TTM EPS ≤ 0）"
        }<br/>${rowsHtml}`;
      },
    },
    legend: { top: 0, textStyle: { color: text }, type: "scroll" },
    grid: { left: 56, right: 18, top: 62, bottom: 34 },
    xAxis: {
      type: "category",
      data: labels,
      boundaryGap: false,
      axisLabel: { color: text },
      axisLine: { lineStyle: { color: grid } },
    },
    yAxis: {
      type: "value",
      name: unit,
      scale: focus,
      min: focus
        ? Math.floor(Math.min(...prices) * 0.75)
        : 0,
      max: focus ? Math.ceil(Math.max(...prices) * 1.25) : undefined,
      splitLine: { lineStyle: { color: grid } },
      axisLabel: { color: text },
    },
    series: [
      // 堆疊：第一條為底線（不填色），其後每條填入與前一條的差，形成六條色帶。
      ...lines.map((values, k) => ({
        name: `${multiples![k].toFixed(1)}× 本益比`,
        type: "line" as const,
        stack: "river",
        smooth: true,
        symbol: "none",
        lineStyle: { width: 0.8, color: BAND_COLORS[k] },
        itemStyle: { color: BAND_COLORS[k] },
        areaStyle: k === 0 ? { opacity: 0 } : { color: BAND_COLORS[k], opacity: dark ? 0.42 : 0.3 },
        data: values.map((v, i) =>
          v === null ? null : k === 0 ? v : +(v - (lines[k - 1][i] ?? 0)).toFixed(2),
        ),
        connectNulls: false,
        z: 1,
      })),
      {
        name: "收盤價",
        type: "line",
        data: prices,
        smooth: true,
        symbolSize: 5,
        lineStyle: { width: 2.4, color: dark ? "#ffffff" : "#1a1f3d" },
        itemStyle: { color: dark ? "#ffffff" : "#1a1f3d" },
        z: 3,
      },
    ],
  };

  const peChart: EChartsOption = {
    backgroundColor: "transparent",
    textStyle: { color: text, fontFamily: "system-ui", fontSize: 12 },
    tooltip: { trigger: "axis" },
    grid: { left: 48, right: 18, top: 28, bottom: 34 },
    xAxis: { type: "category", data: labels, axisLabel: { color: text }, axisLine: { lineStyle: { color: grid } } },
    yAxis: { type: "value", name: "倍", splitLine: { lineStyle: { color: grid } }, axisLabel: { color: text } },
    series: [
      {
        name: "本益比",
        type: "line",
        data: shown.map((r) => r.pe),
        symbolSize: 6,
        connectNulls: false,
        lineStyle: { width: 2, color: "#4f46e5" },
        itemStyle: { color: "#4f46e5" },
        markLine:
          median === null
            ? undefined
            : {
                symbol: "none",
                label: { formatter: `中位數 ${median.toFixed(1)}×`, color: text },
                lineStyle: { type: "dashed", color: "#f39a4b" },
                data: [{ yAxis: +median.toFixed(2) }],
              },
      },
    ],
  };

  return (
    <div className="river-bands">
      <section className="panel chart" aria-label="本益比河流色帶">
        <div className="panel-head">
          <div>
            <h3>本益比河流圖（{ticker}）</h3>
            <span className="muted small">
              {multiples
                ? `六個倍數：自家近 20 季本益比 P10（${multiples[0].toFixed(1)}×）到 P90（${multiples[5].toFixed(1)}×）等距切分 × 各季 TTM EPS`
                : "有效本益比不足 8 季，不產生色帶"}
            </span>
          </div>
          <div className="tools">
            <div className="tabs" role="group" aria-label="河流圖期間">
              {[5, 3, 2].map((y) => (
                <button key={y} className={years === y ? "selected" : ""} aria-pressed={years === y} onClick={() => setYears(y)}>
                  近 {y} 年
                </button>
              ))}
            </div>
            <div className="tabs" role="group" aria-label="河流圖縮放">
              <button className={focus ? "selected" : ""} aria-pressed={focus} onClick={() => setFocus(true)}>
                聚焦股價
              </button>
              <button className={!focus ? "selected" : ""} aria-pressed={!focus} onClick={() => setFocus(false)}>
                完整色帶
              </button>
            </div>
            <button
              aria-label={`本益比河流圖（${ticker}）匯出 CSV`}
              title="匯出 CSV"
              onClick={() =>
                csvDownload(`${ticker}-river.csv`, [
                  ["日期", "標籤", "收盤價", "TTM EPS", "本益比", ...(multiples ?? []).map((m) => `${m.toFixed(2)}x 價格`)],
                  ...shown.map((r, i) => [r.date, r.label, r.price, r.eps_ttm, r.pe, ...lines.map((l) => l[i])]),
                ])
              }
            >
              <Download size={15} />
            </button>
          </div>
        </div>
        <ReactECharts echarts={echarts} option={river} notMerge style={{ height: 380 }} />
        <p className="muted small chart-foot">
          季頻資料（季末收盤價，最後一點為截止日現價），各季之間以平滑曲線連接，曲線形狀為內插。TTM EPS ≤ 0 的季度色帶留空。
          {above !== null && latest?.pe
            ? ` 目前本益比 ${latest.pe.toFixed(1)}×，高於近 20 季中 ${above.toFixed(0)}% 的季度。`
            : ""}
          TTM EPS 被業外收益墊高時，股價會落在色帶下方，不代表便宜。
        </p>
      </section>
      <section className="panel chart" aria-label="歷史本益比">
        <div className="panel-head">
          <div>
            <h3>本益比歷史（近 20 季季末）</h3>
            <span className="muted small">虛線為近 20 季中位數；本益比不適用（TTM EPS ≤ 0）的季度留空</span>
          </div>
        </div>
        <ReactECharts echarts={echarts} option={peChart} notMerge style={{ height: 260 }} />
      </section>
    </div>
  );
}
