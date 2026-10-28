import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { useResearch } from "../lib/research";
import type { Catalog } from "../lib/finance";

const AVATAR = ["#c0392b", "#5b3fd6", "#2f4fb5", "#2f7fb5", "#8e44ad", "#b5308c", "#1f8a9c", "#16a085", "#2e9e74", "#2f9e44", "#9c36b5", "#d9480f", "#1971c2", "#495057"];
const actionClass = (a: string) =>
  a === "加碼" || a === "新建" ? "positive" : a === "減碼" || a === "出清" ? "negative" : "muted";
const mark = (a: string) => (a === "加碼" ? "▲" : a === "減碼" ? "▼" : a === "新建" ? "◆" : a === "出清" ? "×" : "●");
const initials = (name: string) => {
  const zh = name.match(/[一-鿿]/);
  if (zh && /^[一-鿿]/.test(name)) return name.slice(0, 1);
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w))
    .map((w) => w[0])
    .join("")
    .slice(0, 2);
};

export function Gurus({ base, catalog, onSelect }: { base: string; catalog: Catalog; onSelect: (t: string) => void }) {
  const { data, error } = useResearch(base);
  const [active, setActive] = useState("buffett");
  if (error) return <div className="notice error" role="alert">研究資料讀取失敗：{error}</div>;
  if (!data) return <p className="muted">載入 13F 資料中…</p>;
  const ours = new Set(catalog.companies.map((c) => c.ticker));
  const guru = data.gurus.find((g) => g.id === active) ?? data.gurus[0];
  const holdings = data.guru_holdings
    .filter((h) => h.manager === guru.id)
    .sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1));
  const max = Math.max(...holdings.map((h) => h.weight ?? 0), 1);
  // 矩陣欄位：本站收錄、且至少一位大師持有的代號（GOOG／GOOGL 合併為 GOOGL）。
  const norm = (t: string) => (t === "GOOG" ? "GOOGL" : t);
  const cols = [...new Set(data.guru_holdings.map((h) => norm(h.ticker)).filter((t) => ours.has(t)))];
  const cell = (m: string, t: string) => {
    const hs = data.guru_holdings.filter((h) => h.manager === m && norm(h.ticker) === t);
    if (!hs.length) return null;
    const weight = hs.reduce((a, h) => a + (h.weight ?? 0), 0);
    const action = hs.find((h) => h.action !== "不變" && h.action !== "—")?.action ?? hs[0].action;
    return { weight: hs.some((h) => h.weight !== null) ? weight : null, action, option: hs.find((h) => h.option)?.option ?? null };
  };
  const commentary = data.commentary.GURU ?? [];
  return (
    <section id="gurus" className="gurus">
      <div className="section-title">
        <div>
          <span className="eyebrow">13F HOLDINGS</span>
          <h2>13F 大師持股</h2>
        </div>
      </div>
      <p className="muted">
        {data.gurus[0]?.quarter}（6/30 持股，8/14 前申報）；Burry 為 2025 Q3 最後一份。完整的 20 季歷史與報酬推估請看{" "}
        <a href="https://us-stock-tracker.boson316.workers.dev/" target="_blank" rel="noreferrer">
          大師 13F 持股追蹤 <ExternalLink size={12} />
        </a>
        。
      </p>
      <div className="avatar-rail" role="tablist" aria-label="投資人">
        {data.gurus.map((g, i) => (
          <button
            key={g.id}
            role="tab"
            aria-selected={g.id === guru.id}
            className={`avatar-item ${g.id === guru.id ? "on" : ""}`}
            onClick={() => setActive(g.id)}
          >
            <span className="guru-avatar" style={{ background: AVATAR[i % AVATAR.length] }}>
              {initials(g.name)}
            </span>
            <span>{g.name.replace(/ 巴菲特| Li Lu| 基金會/, "").split(" ").at(-1)}</span>
          </button>
        ))}
      </div>
      <div className="panel guru-card">
        <div className="guru-head">
          <span className="guru-avatar large" style={{ background: AVATAR[data.gurus.indexOf(guru) % AVATAR.length] }}>
            {initials(guru.name)}
          </span>
          <div>
            <h3>{guru.name}</h3>
            <span className="muted">{guru.fund}</span>
          </div>
          <span className="pill">{guru.style}</span>
        </div>
        <div className="kpi-row">
          <div className="kpi">
            <span>13F 組合規模 · {guru.quarter}</span>
            <strong>{guru.aum_b ? `$${guru.aum_b.toLocaleString("zh-TW")}B` : "未揭露"}</strong>
          </div>
          <div className="kpi">
            <span>收錄持股</span>
            <strong>{holdings.length}</strong>
          </div>
          <div className="kpi">
            <span>本站收錄的個股</span>
            <strong>{holdings.filter((h) => ours.has(norm(h.ticker))).length}</strong>
          </div>
        </div>
        {guru.note && <p className="muted small">{guru.note}</p>}
        <ul className="guru-holdings">
          {holdings.map((h) => (
            <li key={h.ticker + (h.option ?? "")}>
              <button
                className={`holding-row ${ours.has(norm(h.ticker)) ? "in-scope" : ""}`}
                disabled={!ours.has(h.ticker)}
                onClick={() => onSelect(h.ticker)}
                aria-label={`${h.ticker} ${h.name}`}
              >
                <strong>{h.ticker}</strong>
                <span className="holding-name">
                  {h.name}
                  {h.option ? <small>（{h.option}）</small> : null}
                  {h.note ? <small>{h.note}</small> : null}
                </span>
                <span className="bar">
                  <span style={{ width: `${((h.weight ?? 0) / max) * 100}%` }} />
                </span>
                <span className="holder-weight">{h.weight !== null ? `${h.weight.toFixed(2)}%` : "—"}</span>
                <span className={`action ${actionClass(h.action)}`}>
                  {mark(h.action)} {h.action}
                  {h.chg !== null && !["不變", "出清", "—"].includes(h.action) ? ` ${h.chg > 0 ? "+" : ""}${h.chg}%` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="muted small">
          資料來源：
          <a href={guru.url} target="_blank" rel="noreferrer">
            {new URL(guru.url).hostname}
          </a>{" "}
          等（使用者整理）。比重為占該投資人 13F 組合的 %；選擇權只標示，不計比重。藍底列為本站收錄的個股，可點選查看。
        </p>
      </div>
      <div className="panel">
        <div className="panel-head">
          <h3>大師 × 個股持股矩陣</h3>
          <span className="muted small">占組合 %（GOOG＋GOOGL 合併）；▲ 加碼 ▼ 減碼 ◆ 新建 × 出清</span>
        </div>
        <div className="table-scroll">
          <table className="data-table matrix">
            <thead>
              <tr>
                <th>投資人</th>
                {cols.map((t) => (
                  <th key={t}>
                    <button className="link-button" onClick={() => onSelect(t)}>
                      {t}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.gurus.map((g) => (
                <tr key={g.id}>
                  <th>
                    <button className="link-button" onClick={() => setActive(g.id)}>
                      {g.name}
                    </button>
                  </th>
                  {cols.map((t) => {
                    const v = cell(g.id, t);
                    return (
                      <td key={t} className={v ? actionClass(v.action) : ""}>
                        {v ? `${v.weight !== null ? v.weight.toFixed(1) + "%" : v.option ? "選擇權" : "—"} ${mark(v.action)}` : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {commentary.length > 0 && (
        <div className="panel insight-card">
          <h3>觀察</h3>
          <ul>
            {commentary
              .filter((c) => c.kind !== "caveat")
              .map((c, i) => (
                <li key={i}>{c.text}</li>
              ))}
          </ul>
          <div className="caveat-box">
            <strong>限制</strong>
            <ul>
              {commentary
                .filter((c) => c.kind === "caveat")
                .map((c, i) => (
                  <li key={i}>{c.text}</li>
                ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
