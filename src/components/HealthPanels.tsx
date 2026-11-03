import type { Fact } from "../lib/finance";
import { cccHistory, debtHistory, fVerdict, piotroskiHistory } from "../lib/health";
import { FinancialChart } from "./FinancialChart";

type Props = {
  dark: boolean;
  quarters: Fact[];
  /** 金額顯示單位（例如 1e6 = 百萬） */
  unit: number;
  unitLabel: string;
  isFinancial: boolean;
  /** 圖表顯示近幾年 */
  years: number;
};

const num = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? "N/A"
    : v.toLocaleString("zh-TW", { maximumFractionDigits: digits });
const round = (v: number | null, digits = 1) =>
  v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** digits) / 10 ** digits;

const recent = <T extends { date: string }>(rows: T[], years: number) => {
  const lastDate = rows.at(-1)?.date;
  if (!lastDate) return rows;
  const cutoff = `${Number(lastDate.slice(0, 4)) - years}${lastDate.slice(4)}`;
  return rows.filter((r) => r.date > cutoff);
};

const pending = (what: string) => (
  <p className="notice">
    尚無{what}資料。這些欄位剛加入 SEC 資料管線，下一次「Financial Update」自動更新並合併後就會出現。
  </p>
);

/** 長短期金融借款、現金週轉循環、Piotroski F 分數。 */
export function HealthPanels({ dark, quarters, unit, unitLabel, isFinancial, years }: Props) {
  return (
    <div className="valuation-tools">
      <Piotroski quarters={quarters} dark={dark} isFinancial={isFinancial} />
      <Debt quarters={quarters} dark={dark} unit={unit} unitLabel={unitLabel} years={years} />
      {!isFinancial && <Ccc quarters={quarters} dark={dark} years={years} />}
    </div>
  );
}

function Piotroski({ quarters, dark, isFinancial }: { quarters: Fact[]; dark: boolean; isFinancial: boolean }) {
  const history = piotroskiHistory(quarters);
  const latest = history.at(-1) ?? null;
  const prev = latest
    ? history.find((h) => Math.abs(Date.parse(latest.end) - Date.parse(h.end) - 365 * 86400000) < 25 * 86400000)
    : null;
  const verdict = latest ? fVerdict(latest.score, latest.scorable) : null;
  return (
    <section className="panel tool-panel" aria-label="Piotroski F 分數">
      <div className="panel-head">
        <div>
          <h3>Piotroski F 分數</h3>
          <span className="muted small">
            用 9 個是非題檢查獲利、財務結構與經營效率是否「比去年更好」；每題 1 分，8–9 分強健、0–4 分偏弱
          </span>
        </div>
      </div>
      {!latest ? (
        pending("足夠的")
      ) : (
        <>
          <div className="kpi-row">
            <div className="kpi">
              <span>最新分數（截至 {latest.end}）</span>
              <strong className={verdict!.tone}>
                {latest.score} / {latest.scorable}
              </strong>
            </div>
            <div className="kpi">
              <span>一年前</span>
              <strong>{prev ? `${prev.score} / ${prev.scorable}` : "N/A"}</strong>
            </div>
            <div className="kpi">
              <span>可評分項目</span>
              <strong>{latest.scorable} / 9</strong>
            </div>
          </div>
          <p className={`verdict ${verdict!.tone}`}>{verdict!.text}</p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>面向</th>
                  <th>檢查項目</th>
                  <th>結果</th>
                  <th>數據（去年 → 今年）</th>
                </tr>
              </thead>
              <tbody>
                {latest.tests.map((t) => (
                  <tr key={t.key}>
                    <th>{t.group}</th>
                    <td className="wrap">
                      <strong>{t.label}</strong>
                      <span className="cell-meta">{t.rule}</span>
                    </td>
                    <td className={t.pass === null ? "muted" : t.pass ? "positive" : "negative"}>
                      {t.pass === null ? "缺資料" : t.pass ? "✓ 1 分" : "✗ 0 分"}
                    </td>
                    <td>{t.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {history.length > 1 && (
            <FinancialChart
              title="F 分數歷史"
              dates={history.map((h) => h.end)}
              dark={dark}
              unit="分"
              initialType="bar"
              series={[{ name: "F 分數", values: history.map((h) => h.score) }]}
            />
          )}
          <p className="muted small">
            以最近四季（TTM）與再前四季比較；資產負債表項目取期末值，報酬率與週轉率用期初總資產。缺資料的項目不計分，分母改為可評分項目數。
            {isFinancial ? "金融機構的流動比率與負債結構意義不同，分數僅供參考。" : ""}
            台積電的流動資產／負債、長期借款只有年報，季度分數會少幾項。僅供研究，不構成投資建議。
          </p>
        </>
      )}
    </section>
  );
}

function Debt({ quarters, dark, unit, unitLabel, years }: { quarters: Fact[]; dark: boolean; unit: number; unitLabel: string; years: number }) {
  const rows = recent(debtHistory(quarters), years);
  const latest = rows.filter((r) => r.total !== null).at(-1);
  const scale = (v: number | null) => (v === null ? null : round(v / unit, 2));
  const netCash = latest && latest.cash !== null ? latest.cash - latest.total! : null;
  const de = latest && latest.equity ? latest.total! / latest.equity : null;
  const shortShare = latest && latest.total ? (latest.shortTerm! + latest.currentLongTerm!) / latest.total : null;
  return (
    <section className="panel tool-panel" aria-label="長短期金融借款">
      <div className="panel-head">
        <div>
          <h3>長短期金融借款</h3>
          <span className="muted small">
            要付利息的借款（不含應付帳款等營運負債）：一年內要還的短期部分，與一年以上的長期借款
          </span>
        </div>
      </div>
      {!latest ? (
        pending("金融借款")
      ) : (
        <>
          <div className="kpi-row">
            <div className="kpi">
              <span>金融借款合計（{latest.date}）</span>
              <strong>
                {num(scale(latest.total), 0)} <small className="muted">{unitLabel}</small>
              </strong>
            </div>
            <div className="kpi">
              <span>一年內到期占比</span>
              <strong>{shortShare === null ? "N/A" : `${(shortShare * 100).toFixed(0)}%`}</strong>
            </div>
            <div className="kpi">
              <span>{netCash !== null && netCash >= 0 ? "淨現金（現金 − 借款）" : "淨負債（借款 − 現金）"}</span>
              <strong className={netCash === null ? "" : netCash >= 0 ? "positive" : "negative"}>
                {num(scale(netCash === null ? null : Math.abs(netCash)), 0)}
              </strong>
            </div>
            <div className="kpi">
              <span>借款 ÷ 股東權益</span>
              <strong>{de === null ? "N/A" : `${(de * 100).toFixed(0)}%`}</strong>
            </div>
          </div>
          <FinancialChart
            title="長短期金融借款"
            dates={rows.map((r) => r.date)}
            dark={dark}
            unit={unitLabel}
            initialType="stack"
            series={[
              { name: "短期借款（含商業本票）", values: rows.map((r) => scale(r.shortTerm)) },
              { name: "一年內到期長期負債", values: rows.map((r) => scale(r.currentLongTerm)) },
              { name: "長期借款", values: rows.map((r) => scale(r.longTerm)) },
            ]}
          />
          <p className="muted small">
            依公司在 SEC 申報的借款科目；公司從未申報的科目視為 0（多數大型科技公司沒有短期借款）。現金只含現金及約當現金，不含短期投資，
            實際的淨現金通常更高。租賃負債不計入。
          </p>
        </>
      )}
    </section>
  );
}

function Ccc({ quarters, dark, years }: { quarters: Fact[]; dark: boolean; years: number }) {
  const rows = recent(cccHistory(quarters), years);
  const latest = rows.filter((r) => r.ccc !== null).at(-1);
  const noInventory = !quarters.some((f) => f.metric === "inventory");
  return (
    <section className="panel tool-panel" aria-label="現金週轉循環">
      <div className="panel-head">
        <div>
          <h3>現金週轉循環</h3>
          <span className="muted small">
            從付錢買料到收回貨款要幾天：應收帳款天數 + 存貨天數 − 應付帳款天數。越短代表資金卡在營運中的時間越少
          </span>
        </div>
      </div>
      {!latest ? (
        pending("應收、存貨、應付帳款")
      ) : (
        <>
          <div className="kpi-row">
            <div className="kpi">
              <span>現金週轉天數（{latest.date}）</span>
              <strong>{num(latest.ccc, 0)} 天</strong>
            </div>
            <div className="kpi">
              <span>應收帳款天數</span>
              <strong>{num(latest.dso, 0)} 天</strong>
            </div>
            <div className="kpi">
              <span>存貨天數</span>
              <strong>{noInventory ? "無存貨" : `${num(latest.dio, 0)} 天`}</strong>
            </div>
            <div className="kpi">
              <span>應付帳款天數</span>
              <strong>{num(latest.dpo, 0)} 天</strong>
            </div>
          </div>
          <FinancialChart
            title="現金週轉循環（天）"
            dates={rows.map((r) => r.date)}
            dark={dark}
            unit="天"
            initialType="line"
            series={[
              { name: "現金週轉天數", values: rows.map((r) => round(r.ccc)) },
              { name: "應收帳款天數", values: rows.map((r) => round(r.dso)) },
              { name: "存貨天數", values: rows.map((r) => round(r.dio)) },
              { name: "應付帳款天數", values: rows.map((r) => round(r.dpo)) },
            ]}
          />
          <p className="muted small">
            以期末餘額 ÷ 當季營收（應收）或當季營業成本（存貨、應付）× 當季天數計算，與公司自行公布的平均餘額算法可能有幾天差距。
            {noInventory ? "此公司沒有申報存貨，存貨天數以 0 計。" : ""}
            負數代表公司先收到客戶的錢、後付供應商的錢。
          </p>
        </>
      )}
    </section>
  );
}
