export type Light = "good" | "ok" | "bad" | "na";
export type ScoreItem = {
  /** 面向名稱，例如「成長」 */
  name: string;
  light: Light;
  /** 一句話結論，例如「營收年增 50.9%，高成長」 */
  verdict: string;
  /** 判斷標準 */
  rule: string;
};

const LABEL: Record<Light, string> = { good: "佳", ok: "普通", bad: "注意", na: "不適用" };

/** 總覽最上方的體檢卡：五個面向的紅黃綠燈號與一句話原因。 */
export function Scorecard({ items, asOf }: { items: ScoreItem[]; asOf: string | null }) {
  if (!items.length) return null;
  return (
    <section className="panel scorecard" aria-label="財報體檢">
      <div className="scorecard-head">
        <h3>財報體檢</h3>
        <span className="muted small">{asOf ? `截至 ${asOf} · ` : ""}依官方財報自動判斷，非投資建議</span>
      </div>
      <ul>
        {items.map((it) => (
          <li key={it.name} className={`score-${it.light}`} title={it.rule}>
            <span className="score-dot" aria-hidden="true" />
            <span className="score-name">{it.name}</span>
            <span className="score-badge">{LABEL[it.light]}</span>
            <span className="score-verdict">{it.verdict}</span>
            <small className="score-rule">{it.rule}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
