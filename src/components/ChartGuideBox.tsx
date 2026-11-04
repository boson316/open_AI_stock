import { Lightbulb } from "lucide-react";
import type { ChartGuide } from "../lib/chartGuides";

/** 圖表下方的「怎麼看」：意義、好壞方向、參考區間、注意事項。 */
export function ChartGuideBox({ guide }: { guide: ChartGuide | null }) {
  if (!guide) return null;
  return (
    <details className="chart-guide" open>
      <summary>
        <Lightbulb size={14} /> 怎麼看這張圖
      </summary>
      <p>
        <strong>代表什麼：</strong>
        {guide.what}
      </p>
      <p>
        <strong>好壞方向：</strong>
        {guide.direction}
      </p>
      {guide.ranges && (
        <table className="guide-ranges">
          <tbody>
            {guide.ranges.map(([range, meaning]) => (
              <tr key={range}>
                <th>{range}</th>
                <td>{meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {guide.caveat && (
        <p className="muted">
          <strong>注意：</strong>
          {guide.caveat}
        </p>
      )}
    </details>
  );
}
