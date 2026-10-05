/* Onglet Budget : portage de renderBudget() et de ses panneaux. */
import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icons.jsx";
import { MAvatar, CatIc, Empty, Track, PctDelta } from "../ui/bits.jsx";
import { openDialog } from "../ui/Dialog.jsx";
import { Columns } from "../ui/Columns.jsx";
import { useStore } from "../lib/hooks.js";
import { state, pref, bump, HIDE, fmt, fmt0, fmtCur, toInput, parseAmount, todayStr, fmtDay, monthLabel, prevKey, nextKey, keyOf, daysBetween, dstr,
  allCats, catOf, members, memberName, projectOf, bud, sharesOf, eff, inMonth, totalOf, sumBy, incTotal, periodOf, curKey, MS } from "../lib/core.js";
import { SV, store, toast, handleWriteError } from "../data/store.js";
import { savedIn, balancesAll, settlements, forecast, catAvail, subsOf, weekStatus, potBalance, recDesc, monthlyEq, upcomingEvents, choreDue, choreWho,
  chalEval, since, allTags, alertsList, panelCfg, panelOn, logAct, removeWithUndo } from "../lib/domain.js";
import { openExpense, openIncome, openTransfer, openAccount, openKindChooser, openBudgets, exitSel, deleteSelection } from "../dialogs/Money.jsx";
import { deleteExpense } from "../dialogs/Expense.jsx";

const reduceMotion = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
const plural = (n, w) => `${n} ${w}${n > 1 ? "s" : ""}`;

export function filterCat(id){
  state.flt.cat = id; state.tab = "budget"; pref.set("pc.tab", "budget"); bump();
  setTimeout(() => document.getElementById("list")?.scrollIntoView({behavior:"smooth", block:"start"}), 30);
  toast(`Filtré sur ${catOf(id).name}`, "Tout voir", () => { state.flt.cat = ""; bump(); });
}

/** Nombre animé (total du mois) */
function AnimatedAmount({ value, monthKey }){
  const [shown, setShown] = useState(value), last = useRef({v:null, k:null});
  useEffect(() => {
    const {v:prev, k} = last.current, from = k !== monthKey ? (prev == null ? 0 : prev) : prev;
    last.current = {v:value, k:monthKey};
    if (!window.requestAnimationFrame || reduceMotion() || HIDE || from === value || from == null) { setShown(value); return; }
    const t0 = performance.now(); let raf;
    const step = t => { const p = Math.min(1, (t - t0) / 450), e = 1 - Math.pow(1 - p, 3); setShown(from + (value - from) * e); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf);
  }, [value, monthKey]);
  return <div className="total">{fmt(shown)}</div>;
}

function Alerts({ actions }){
  if (state.month !== curKey()) return null;
  return <div className="alerts">{alertsList().map((a, i) => <div className="alert" key={i}><b>{a.strong}</b>{a.text}
    {a.backup && <button className="linkbtn" onClick={() => actions.backup && actions.backup()}>Sauvegarder maintenant</button>}</div>)}</div>;
}

function FirstSteps({ canEdit, ready, actions }){
  const key = "pc.fs.hide" + (SV.hh ? "." + SV.hh.id : ""), [hidden, setHidden] = useState(pref.get(key, "") === "1");
  const L = state.loaded, loaded = ready && L.expenses && L.incomes && L.accounts && L.groups && L.settings;
  if (!canEdit || !loaded || hidden) return null;
  const hh = SV.hh ? (SV.households.find(h => h.id === SV.hh.id) || {}) : {};
  const steps = [
    {done:state.accounts.length > 0, t:"Créer un compte bancaire", go:() => openAccount(null)},
    {done:state.expenses.length > 0, t:"Ajouter une première dépense", go:openKindChooser},
    {done:state.incomes.length > 0, t:"Enregistrer un revenu", go:() => openIncome(null)},
    {done:(state.settings.budget || 0) > 0 || Object.keys(state.settings.catBudgets || {}).length > 0, t:"Fixer un budget mensuel", go:actions.settings},
    ...(SV.role === "owner" ? [{done:(hh.members || 1) > 1, t:"Inviter un proche dans le foyer", go:actions.settings}] : []),
    {done:state.groups.length > 0, t:"Créer un compte entre amis", go:actions.addGroup},
  ];
  const n = steps.filter(x => x.done).length;
  if (n === steps.length) return null;
  return (
    <section className="panel fsteps" aria-labelledby="fsTitle">
      <div className="phead"><h2 id="fsTitle">Premiers pas</h2><span className="muted small">{n} / {steps.length}</span>
        <button type="button" className="linkbtn push" onClick={() => { pref.set(key, "1"); setHidden(true); }}>Masquer</button></div>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={n} aria-label="Progression"><i style={{width:Math.round(n / steps.length * 100) + "%"}} /></div>
      <ul>{steps.map(x => <li key={x.t} className={x.done ? "done" : ""}><button type="button" disabled={x.done} onClick={() => x.go && x.go()}>
        <span className="ck" aria-hidden="true">{x.done ? <Icon name="check" /> : null}</span><span>{x.t}</span><span className="sr-only">{x.done ? " (fait)" : ""}</span></button></li>)}</ul>
    </section>
  );
}

function Today(){
  const t = todayStr(), tm = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return dstr(d); })(), items = [];
  const spent = totalOf(state.expenses.filter(e => e.date === t && !e.recurringId));
  items.push(["wallet", spent ? <>Dépensé aujourd'hui : <b>{fmt(spent)}</b></> : "Aucune dépense aujourd'hui"]);
  state.todos.filter(x => !x.done && x.due && x.due <= t).forEach(x => items.push(["pin", <>{x.due < t ? <><b className="over">En retard</b> : </> : "À payer aujourd'hui : "}{x.title}{x.amount ? " (" + fmt(x.amount) + ")" : ""}</>]));
  upcomingEvents(5).filter(e => e.next <= tm).forEach(e => items.push(["cake", `${e.next === t ? "Aujourd'hui" : "Demain"} : ${e.title}`]));
  state.chores.filter(c => choreDue(c) <= t).forEach(c => items.push(["brush", <>{c.name} — au tour de <b>{memberName(choreWho(c))}</b></>]));
  state.health.filter(h => h.date && h.date.slice(0, 10) >= t && h.date.slice(0, 10) <= tm).forEach(h => items.push(["stethoscope", `${h.date.slice(0, 10) === t ? "Aujourd'hui" : "Demain"}${h.date.length > 10 ? " à " + h.date.slice(11, 16) : ""} : ${h.label}${h.person ? " (" + h.person + ")" : ""}`]));
  state.inventory.filter(i => i.expiry && i.expiry <= tm).forEach(i => items.push(["snowflake", `${i.name} ${i.expiry < t ? "est périmé" : "à consommer " + (i.expiry === t ? "aujourd'hui" : "demain")}`]));
  state.challenges.filter(c => !chalEval(c).done && c.start <= t).forEach(c => { const r = chalEval(c); items.push(["flame", c.kind === "max" ? `${c.name} : ${fmt(r.spent)} / ${fmt(c.max)}` : `${c.name} : série de ${plural(r.streak, "jour")}`]); });
  return <section className="panel" aria-label="Aujourd'hui"><h2>Aujourd'hui</h2><div className="today">
    {items.map(([i, x], n) => <div className="ti" key={n}><span className="tile"><Icon name={i} /></span><span>{x}</span></div>)}</div></section>;
}

function Hero(){
  const list = inMonth(state.expenses, state.month).filter(bud), prevList = inMonth(state.expenses, prevKey(state.month)).filter(bud);
  const total = totalOf(list), prevTotal = totalOf(prevList), budget = state.settings.budget || 0, fc = forecast(state.month);
  const inc = incTotal(inMonth(state.incomes, state.month)), saved = savedIn(state.month), privTotal = totalOf(inMonth(state.privates, state.month));
  const byCat = sumBy(list, e => catOf(e.cat).id), scale = Math.max(budget, total) || 1, sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const p = prevTotal > 0 && total > 0 ? Math.round((total - prevTotal) / prevTotal * 100) : null;
  const barRef = useRef(null), lastMonth = useRef(state.month), touch = useRef(null);
  useEffect(() => {
    if (lastMonth.current === state.month || reduceMotion() || !barRef.current) { lastMonth.current = state.month; return; }
    lastMonth.current = state.month; const b = barRef.current; b.classList.remove("grow"); void b.offsetWidth; b.classList.add("grow");
  }, [state.month]);
  const go = k => { state.month = k; bump(); };
  return (
    <section className="panel hero" aria-label="Résumé du mois"
      onTouchStart={e => { touch.current = {x:e.touches[0].clientX, y:e.touches[0].clientY}; }}
      onTouchEnd={e => { const s = touch.current; touch.current = null; if (!s) return; const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { go(dx < 0 ? nextKey(state.month) : prevKey(state.month)); try { navigator.vibrate && pref.get("pc.haptic", "1") === "1" && navigator.vibrate(8); } catch {} } }}>
      <div className="month">
        <button aria-label="Mois précédent" onClick={() => go(prevKey(state.month))}>‹</button>
        <span className="month-name">{MS() > 1 ? fmtDay(periodOf(state.month).from) + " – " + fmtDay(periodOf(state.month).to) : monthLabel(state.month)}</span>
        <button aria-label="Mois suivant" onClick={() => go(nextKey(state.month))}>›</button>
      </div>
      <div className="total-row"><AnimatedAmount value={total} monthKey={state.month} />{p != null && <span className="delta">{(p > 0 ? "+" : p < 0 ? "−" : "") + Math.abs(p) + " % vs mois dernier"}</span>}</div>
      <p className="total-sub">{budget > 0 ? (budget - total >= 0 ? <>Reste <strong>{fmt(budget - total)}</strong> sur {fmt0(budget)}</> : <><span className="over">Dépassé de {fmt(total - budget)}</span> · budget {fmt0(budget)}</>)
        : (list.length ? plural(list.length, "dépense") : "Aucune dépense")}</p>
      <div className="kpis">
        <div className="kpi"><span>Revenus</span><b>{fmt0(inc)}</b></div>
        <div className="kpi"><span>{fc != null ? "Prévision" : "Épargné"}</span><b>{fmt0(fc != null ? fc : saved)}</b></div>
        <div className="kpi"><span>Reste à vivre</span><b>{inc ? fmt0(inc - total - saved) : "—"}</b></div>
        {privTotal ? <div className="kpi span-all"><span>Mes dépenses perso</span><b>{fmt(privTotal)}</b></div> : null}
      </div>
      <div className="bar" ref={barRef} role="img" aria-label={sorted.length ? "Répartition : " + sorted.map(([c, v]) => `${catOf(c).name} ${fmt(v)}`).join(", ") : "Aucune dépense"}>
        {sorted.map(([c, v]) => <span key={c} style={{width:(v / scale * 100).toFixed(2) + "%", background:catOf(c).color}} title={`${catOf(c).name} : ${fmt(v)}`} onClick={() => filterCat(c)} />)}
        {budget > 0 && total > budget && <i className="mark" style={{left:`calc(${(budget / scale * 100).toFixed(2)}% - 1px)`}} />}
      </div>
    </section>
  );
}

function Legend(){
  const list = inMonth(state.expenses, state.month).filter(bud), prevList = inMonth(state.expenses, prevKey(state.month)).filter(bud);
  const byCat = sumBy(list, e => catOf(e.cat).id), prevByCat = sumBy(prevList, e => catOf(e.cat).id), cb = state.settings.catBudgets || {}, sb = state.settings.subBudgets || {};
  const ids = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c]) => c).concat(allCats().filter(c => cb[c.id] > 0 && !byCat[c.id]).map(c => c.id));
  const rows = [];
  ids.forEach(id => {
    const c = catOf(id), v = byCat[id] || 0, av = catAvail(id, state.month), b = av.avail;
    rows.push(<li key={id} title={`Voir les dépenses ${c.name}`} onClick={() => filterCat(id)}>
      <span className="dot" style={{background:c.color}} /><span className="nm">{c.name}<PctDelta cur={v} prev={prevByCat[id] || 0} /></span>
      <span>{fmt(v)}{cb[id] > 0 && <span className="muted small"> / {fmt(b)}</span>}</span>
      {cb[id] > 0 && <div className="cb"><Track ratio={b > 0 ? v / b : (v > 0 ? 2 : 0)} color={c.color} />
        <span className={v > b ? "over" : ""}>{v > b ? "+" + fmt(v - b) : "reste " + fmt(b - v)}{av.carry ? <span className="muted"> ({av.carry > 0 ? "dont +" + fmt(av.carry) : "dont " + fmt(av.carry)} reporté)</span> : null}</span></div>}
    </li>);
    const subs = subsOf(id); if (!subs.length) return;
    const by = sumBy(list.filter(e => catOf(e.cat).id === id && e.sub), e => e.sub);
    subs.filter(s => by[s] || sb[id + "/" + s]).forEach(s => { const sv = by[s] || 0, bb = sb[id + "/" + s] || 0;
      rows.push(<li className="subl" key={id + "/" + s}><span /><span className="nm">{s}</span><span>{fmt(sv)}{bb ? <span className="muted small"> / {fmt(bb)}</span> : null}</span>
        {bb ? <div className="cb"><Track ratio={sv / bb} color={c.color} /></div> : null}</li>); });
  });
  return <ul className="legend m0">{rows}</ul>;
}

function Week(){
  const ws = weekStatus(); if (!ws.length) return null;
  const daysLeft = 7 - ((new Date().getDay() + 6) % 7) - 1;
  return <section className="panel" aria-label="Cette semaine"><h2>Cette semaine</h2>
    <ul className="legend m0">{ws.map(w => { const c = catOf(w.id), r = w.spent / w.budget;
      return <li key={w.id}><span className="dot" style={{background:c.color}} /><span className="nm">{c.name}</span><span>{fmt(w.spent)}<span className="muted small"> / {fmt(w.budget)}</span></span>
        <div className="cb"><Track ratio={r} color={c.color} /><span className={r > 1 ? "over" : ""}>{r > 1 ? "+" + fmt(w.spent - w.budget) : "reste " + fmt(w.budget - w.spent)}</span></div></li>; })}</ul>
    <p className="muted small mt10 m0b">{daysLeft ? `Encore ${plural(daysLeft, "jour")}` : "Dernier jour"}</p></section>;
}

function Zero(){
  const z = state.settings.zero; if (!(z && z.enabled)) return null;
  const k = state.month, inc = incTotal(inMonth(state.incomes, k)), cb = state.settings.catBudgets || {};
  const planned = Object.keys(cb).reduce((s, id) => s + catAvail(id, k).budget, 0), save = z.save || 0, left = inc - planned - save;
  const spent = sumBy(inMonth(state.expenses, k).filter(bud), e => catOf(e.cat).id);
  const unbudgeted = Object.entries(spent).filter(([id]) => !cb[id]).reduce((s, [, v]) => s + v, 0);
  return <section className="panel" aria-label="Budget à zéro"><h2>Budget à zéro</h2>
    <div className="kpis"><div className="kpi"><span>Revenus</span><b>{fmt(inc)}</b></div><div className="kpi"><span>Affecté</span><b>{fmt(planned + save)}</b></div>
      <div className="kpi"><span>À affecter</span><b className={left < 0 ? "over" : left > 0 ? "up" : "down"}>{fmt(left)}</b></div></div>
    <p className="small m0">{!inc ? "Ajoutez les revenus du mois pour commencer." : left === 0 ? "Chaque euro a une mission." : left > 0 ? <>Il reste <b>{fmt(left)}</b> sans mission : augmentez un budget ou l'épargne prévue (réglages).</> : <>Vous avez prévu <b>{fmt(-left)}</b> de plus que vos revenus : réduisez un budget.</>}</p>
    {save ? <p className="small muted mt6 m0b">Dont épargne prévue : {fmt(save)} · épargné ce mois : {fmt(savedIn(k))}</p> : null}
    {unbudgeted ? <p className="small mt6 m0b"><span className="up">{fmt(unbudgeted)}</span> dépensés dans des catégories sans budget.</p> : null}
  </section>;
}

function Pot({ canEdit }){
  const pot = state.settings.pot; if (!(pot && pot.enabled)) return null;
  const bal = potBalance(), k = state.month;
  const ins = sumBy(state.potmoves.filter(m => m.kind !== "out" && String(m.date).startsWith(k)), m => m.member, m => m.amount || 0);
  const outM = totalOf(inMonth(state.expenses, k).filter(e => e.payer === "pot"));
  const recent = state.potmoves.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);
  return <section className="panel" aria-label="Cagnotte commune">
    <div className="phead"><h2>Cagnotte commune</h2><button className="btn sm ghost" disabled={!canEdit} onClick={() => openDialog("pot")}>+ Versement</button></div>
    <div className={"bigval " + (bal < 0 ? "over" : "")}>{fmt(bal)}</div><p className="muted small potsub">disponibles dans la cagnotte{bal < 0 ? " : il faut la renflouer" : ""}</p>
    <div className="people">{members().map(m => <div className="person" key={m.id}><span><MAvatar id={m.id} />{m.name}</span><span className="r">a versé {fmt(ins[m.id] || 0)}<small>{pot.monthly?.[m.id] ? "prévu " + fmt(pot.monthly[m.id]) + " / mois" : "versement manuel"}</small></span></div>)}</div>
    <p className="small mt10 m0b">Payé par la cagnotte ce mois-ci : <strong>{fmt(outM)}</strong></p>
    {recent.length > 0 && <><h3>Derniers mouvements</h3><ul className="mini">{recent.map(m => <li key={m.id}>
      <span>{fmtDay(m.date)} · {m.kind === "out" ? "retrait" : "versement"}{m.member ? " de " + memberName(m.member) : ""}{m.auto ? " (auto)" : ""}</span>
      <span className={"num " + (m.kind === "out" ? "up" : "down")}>{m.kind === "out" ? "−" : "+"}{fmt(m.amount)}</span>
      {canEdit && <button className="x" aria-label="Supprimer ce mouvement" onClick={async () => { try { await removeWithUndo("potmoves", m, "Mouvement supprimé"); } catch (e) { handleWriteError(e); } }}><Icon name="x" /></button>}</li>)}</ul></>}
  </section>;
}

function Incomes({ canEdit }){
  const list = inMonth(state.incomes, state.month).sort((a, b) => a.date.localeCompare(b.date));
  return <section className="panel" aria-label="Revenus">
    <div className="phead"><h2>Revenus du mois</h2><button className="btn sm ghost" disabled={!canEdit} onClick={() => openIncome(null)}>+ Revenu</button></div>
    {list.length ? <ul className="items">{list.map(i => <li key={i.id}><span className="ic"><Icon name="banknote" /></span>
      <span className="tx">{i.label || "Revenu"}{i.recurringId ? <Icon name="repeat" /> : null}<span>{fmtDay(i.date)}{i.who ? " · " + memberName(i.who) : ""}</span></span>
      <b>{fmt(i.amount)}</b>{canEdit && <button className="x" aria-label={`Modifier ${i.label || "ce revenu"}`} onClick={() => openIncome(i)}><Icon name="pencil" /></button>}</li>)}</ul>
      : <Empty icon="banknote" action={canEdit ? () => openIncome(null) : null} label="+ Ajouter un revenu">Aucun revenu ce mois-ci</Empty>}
  </section>;
}

function SettleRow({ t, canEdit }){
  const [amt, setAmt] = useState(toInput(t.amount));
  useEffect(() => setAmt(toInput(t.amount)), [t.amount]);
  const settle = async () => {
    const pa = parseAmount(amt); if (!(pa > 0)) { toast("Montant invalide."); return; }
    if (!confirm(`Confirmer que ${memberName(t.from)} a remboursé ${fmt(pa)} à ${memberName(t.to)} ?`)) return;
    try { await store.upsert("reimbs", {from:t.from, to:t.to, amount:pa, date:todayStr(), createdAt:Date.now()}); toast("Remboursement enregistré"); logAct(`a noté que ${memberName(t.from)} a remboursé ${fmt(pa)} à ${memberName(t.to)}`); }
    catch (e) { handleWriteError(e); }
  };
  return <div className="s"><p>{memberName(t.from)} doit <b className="num">{fmt(t.amount)}</b> à {memberName(t.to)}</p>
    {canEdit && <><input className="inp r setamt" inputMode="decimal" value={amt} onChange={e => setAmt(e.target.value)} aria-label="Montant remboursé" /><button className="btn sm" onClick={settle}>Marquer remboursé</button></>}</div>;
}
function Balances({ canEdit }){
  const ms = members();
  let body;
  if (ms.length < 2) body = <div className="empty"><Icon name="users" />Ajoutez un deuxième membre dans les réglages</div>;
  else {
    const list = inMonth(state.expenses, state.month), paid = sumBy(list, e => e.payer), part = {};
    list.forEach(e => Object.entries(sharesOf(e)).forEach(([id, f]) => part[id] = (part[id] || 0) + eff(e) * f));
    const tr = settlements(balancesAll()), recent = state.reimbs.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);
    body = <>
      <div className="people">{ms.map(m => <div className="person" key={m.id}><span><MAvatar id={m.id} />{m.name}</span><span className="r">a payé {fmt(paid[m.id] || 0)}<small>sa part : {fmt(part[m.id] || 0)}</small></span></div>)}</div>
      <h3>Solde à ce jour</h3>
      <div className="settle">{tr.length ? tr.map(t => <SettleRow key={t.from + t.to} t={t} canEdit={canEdit} />) : <p className="muted m0">Tout le monde est à l'équilibre.</p>}</div>
      {recent.length > 0 && <><h3>Remboursements entre vous</h3><ul className="mini">{recent.map(r => <li key={r.id}>
        <span>{fmtDay(r.date)} · {memberName(r.from)} <Icon name="arrow-right" /> {memberName(r.to)} <b className="num">{fmt(r.amount)}</b></span>
        {canEdit && <button className="x" aria-label="Annuler ce remboursement" onClick={async () => { try { await removeWithUndo("reimbs", r, "Remboursement annulé"); } catch (e) { handleWriteError(e); } }}><Icon name="x" /></button>}</li>)}</ul></>}
    </>;
  }
  return <section className="panel" aria-label="Qui doit quoi"><h2>Qui doit quoi</h2>{body}</section>;
}

function Refunds({ canEdit }){
  const pend = state.expenses.map(e => ["expenses", e]).concat(state.privates.map(e => ["privates", e]))
    .filter(([, e]) => e.refund && !e.refund.received).sort((a, b) => a[1].date.localeCompare(b[1].date));
  if (!pend.length) return null;
  const t = todayStr();
  const got = async (l, x) => { try { await store.upsert(l, {...x, refund:{...x.refund, received:true, receivedDate:todayStr()}}); toast("Remboursement reçu"); } catch (e) { handleWriteError(e); } };
  return <section className="panel" aria-label="Remboursements attendus"><h2>Remboursements attendus</h2>
    <ul className="items">{pend.map(([l, e]) => { const late = daysBetween(e.date, t) > 30;
      return <li key={l + e.id}><span className="ic"><Icon name="hourglass" /></span><span className="tx">{e.label || catOf(e.cat).name}<span className={late ? "late" : ""}>{e.refund.source || ""} · depuis le {fmtDay(e.date)}{late ? " · plus de 30 jours" : ""}</span></span>
        <b>{fmt(e.refund.amount)}</b>{canEdit && <button className="btn sm ghost" onClick={() => got(l, e)}>Reçu</button>}</li>; })}</ul>
    <p className="muted small mt10 m0b">Total attendu : <strong>{fmt(pend.reduce((s, [, e]) => s + (e.refund.amount || 0), 0))}</strong></p></section>;
}

function Fixed({ canEdit }){
  let body;
  if (!state.recurring.length) body = <div className="empty"><Icon name="repeat" />Aucune dépense fixe</div>;
  else {
    const sorted = state.recurring.slice().sort((a, b) => (a.kind === "income") - (b.kind === "income") || (a.day || 1) - (b.day || 1));
    const exp = sorted.filter(r => r.kind !== "income"), inc = sorted.filter(r => r.kind === "income"), prov = exp.filter(r => r.freq !== "week" && (r.every || 1) > 1);
    const edit = r => {
      const inst = state.expenses.filter(x => x.recurringId === r.id).sort((a, b) => b.date.localeCompare(a.date));
      const cur = inst.find(x => x.date.startsWith(keyOf(new Date()))) || inst[0];
      if (cur) openExpense(cur, "expenses", {recAll:true}); else toast("Aucune occurrence à modifier pour l'instant.");
    };
    const stop = async r => { try { await removeWithUndo("recurring", r, `« ${r.label || catOf(r.cat).name} » ne se répétera plus`); } catch (e) { handleWriteError(e); } };
    body = <><ul className="items">{sorted.map(r => {
      const isInc = r.kind === "income", c = catOf(r.cat);
      const who = isInc ? (r.who ? memberName(r.who) : "Foyer") : memberName(r.payer) + (r.split && r.split !== "all" ? " · pour " + memberName(r.split) : "");
      return <li key={r.id}>{isInc ? <span className="ic"><Icon name="banknote" /></span> : <CatIc c={c} />}
        <span className="tx">{r.label || (isInc ? "Revenu" : c.name)}<span>{recDesc(r)} · {who}</span></span>
        <b className={isInc ? "down" : ""}>{isInc ? "+" : ""}{fmt(r.amount)}</b>
        {canEdit && !isInc && <button className="x" aria-label={`Modifier ${r.label || c.name} pour les mois suivants`} onClick={() => edit(r)}><Icon name="pencil" /></button>}
        {canEdit && <button className="x" aria-label={`Arrêter la répétition de ${r.label || c.name}`} onClick={() => stop(r)}><Icon name="x" /></button>}</li>; })}</ul>
      <p className="muted small mt10 m0b">Fixes : <strong>{fmt(exp.reduce((s, r) => s + monthlyEq(r), 0))}</strong> / mois
        {prov.length > 0 && <><br />Dont à provisionner : <strong>{fmt(prov.reduce((s, r) => s + monthlyEq(r), 0))}</strong> / mois pour {prov.map(r => r.label || catOf(r.cat).name).join(", ")}</>}
        {inc.length > 0 && <> · revenus fixes : <strong>{fmt(incTotal(inc))}</strong></>}</p></>;
  }
  return <section className="panel" aria-label="Dépenses et revenus fixes"><h2>Fixes chaque mois</h2>{body}</section>;
}

function Journal(){
  const l = state.journal.slice().sort((a, b) => b.at - a.at).slice(0, 15);
  return <section className="panel" aria-label="Activité récente"><h2>Activité récente</h2>
    {l.length ? <ul className="mini">{l.map(j => <li key={j.id}><span><MAvatar id={j.by} /><b>{j.by ? memberName(j.by) : "Quelqu'un"}</b> {j.text}</span><span className="muted small nowrap">{since(j.at)}</span></li>)}</ul>
      : <div className="empty"><Icon name="history" />Aucune activité</div>}</section>;
}

/* ---------- Liste des dépenses / transactions ---------- */
function MoreRows({ n }){
  const ref = useRef(null);
  useEffect(() => {
    const b = ref.current; if (!b || !("IntersectionObserver" in window)) return;
    const o = new IntersectionObserver(en => { if (en.some(x => x.isIntersecting)) { o.disconnect(); b.click(); } }, {rootMargin:"300px"});
    o.observe(b); return () => o.disconnect();
  }, [n]);
  return <div className="actions jcenter"><button ref={ref} className="btn ghost" onClick={() => { state.listLimit = (state.listLimit || 80) + 120; bump(); }}>Afficher plus ({n})</button></div>;
}
const dayTitle = d => fmtDay(d, {weekday:"long", day:"numeric", month:"long"});
function grouped(rows, render){
  const out = []; let cur = null;
  rows.forEach(e => { if (!cur || cur.date !== e.date) { cur = {date:e.date, items:[]}; out.push(cur); } cur.items.push(e); });
  return out.map(g => <div key={g.date}><div className="day">{dayTitle(g.date)}</div><ul className="rows">{g.items.map(render)}</ul></div>);
}

function useSwipe(onDelete){
  const s = useRef(null), swiped = useRef(false);
  return {
    swiped,
    onTouchStart:e => { const row = e.target.closest(".row"); if (!row || row.disabled) return; const t = e.touches[0]; s.current = {row, x:t.clientX, y:t.clientY, dx:0, active:false}; },
    onTouchMove:e => {
      const sw = s.current; if (!sw) return;
      const t = e.touches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
      if (!sw.active) { if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) sw.active = true; else if (Math.abs(dy) > 12) { s.current = null; return; } else return; }
      sw.dx = Math.min(0, dx); sw.row.classList.add("swiping"); sw.row.classList.remove("back");
      sw.row.style.transform = `translateX(${sw.dx}px)`;
      const bg = sw.row.previousElementSibling; if (bg) bg.style.opacity = Math.min(1, -sw.dx / 100);
    },
    onTouchEnd:async () => {
      const sw = s.current; s.current = null; if (!sw || !sw.active) return;
      swiped.current = true; setTimeout(() => swiped.current = false, 350);
      sw.row.classList.remove("swiping"); sw.row.classList.add("back");
      const bg = sw.row.previousElementSibling;
      if (sw.dx < -110) { sw.row.style.transform = "translateX(-100%)"; try { await onDelete(sw.row.dataset.l, sw.row.dataset.id); } catch (e) { handleWriteError(e); } sw.row.style.transform = ""; if (bg) bg.style.opacity = 0; }
      else { sw.row.style.transform = ""; if (bg) bg.style.opacity = 0; }
    },
  };
}

function AllTransactions({ period, ready }){
  if (!ready) return Array.from({length:6}, (_, i) => <div className="skel" key={i} />);
  const accName = id => (state.accounts.find(a => a.id === id) || {}).name || "—";
  const q = state.query.trim().toLowerCase();
  let all = inMonth(state.expenses, period).map(e => ({...e, _kind:"expense"}))
    .concat(inMonth(state.incomes, period).map(e => ({...e, _kind:"income"})), inMonth(state.transfers, period).map(e => ({...e, _kind:"transfer"})))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  if (q) all = all.filter(e => ((e.label || "") + " " + (e.note || "")).toLowerCase().includes(q));
  if (!all.length) return <div className="empty"><Icon name="wallet" />Aucune transaction ce mois-ci</div>;
  const lim = state.listLimit || 80;
  const open = e => { if (e._kind === "income") openIncome(state.incomes.find(x => x.id === e.id)); else if (e._kind === "transfer") openTransfer(state.transfers.find(x => x.id === e.id)); else openExpense(state.expenses.find(x => x.id === e.id), "expenses"); };
  return <>{grouped(all.slice(0, lim), e => {
    let icon, label, meta, amt, cls = "";
    if (e._kind === "expense") { const c = catOf(e.cat); icon = <CatIc c={c} />; label = e.label || c.name; meta = c.name; amt = "−" + fmt(e.amount); }
    else if (e._kind === "income") { icon = <span className="ic"><Icon name="trending-up" /></span>; label = e.label || "Revenu"; meta = "Revenu"; amt = "+" + fmt(e.amount); cls = "down"; }
    else { icon = <span className="ic"><Icon name="repeat" /></span>; label = accName(e.fromAccount) + " → " + accName(e.toAccount); meta = "Virement" + (e.note ? " · " + e.note : ""); amt = fmt(e.amount); }
    return <li key={e._kind + e.id}><button className="row" onClick={() => open(e)}>{icon}<span className="tx"><span className="lb">{label}</span><span className="meta">{meta}</span></span><span className={"am " + cls}>{amt}</span></button></li>;
  })}{all.length > lim && <MoreRows n={all.length - lim} />}</>;
}

function ExpenseRows({ period, canEdit, ready, shownRef }){
  const swipe = useSwipe(async (l, id) => { const e = state[l].find(x => x.id === id); if (e) await deleteExpense(e, l); });
  const all = inMonth(state.expenses, period).map(e => ({...e, _l:"expenses"})).concat(inMonth(state.privates, period).map(e => ({...e, _l:"privates"})))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  const q = state.query.trim().toLowerCase(), f = state.flt;
  const shown = all.filter(e => {
    if (q && !((e.label || "") + " " + (e.note || "") + " " + catOf(e.cat).name + " " + (e.tags || []).map(t => "#" + t).join(" ")).toLowerCase().includes(q)) return false;
    if (f.tag && !(e.tags || []).includes(f.tag)) return false;
    if (f.who && (e._l === "privates" || e.payer !== f.who)) return false;
    if (f.cat && catOf(e.cat).id !== f.cat) return false;
    switch (f.type) {
      case "fixed": return !!e.recurringId;
      case "var": return !e.recurringId && e._l !== "privates";
      case "priv": return e._l === "privates";
      case "refund": return !!e.refund;
      case "deduct": return !!e.deductible;
      case "photo": return !!e.photo;
      case "project": return !!e.project;
      case "pot": return e.payer === "pot";
    }
    return true;
  });
  shownRef.current = shown.map(e => e._l + "|" + e.id);
  if (!ready) return Array.from({length:6}, (_, i) => <div className="skel" key={i} />);
  if (!shown.length) return (q || f.who || f.cat || f.type || f.tag) ? <div className="empty"><Icon name="search" />Aucun résultat</div>
    : <Empty icon="wallet" action={canEdit ? openKindChooser : null} label="+ Ajouter une dépense">Aucune dépense ce mois-ci</Empty>;
  const lim = state.listLimit || 80;
  const click = e => {
    if (swipe.swiped.current) return;
    if (state.sel) { const key = e._l + "|" + e.id; if (state.selIds.has(key)) state.selIds.delete(key); else state.selIds.add(key); bump(); return; }
    const x = state[e._l].find(i => i.id === e.id); if (x) openExpense(x, e._l);
  };
  return <div onTouchStart={swipe.onTouchStart} onTouchMove={swipe.onTouchMove} onTouchEnd={swipe.onTouchEnd}>{grouped(shown.slice(0, lim), e => {
    const c = catOf(e.cat), priv = e._l === "privates", selected = state.sel && state.selIds.has(e._l + "|" + e.id);
    const meta = [c.name + (e.sub ? " › " + e.sub : "")], pj = e.project && projectOf(e.project);
    const tail = [];
    if (priv) tail.push("perso"); else if (e.split && e.split !== "all") tail.push("pour " + memberName(e.split));
    if (e.by && e.by !== e.payer && !priv) tail.push("ajouté par " + memberName(e.by));
    if (pj) tail.push(pj.name);
    const sub = e.currency && e.currency !== "EUR" ? <small>{fmtCur(e.origAmount, e.currency)}</small> : e.refund && e.refund.received ? <small>net {fmt(eff(e))}</small> : null;
    return <li key={e._l + e.id}><span className="swipe-bg" aria-hidden="true">Supprimer</span>
      <button className={"row" + (priv ? " priv" : "")} data-id={e.id} data-l={e._l} disabled={!canEdit} aria-pressed={state.sel ? selected : undefined} onClick={() => click(e)}>
        {state.sel && <input type="checkbox" className="selbox" tabIndex={-1} checked={selected} readOnly aria-hidden="true" />}<CatIc c={c} />
        <span className="tx"><span className="lb">{e.label || c.name}{e.recurringId && <Icon name="repeat" />}{e.photo && <Icon name="paperclip" />}{e.deductible && <Icon name="receipt" />}
          {e.refund && <Icon name={e.refund.received ? "circle-check" : "hourglass"} />}{priv && <Icon name="lock" />}{(e.tags || []).map(t => <span className="tag" key={t}>#{t}</span>)}</span>
          <span className="meta">{meta.join(" · ")}{!priv && <> · <MAvatar id={e.payer} />{memberName(e.payer)}</>}{tail.length ? " · " + tail.join(" · ") : ""}</span>
          {e.note && <span className="nt">{e.note}</span>}</span>
        <span className="am">{fmt(e.amount)}{sub}</span></button></li>;
  })}{shown.length > lim && <MoreRows n={shown.length - lim} />}</div>;
}

function ExpenseList({ canEdit, ready }){
  const period = state.searchYear ? state.month.slice(0, 4) : state.month, shownRef = useRef([]);
  const compact = pref.get("pc.compact", "0") === "1", f = state.flt, tags = allTags();
  const count = state.listMode === "all" ? null : inMonth(state.expenses, period).length + inMonth(state.privates, period).length;
  const title = (state.searchYear ? "Dépenses de " + period : "Dépenses du mois").replace("Dépenses", state.listMode === "all" ? "Transactions" : "Dépenses");
  const setF = p => { Object.assign(state.flt, p); bump(); };
  const selAll = () => { const keys = shownRef.current; if (keys.every(k => state.selIds.has(k))) state.selIds.clear(); else keys.forEach(k => state.selIds.add(k)); bump(); };
  return (
    <section className="panel" aria-label="Dépenses du mois">
      <div className="phead"><h2>{title}</h2><span className="muted">{count || ""}</span>
        <button className="iconbtn" title="Affichage compact" aria-label="Affichage compact" aria-pressed={compact} onClick={() => { pref.set("pc.compact", compact ? "0" : "1"); bump(); }}><Icon name="list" /></button>
        {state.listMode !== "all" && <button className="btn sm ghost" disabled={!canEdit} onClick={() => { state.sel = !state.sel; state.selIds.clear(); bump(); }}>{state.sel ? "Terminer" : "Sélectionner"}</button>}</div>
      <div className="chips mb10" role="radiogroup" aria-label="Afficher">
        <button type="button" className="chip" aria-pressed={state.listMode === "expenses"} onClick={() => { state.listMode = "expenses"; bump(); }}>Dépenses</button>
        <button type="button" className="chip" aria-pressed={state.listMode === "all"} onClick={() => { state.listMode = "all"; bump(); }}>Tout</button>
      </div>
      <div className="searchrow"><input className="search" type="search" placeholder="Rechercher un libellé, un commentaire…" aria-label="Rechercher une dépense" value={state.query} onChange={e => { state.query = e.target.value; bump(); }} />
        <label><input type="checkbox" checked={state.searchYear} onChange={e => { state.searchYear = e.target.checked; bump(); }} /> Toute l'année</label></div>
      <div className="filters">
        <select aria-label="Filtrer par payeur" value={members().some(m => m.id === f.who) ? f.who : ""} onChange={e => setF({who:e.target.value})}><option value="">Tous les membres</option>{members().map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <select aria-label="Filtrer par catégorie" value={allCats().some(x => x.id === f.cat) ? f.cat : ""} onChange={e => setF({cat:e.target.value})}><option value="">Toutes catégories</option>{allCats().map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select aria-label="Filtrer par type" value={f.type} onChange={e => setF({type:e.target.value})}>
          <option value="">Tous les types</option><option value="fixed">Fixes</option><option value="var">Variables</option><option value="priv">Perso (privées)</option><option value="refund">Remboursement attendu</option>
          <option value="deduct">Déductibles</option><option value="photo">Avec ticket</option><option value="project">Liées à un projet</option><option value="pot">Payées par la cagnotte</option></select>
        {tags.length > 0 && <select aria-label="Filtrer par étiquette" value={tags.includes(f.tag) ? f.tag : ""} onChange={e => setF({tag:e.target.value})}><option value="">Toutes étiquettes</option>{tags.map(t => <option key={t} value={t}>#{t}</option>)}</select>}
      </div>
      {state.sel && <div className="selbar"><span>{state.selIds.size} sélectionnée{state.selIds.size > 1 ? "s" : ""}</span>
        <button className="btn sm" onClick={selAll}>Tout</button>
        <button className="btn sm" onClick={() => { if (!state.selIds.size) toast("Sélectionnez d'abord des dépenses."); else openDialog("bulk"); }}>Modifier</button>
        <button className="btn sm" onClick={deleteSelection}>Supprimer</button><button className="btn sm" onClick={exitSel}>Fermer</button></div>}
      <div id="list" className={compact ? "compact" : ""}>
        {state.listMode === "all" ? <AllTransactions period={period} ready={ready} /> : <ExpenseRows period={period} canEdit={canEdit} ready={ready} shownRef={shownRef} />}
      </div>
    </section>
  );
}

const PANEL_C = {today:Today, week:Week, zero:Zero, pot:Pot, incomes:Incomes, balances:Balances, refunds:Refunds, fixed:Fixed};

export default function Budget({ canEdit, ready, actions }){
  useStore();
  useEffect(() => { if (state._lm !== state.month) { state._lm = state.month; state.listLimit = 80; } });
  const cfg = panelCfg().filter(p => p.on && p.id !== "journal" && p.id !== "today");
  return (
    <>
      <Alerts actions={actions} />
      <FirstSteps canEdit={canEdit} ready={ready} actions={actions} />
      <Columns left={[
        <Hero key="hero" />,
        panelOn("today") ? <Today key="today" /> : null,
        <section key="cats" className="panel" aria-label="Par catégorie">
          <div className="phead"><h2>Par catégorie</h2><button className="btn sm ghost" disabled={!canEdit} onClick={openBudgets}>Budgets</button></div>
          <Legend />
        </section>,
        ...cfg.map(p => { const C = PANEL_C[p.id]; return C ? <C key={p.id} canEdit={canEdit} /> : null; }),
      ]} right={[
        <ExpenseList key="list" canEdit={canEdit} ready={ready} />,
        panelOn("journal") ? <Journal key="journal" /> : null,
      ]} />
    </>
  );
}
