import { useEffect, useRef, useState } from "react";
import ReactECharts from "echarts-for-react/lib/core";
import type { EChartsOption } from "echarts";
import * as echarts from "echarts/core";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from "echarts/components";
import { CanvasRenderer, SVGRenderer } from "echarts/renderers";
import { Download, Expand } from "lucide-react";
import { csvDownload } from "../lib/finance";
echarts.use([BarChart, LineChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer, SVGRenderer]);
export type Series = { name: string; values: (number | null)[] };
type Props = {
  title: string;
  dates: string[];
  series: Series[];
  unit?: string;
  dark: boolean;
  initialType?: string;
  log?: boolean;
  dualAxis?: boolean;
};
export function FinancialChart({
  title,
  dates,
  series,
  unit = "百萬美元",
  dark,
  initialType = "bar",
  log = false,
  dualAxis = false,
}: Props) {
  const ref = useRef<ReactECharts>(null),
    box = useRef<HTMLElement>(null);
  const [kind, setKind] = useState(initialType);
  const hasData = series.some((s) => s.values.some((v) => v !== null));
  useEffect(() => {
    if (!hasData || !box.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const instance = ref.current?.getEchartsInstance();
      if (instance && !instance.isDisposed()) instance.resize();
    });
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [hasData]);
  const option: EChartsOption = {
    backgroundColor: dark ? "#142027" : "#ffffff",
    color: ["#288a79", "#8095b4", "#c4a169", "#98bfb7", "#64748b", "#d8be95"],
    textStyle: { color: dark ? "#bac9d0" : "#617078", fontFamily: "system-ui" },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) =>
        value == null
          ? "N/A"
          : Number(value).toLocaleString("zh-TW", { maximumFractionDigits: 2 }),
    },
    legend: {
      top: 4,
      textStyle: { color: dark ? "#bac9d0" : "#617078" },
      type: "scroll",
    },
    grid: { left: 68, right: dualAxis ? 65 : 22, top: 64, bottom: 68 },
    xAxis: {
      type: "category",
      data: dates,
      axisLine: { lineStyle: { color: "#899c9a44" } },
    },
    yAxis: dualAxis
      ? [
          {
            type: "value",
            name: unit,
            splitLine: { lineStyle: { color: "#899c9a22" } },
          },
          { type: "value", name: "美元／股", splitLine: { show: false } },
        ]
      : {
          type: log ? "log" : "value",
          name: unit,
          splitLine: { lineStyle: { color: "#899c9a22" } },
        },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 16, bottom: 12 }],
    series: series.map((s, i) => ({
      name: s.name,
      type:
        kind === "scatter"
          ? "scatter"
          : kind === "line" || kind === "area" || (dualAxis && i === 1)
            ? "line"
            : "bar",
      yAxisIndex: dualAxis && i === 1 ? 1 : 0,
      data: s.values,
      barMaxWidth: 30,
      stack: kind === "stack" ? "total" : undefined,
      areaStyle: kind === "area" ? { opacity: 0.12 } : undefined,
      smooth: false,
      connectNulls: false,
      symbolSize: 5,
    })),
  };
  function image(format: "png" | "svg") {
    const chart = ref.current?.getEchartsInstance();
    if (!chart) return;
    let url: string;
    if (format === "svg") {
      const container = document.createElement("div");
      const svgChart = echarts.init(container, undefined, {
        renderer: "svg",
        width: chart.getWidth(),
        height: chart.getHeight(),
      });
      svgChart.setOption({ ...option, animation: false });
      url =
        "data:image/svg+xml;charset=UTF-8," +
        encodeURIComponent(svgChart.renderToSVGString());
      svgChart.dispose();
    } else
      url = chart.getDataURL({
        type: "png",
        pixelRatio: 2,
        backgroundColor: dark ? "#142027" : "#fff",
      });
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}.${format}`;
    a.click();
  }
  return (
    <section className="panel chart" ref={box} aria-label={title}>
      <div className="panel-head">
        <div>
          <h3>{title}</h3>
          <span className="muted small">
            單位：{unit} · 拖曳縮放、點選圖例切換
          </span>
        </div>
        <div className="tools">
          <select
            aria-label={`${title}圖表類型`}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="bar">群組柱狀</option>
            <option value="line">折線</option>
            <option value="area">面積</option>
            <option value="stack">堆疊</option>
            <option value="scatter">散布</option>
          </select>
          <button
            title="匯出 CSV"
            aria-label={`${title}匯出 CSV`}
            onClick={() =>
              csvDownload(`${title}.csv`, [
                ["日期", ...series.map((s, i) => `${s.name} (${dualAxis && i === 1 ? "美元／股" : unit})`)],
                ...dates.map((d, i) => [d, ...series.map((s) => s.values[i])]),
              ])
            }
          >
            <Download size={15} />
          </button>
          <button onClick={() => image("png")}>PNG</button>
          <button onClick={() => image("svg")}>SVG</button>
          <button
            aria-label={`${title}全螢幕`}
            onClick={() => {
              void box.current?.requestFullscreen?.();
            }}
          >
            <Expand size={15} />
          </button>
        </div>
      </div>
      {hasData ? (
        <ReactECharts
          echarts={echarts}
          ref={ref}
          option={option}
          notMerge
          opts={{ renderer: "canvas" }}
          style={{ height: 310 }}
        />
      ) : (
        <div className="chart-empty">
          <span className="empty-mark">—</span>
          <p>尚無可驗證的{title}資料</p>
          <span className="muted small">
            完成官方財報更新後，將在這裡呈現。
          </span>
        </div>
      )}
    </section>
  );
}
