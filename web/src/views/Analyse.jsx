/* Onglet Analyse : portage de renderAnalyse() et de ses graphiques (SVG/CSS faits main, comme l'original). */
import { useState } from "react";
import { Icon } from "../ui/icons.jsx";
import { CatIc, CatIco } from "../ui/bits.jsx";
import { Columns } from "../ui/Columns.jsx";
import { useStore } from "../lib/hooks.js";
import { state, pref, bump, fmt, todayStr, fmtDay, monthLabel, prevKey, nextKey, parseD, dstr, pad, parseAmount, catOf, me, currentWeights,
  bud, eff, inMonth, totalOf, sumBy, incTotal, curKey } from "../lib/core.js";
import { store, toast, handleWriteError } from "../data/store.js";
import { merchantKey, weekStart } from "../lib/domain.js";
import { filterCat } from "./Budget.jsx";

const narrow = k => parseD(k + "-01").toLocaleDateString("fr-FR", {month:"narrow"});

function TwelveMonths(){
  const keys = []; let k = state.month;
  for (let i = 0; i < 12; i++) { keys.unshift(k); k = prevKey(k); }
  const tot = sumBy(state.expenses.filter(e => typeof e.date === "string" && bud(e)), e => e.date.slice(0, 7));
  const vals = keys.map(x => tot[x] || 0), budget = state.settings.budget || 0, max = Math.max(...vals, budget, 1), nz = vals.filter(v => v > 0);
  const pick = x => { state.month = x; state.year = +x.slice(0, 4); state.tab = "budget"; pref.set("pc.tab", "budget"); bump(); };
  return <section className="panel"><h2>12 derniers mois</h2>
    <div className="cols">{keys.map((x, i) => <button key={x} className={"c" + (x === state.month ? " sel" : "")} aria-label={`${monthLabel(x)} : ${fmt(vals[i])}`} title={`${monthLabel(x)} : ${fmt(vals[i])}`} onClick={() => pick(x)}>
      <i style={{height:`calc((100% - 22px) * ${(vals[i] / max).toFixed(4)})`}} /><b>{narrow(x)}</b></button>)}
      {budget > 0 && <span className="bl" style={{bottom:`calc(22px + (100% - 28px) * ${(budget / max).toFixed(4)})`}} title="Budget" />}</div>
    <div className="chart-foot">{nz.length ? <><span>Moyenne : <strong>{fmt(nz.reduce((a, b) => a + b, 0) / nz.length)}</strong> / mois</span><span>Total : <strong>{fmt(vals.reduce((a, b) => a + b, 0))}</strong></span></>
      : <span>Le graphique se remplira au fil des mois.</span>}</div></section>;
}

function Donut(){
  const k = state.month, l = inMonth(state.expenses, k).filter(bud), t = totalOf(l);
  let body;
  if (!t) body = <div className="empty"><Icon name="chart-pie" />Aucune dépense ce mois-ci</div>;
  else {
    const parts = Object.entries(sumBy(l, e => catOf(e.cat).id)).sort((a, b) => b[1] - a[1]);
    const R = 80, r = 50, cx = 85, cy = 85; let a0 = -Math.PI / 2;
    const p = (ang, rad) => `${(cx + rad * Math.cos(ang)).toFixed(2)} ${(cy + rad * Math.sin(ang)).toFixed(2)}`;
    const paths = parts.map(([id, v]) => {
      const a1 = a0 + v / t * Math.PI * 2 - (parts.length > 1 ? 0.01 : 0), large = a1 - a0 > Math.PI ? 1 : 0;
      const d = parts.length === 1 ? `M ${cx} ${cy - R} A ${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R} L ${cx - 0.01} ${cy - r} A ${r} ${r} 0 1 0 ${cx} ${cy - r} Z`
        : `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z`;
      a0 += v / t * Math.PI * 2;
      return <path key={id} d={d} fill={catOf(id).color} onClick={() => filterCat(id)}><title>{catOf(id).name} : {fmt(v)}</title></path>;
    });
    body = <><svg viewBox="0 0 170 170" role="img" aria-label="Répartition par catégorie">{paths}
      <text x="85" y="82" textAnchor="middle" fontSize="11" fill="currentColor" opacity=".6">Total</text><text x="85" y="99" textAnchor="middle" fontSize="14" fontWeight="700" fill="currentColor">{fmt(t)}</text></svg>
      <ul className="legend m0">{parts.map(([id, v]) => <li key={id} onClick={() => filterCat(id)}><span className="dot" style={{background:catOf(id).color}} /><span className="nm">{catOf(id).name}</span><span>{Math.round(v / t * 100)} %</span></li>)}</ul></>;
  }
  return <section className="panel"><h2>Répartition de {monthLabel(k)}</h2><div className="donut">{body}</div></section>;
}

export function detectSubs(){
  const now = curKey(), months = [now, prevKey(now), prevKey(prevKey(now)), prevKey(prevKey(prevKey(now)))];
  const recKeys = new Set(state.recurring.map(r => merchantKey(r.label))), ignored = new Set(state.settings.ignoredSubs || []), groups = {};
  state.expenses.filter(e => !e.recurringId && months.includes(String(e.date).slice(0, 7))).forEach(e => {
    const mk = merchantKey(e.label); if (!mk || recKeys.has(mk) || ignored.has(mk)) return;
    (groups[mk] = groups[mk] || []).push(e);
  });
  return Object.entries(groups).map(([mk, l]) => {
    const ms = new Set(l.map(e => e.date.slice(0, 7)));
    if (ms.size < 3 || l.length > ms.size + 1) return null;
    const amts = l.map(e => e.amount), min = Math.min(...amts), max = Math.max(...amts);
    if (min <= 0 || max / min > 1.05) return null;
    if (["courses", "transport"].includes(catOf(l[0].cat).id)) return null;
    const last = l.sort((a, b) => b.date.localeCompare(a.date))[0];
    return {mk, last, avg:Math.round(amts.reduce((a, b) => a + b, 0) / amts.length), n:ms.size};
  }).filter(Boolean).sort((a, b) => b.avg - a.avg);
}
function Subs({ canEdit }){
  const subs = detectSubs();
  const ignore = async mk => { try { await store.saveSettings({...state.settings, ignoredSubs:(state.settings.ignoredSubs || []).concat(mk).slice(-100)}); } catch (e) { handleWriteError(e); } };
  const fix = async s => {
    const l = s.last, day = Math.min(Number(l.date.slice(8, 10)), 28), start = nextKey(curKey());
    try {
      await store.upsert("recurring", {kind:"expense", amount:l.amount, label:l.label, cat:l.cat, payer:l.payer, split:l.split || "all", shares:l.shares || currentWeights(), day, start, skip:[], by:me() || null, createdAt:Date.now()});
      toast(`« ${l.label} » sera ajouté automatiquement à partir du mois prochain`);
    } catch (e) { handleWriteError(e); }
  };
  return <section className="panel"><h2>Dépenses qui reviennent</h2>
    {subs.length ? <ul className="items">{subs.map(s => <li key={s.mk}><CatIc c={catOf(s.last.cat)} />
      <span className="tx">{s.last.label}<span>≈ {fmt(s.avg)} · {s.n} mois sur 4</span></span>
      {canEdit && <><button className="btn sm" onClick={() => fix(s)}>Rendre fixe</button><button className="x" aria-label={`Ignorer ${s.last.label}`} onClick={() => ignore(s.mk)}><Icon name="x" /></button></>}</li>)}</ul>
      : <div className="empty"><Icon name="circle-check" />Rien à signaler</div>}</section>;
}

function Top(){
  const [scope, setScope] = useState("year");
  const yl = state.expenses.filter(e => String(e.date).startsWith(String(state.year)) && bud(e));
  const src = scope === "month" ? inMonth(state.expenses, state.month) : yl, groups = {};
  src.forEach(e => { const mk = merchantKey(e.label); if (!mk) return; const g = groups[mk] || (groups[mk] = {mk, name:e.label, n:0, v:0, cat:e.cat}); g.n++; g.v += eff(e); });
  const top = Object.values(groups).sort((a, b) => b.v - a.v).slice(0, 10), topMax = top[0]?.v || 1;
  return <section className="panel">
    <div className="phead"><h2>Top des commerçants</h2>
      <select className="inp selauto" aria-label="Période" value={scope} onChange={e => setScope(e.target.value)}><option value="year">Sur l'année</option><option value="month">Sur le mois</option></select></div>
    {top.length ? <ul className="items">{top.map(g => <li key={g.mk}><span className="ic"><Icon name={catOf(g.cat).ico || "tag"} /></span>
      <span className="tx">{g.name}<span>{g.n} fois</span><span className="track mt6"><i style={{width:(g.v / topMax * 100).toFixed(1) + "%", background:catOf(g.cat).color}} /></span></span><b>{fmt(g.v)}</b></li>)}</ul>
      : <div className="empty"><Icon name="store" />Pas encore de données</div>}</section>;
}

function Year({ actions }){
  const y = String(state.year), yl = state.expenses.filter(e => String(e.date).startsWith(y) && bud(e)), yi = state.incomes.filter(e => String(e.date).startsWith(y));
  let ys = 0; state.goals.forEach(g => (g.history || []).forEach(h => { if (String(h.date).startsWith(y)) ys += h.amount || 0; }));
  const ye = totalOf(yl), yinc = incTotal(yi), byCat = sumBy(yl, e => catOf(e.cat).id), months = new Set(yl.map(e => e.date.slice(0, 7))).size || 1;
  const cb = state.settings.catBudgets || {}, rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const setYear = d => { state.year += d; bump(); };
  return <section className="panel">
    <div className="month"><button aria-label="Année précédente" onClick={() => setYear(-1)}>‹</button><span className="month-name">Bilan {y}</span><button aria-label="Année suivante" onClick={() => setYear(1)}>›</button></div>
    <div className="kpis"><div className="kpi"><span>Dépenses</span><b>{fmt(ye)}</b></div><div className="kpi"><span>Revenus</span><b>{fmt(yinc)}</b></div><div className="kpi"><span>Épargné</span><b>{fmt(ys)}</b></div></div>
    <h3>Par catégorie</h3>
    <div className="scroll" tabIndex={0} role="region" aria-label={`Dépenses ${y} par catégorie`}>{rows.length ? <table className="t"><thead><tr><th>Catégorie</th><th>Total</th><th>%</th><th>Moy./mois</th><th>Budget an.</th></tr></thead>
      <tbody>{rows.map(([id, v]) => <tr key={id}><td><CatIco c={catOf(id)} /> {catOf(id).name}</td><td>{fmt(v)}</td><td>{Math.round(v / ye * 100)} %</td><td>{fmt(v / months)}</td>
        <td className={cb[id] && v > cb[id] * 12 ? "over" : ""}>{cb[id] ? fmt(cb[id] * 12) : "—"}</td></tr>)}</tbody>
      <tfoot><tr><td>Total</td><td>{fmt(ye)}</td><td></td><td>{fmt(ye / months)}</td><td>{state.settings.budget ? fmt(state.settings.budget * 12) : "—"}</td></tr></tfoot></table>
      : <p className="muted">Aucune dépense en {y}.</p>}</div>
    <div className="actions"><button className="btn sm" onClick={() => actions.wrap && actions.wrap(state.year)}><Icon name="gift" />Récap de l'année</button>
      <button className="btn sm ghost push" onClick={() => actions.pdfYear && actions.pdfYear()}>Exporter l'année en PDF</button></div>
  </section>;
}

function YoY(){
  const k = state.month, [y, m] = k.split("-").map(Number), k0 = `${y - 1}-${pad(m)}`;
  const a = inMonth(state.expenses, k).filter(bud), b = inMonth(state.expenses, k0).filter(bud);
  const ytd = x => state.expenses.filter(e => bud(e) && String(e.date).slice(0, 4) === String(x) && e.date.slice(5, 7) <= pad(m));
  const ta = totalOf(a), tb = totalOf(b), ya = totalOf(ytd(y)), yb = totalOf(ytd(y - 1));
  let body;
  if (!tb && !yb) body = <div className="empty"><Icon name="calendar" />Pas encore un an d'historique</div>;
  else {
    const ca = sumBy(a, e => catOf(e.cat).id), cbb = sumBy(b, e => catOf(e.cat).id);
    const ids = Array.from(new Set([...Object.keys(ca), ...Object.keys(cbb)])).sort((p, q) => Math.abs((ca[q] || 0) - (cbb[q] || 0)) - Math.abs((ca[p] || 0) - (cbb[p] || 0))).slice(0, 8);
    const delta = (x, z) => z ? <span className={x > z ? "up" : "down"}>{x >= z ? "+" : "−"}{Math.abs(Math.round((x - z) / z * 100))} %</span> : "—";
    body = <><div className="kpis"><div className="kpi"><span>{monthLabel(k)}</span><b>{fmt(ta)}</b></div><div className="kpi"><span>{monthLabel(k0)}</span><b>{fmt(tb)}</b></div><div className="kpi"><span>Écart</span><b>{delta(ta, tb)}</b></div></div>
      <div className="scroll" tabIndex={0} role="region" aria-label="Comparaison par catégorie"><table className="t"><thead><tr><th>Catégorie</th><th>{y - 1}</th><th>{y}</th><th>Écart</th></tr></thead>
        <tbody>{ids.map(id => <tr key={id}><td><CatIco c={catOf(id)} /> {catOf(id).name}</td><td>{fmt(cbb[id] || 0)}</td><td>{fmt(ca[id] || 0)}</td><td>{delta(ca[id] || 0, cbb[id] || 0)}</td></tr>)}</tbody></table></div>
      <p className="small mt10 m0b">Depuis janvier : <strong>{fmt(ya)}</strong> en {y}, contre {fmt(yb)} à la même période de {y - 1} ({delta(ya, yb)}).</p></>;
  }
  return <section className="panel"><h2>{monthLabel(k)} vs {monthLabel(k0)}</h2>{body}</section>;
}

function Heat(){
  const y = state.year;
  const byDay = sumBy(state.expenses.filter(e => bud(e) && String(e.date).startsWith(String(y)) && !e.recurringId), e => e.date);
  const vals = Object.values(byDay).filter(v => v > 0).sort((a, b) => a - b);
  const q = p => vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : 0, th = [q(.25), q(.5), q(.75)];
  const lvl = v => !v ? 0 : v <= th[0] ? 1 : v <= th[1] ? 2 : v <= th[2] ? 3 : 4, op = [0, .25, .5, .75, 1];
  const d = weekStart(new Date(y, 0, 1)), end = new Date(y, 11, 31), t = todayStr(), cells = []; let zero = 0, maxD = null;
  while (d <= end) {
    const ds = dstr(d), inY = d.getFullYear() === y, v = byDay[ds] || 0;
    if (inY && ds <= t && !v) zero++;
    if (v && (!maxD || v > byDay[maxD])) maxD = ds;
    cells.push(inY ? <i key={ds} title={`${fmtDay(ds, {weekday:"short", day:"numeric", month:"short"})} : ${fmt(v)}`} style={v ? {background:"var(--accent)", opacity:op[lvl(v)]} : undefined} />
      : <i key={ds} className="hid" />);
    d.setDate(d.getDate() + 1);
  }
  return <section className="panel"><h2>Chaque jour de {y}</h2><div className="heat">{cells}</div>
    <p className="muted small mt8 m0b">{vals.length ? `Hors dépenses fixes. ${zero} jour${zero > 1 ? "s" : ""} sans dépense${maxD ? ` · jour le plus chargé : ${fmtDay(maxD, {day:"numeric", month:"long"})} (${fmt(byDay[maxD])})` : ""}.` : "Aucune dépense cette année."}</p></section>;
}

/* Simulateur : l'état survit aux changements d'onglet, comme dans l'original */
const simState = {cuts:{}, cancel:{}, extra:""};
function Sim(){
  const [, force] = useState(0), upd = f => { f(); force(x => x + 1); };
  const nowK = curKey(), ks = [prevKey(nowK), prevKey(prevKey(nowK)), prevKey(prevKey(prevKey(nowK)))], avg = {};
  ks.forEach(k => Object.entries(sumBy(inMonth(state.expenses, k).filter(e => bud(e) && !e.recurringId), e => catOf(e.cat).id)).forEach(([c, v]) => avg[c] = (avg[c] || 0) + v / 3));
  const cats = Object.entries(avg).sort((a, b) => b[1] - a[1]).slice(0, 6), recs = state.recurring.filter(r => r.kind !== "income").sort((a, b) => b.amount - a.amount);
  const cut = Object.values(simState.cuts).reduce((s, v) => s + (parseAmount(v) || 0), 0), canc = recs.filter(r => simState.cancel[r.id]).reduce((s, r) => s + r.amount, 0);
  const monthly = cut + canc + (parseAmount(simState.extra) || 0), goals = state.goals.filter(g => g.saved < g.target);
  return <section className="panel"><h2>Simulateur « et si… »</h2><div>
    {cats.length > 0 && <><p className="small muted simlab">Réduire une dépense (moyenne des 3 derniers mois) :</p>
      {cats.map(([id, v]) => <div className="simrow" key={id}><span><CatIco c={catOf(id)} /> {catOf(id).name} <span className="muted small">≈ {fmt(v)}/mois</span></span>
        <input className="inp r" inputMode="decimal" placeholder="− €/mois" aria-label={`Réduction ${catOf(id).name}`} value={simState.cuts[id] || ""} onChange={e => upd(() => simState.cuts[id] = e.target.value)} /></div>)}</>}
    {recs.length > 0 && <><p className="small muted simlab2">Résilier une dépense fixe :</p>
      {recs.slice(0, 8).map(r => <label key={r.id} className="check small fw4"><input type="checkbox" checked={!!simState.cancel[r.id]} onChange={e => upd(() => simState.cancel[r.id] = e.target.checked)} /> {r.label || catOf(r.cat).name} ({fmt(r.amount)}/mois)</label>)}</>}
    <div className="simrow mt10"><span>Revenu en plus</span><input className="inp r" inputMode="decimal" placeholder="+ €/mois" aria-label="Revenu supplémentaire" value={simState.extra} onChange={e => upd(() => simState.extra = e.target.value)} /></div>
    <div className="kpis mt12"><div className="kpi"><span>Par mois</span><b className="down">{fmt(monthly)}</b></div><div className="kpi"><span>Par an</span><b className="down">{fmt(monthly * 12)}</b></div><div className="kpi"><span>En 5 ans</span><b className="down">{fmt(monthly * 60)}</b></div></div>
    {monthly > 0 && goals.length > 0 && <p className="small mt10 m0b">{goals.slice(0, 3).map((g, i) => <span key={g.id}>{i > 0 && <br />}{g.name} : atteint en <b>{Math.ceil((g.target - g.saved) / monthly)} mois</b> avec ces économies seules.</span>)}</p>}
  </div></section>;
}

function Prices(){
  const [sel, setSel] = useState("");
  const groups = {};
  state.expenses.forEach(e => { const k = merchantKey(e.label); if (k) (groups[k] = groups[k] || []).push(e); });
  const keys = Object.keys(groups).filter(k => groups[k].length >= 3).sort((a, b) => groups[b].length - groups[a].length).slice(0, 40);
  const cur = keys.includes(sel) ? sel : keys[0];
  let body;
  if (!cur) body = <div className="empty"><Icon name="tag" />Pas assez d'achats identiques</div>;
  else {
    const l = groups[cur].slice().sort((a, b) => a.date.localeCompare(b.date)), byM = {};
    l.forEach(e => (byM[e.date.slice(0, 7)] = byM[e.date.slice(0, 7)] || []).push(e.amount));
    const ms = Object.keys(byM).sort().slice(-12), avgs = ms.map(m => byM[m].reduce((a, b) => a + b, 0) / byM[m].length), max = Math.max(...avgs, 1);
    const first = avgs[0], last = avgs[avgs.length - 1], p = first ? Math.round((last - first) / first * 100) : 0;
    body = <><div className="kpis"><div className="kpi"><span>Montant moyen</span><b>{fmt(l.reduce((s, e) => s + e.amount, 0) / l.length)}</b></div>
      <div className="kpi"><span>Min / max</span><b>{fmt(Math.min(...l.map(e => e.amount)))} – {fmt(Math.max(...l.map(e => e.amount)))}</b></div>
      <div className="kpi"><span>Évolution</span><b className={p > 0 ? "up" : p < 0 ? "down" : ""}>{ms.length > 1 ? (p >= 0 ? "+" : "−") + Math.abs(p) + " %" : "—"}</b></div></div>
      <div className="cols h110">{ms.map((m, i) => <div className="c" key={m} title={`${monthLabel(m)} : ${fmt(avgs[i])} en moyenne (${byM[m].length} achat${byM[m].length > 1 ? "s" : ""})`}>
        <i style={{height:`calc((100% - 22px) * ${(avgs[i] / max).toFixed(4)})`}} /><b>{narrow(m)}</b></div>)}</div></>;
  }
  return <section className="panel">
    <div className="phead"><h2>Suivi des prix</h2>{keys.length > 0 && <select className="inp selauto sel55" aria-label="Commerçant ou article" value={cur} onChange={e => setSel(e.target.value)}>
      {keys.map(k => <option key={k} value={k}>{groups[k][0].label} ({groups[k].length})</option>)}</select>}</div>{body}</section>;
}

function Deduct(){
  const y = String(state.year), dl = state.expenses.concat(state.privates).filter(e => e.deductible && String(e.date).startsWith(y)).sort((a, b) => a.date.localeCompare(b.date));
  return <section className="panel"><h2>Déductible des impôts</h2>
    {dl.length ? <><ul className="items">{dl.map(e => <li key={e.id}><span className="ic"><Icon name="receipt" /></span><span className="tx">{e.label || catOf(e.cat).name}<span>{fmtDay(e.date, {day:"numeric", month:"short", year:"numeric"})} · {catOf(e.cat).name}</span></span><b>{fmt(eff(e))}</b></li>)}</ul>
      <p className="small mt10 m0b">Total {y} : <strong>{fmt(totalOf(dl))}</strong></p></>
      : <div className="empty"><Icon name="receipt" />Aucune dépense déductible</div>}</section>;
}

export default function Analyse({ canEdit, actions }){
  useStore();
  return <Columns className="grid even"
    left={[<TwelveMonths key="m12" />, <Donut key="donut" />, <Subs key="subs" canEdit={canEdit} />, <Top key="top" />]}
    right={[<Year key="year" actions={actions} />, <YoY key="yoy" />, <Heat key="heat" />, <Sim key="sim" />, <Prices key="prices" />, <Deduct key="deduct" />]} />;
}
