import { lazy, Suspense } from "react";
import type { Props } from "./FinancialChartImpl";

export type { Series } from "./FinancialChartImpl";

// 圖表套件（ECharts）約占整包程式的一半：按需載入，讓數字卡與文字先出現，圖表隨後補上。
const Impl = lazy(() =>
  import("./FinancialChartImpl").then((m) => ({ default: m.FinancialChart })),
);

/** 載入中先保留同樣高度的空白圖框，畫面不會跳動。 */
function ChartSkeleton({ title, height = 310 }: { title: string; height?: number }) {
  return (
    <section className="panel chart chart-skeleton" aria-label={title} aria-busy="true">
      <div className="panel-head">
        <div>
          <h3>{title}</h3>
          <span className="muted small">圖表載入中…</span>
        </div>
      </div>
      <div className="chart-skeleton-body" style={{ height: height + 60 }} />
    </section>
  );
}

export function FinancialChart(props: Props) {
  return (
    <Suspense fallback={<ChartSkeleton title={props.title} height={props.height} />}>
      <Impl {...props} />
    </Suspense>
  );
}
