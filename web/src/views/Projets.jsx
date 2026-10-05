/* Onglet Projets : objectifs d'épargne, badges, défis, argent de poche, projets, comptes entre amis, idées cadeaux. */
import { useState } from "react";
import { Icon } from "../ui/icons.jsx";
import { Empty, Chips, Check, Field } from "../ui/bits.jsx";
import { Columns } from "../ui/Columns.jsx";
import { Dialog, openDialog, registerDialog } from "../ui/Dialog.jsx";
import { useStore } from "../lib/hooks.js";
import { state, pref, bump, fmt, toInput, parseAmount, todayStr, fmtDay, daysBetween, allCats, catOf, members, memberName, me, sumBy, totalOf } from "../lib/core.js";
import { SV, store, toast, handleWriteError } from "../data/store.js";
import { removeWithUndo, logAct, chalEval, WEEKDAYS } from "../lib/domain.js";
import { badgeList } from "../lib/badges.js";
import { groupBalances, settlements, personName } from "../groups/Summary.jsx";
import { openGroup } from "../groups/GroupDialog.jsx";
import { openExpense } from "../dialogs/Money.jsx";

const s = n => n > 1 ? "s" : "";

/* ---------- Objectifs d'épargne (avec arrondis automatiques) ---------- */
export function roundupPending(){
  const r = state.settings.roundup; if (!r || !r.enabled) return 0;
  return state.expenses.filter(e => !e.recurringId && (e.createdAt || 0) > (r.sweptAt || 0) && e.date >= (r.start || "0000") && e.amount % 100)
    .reduce((t, e) => t + (100 - e.amount % 100), 0);
}
async function sweepRoundup(){
  const r = state.settings.roundup, g = r && state.goals.find(x => x.id === r.goalId), amt = roundupPending(); if (!g || !amt) return;
  try {
    await store.upsert("goals", {...g, saved:(g.saved || 0) + amt, history:(g.history || []).concat({amount:amt, date:todayStr(), by:me() || null, roundup:true}).slice(-60)});
    await store.saveSettings({...state.settings, roundup:{...r, sweptAt:Date.now()}});
    logAct(`a versé ${fmt(amt)} d'arrondis dans « ${g.name} »`); toast(`${fmt(amt)} d'arrondis versés dans « ${g.name} »`);
  } catch (e) { handleWriteError(e); }
}
function Goal({ g, canEdit }){
  const [amt, setAmt] = useState(""), t = todayStr(), r = g.target > 0 ? g.saved / g.target : 0;
  let pace = "";
  if (g.deadline && g.target > g.saved && g.deadline > t) pace = `${fmt((g.target - g.saved) / Math.max(1, Math.round(daysBetween(t, g.deadline) / 30.4)))} / mois pour y arriver`;
  const hist = (g.history || []).slice(-3).reverse(), ruOn = state.settings.roundup?.enabled && state.settings.roundup.goalId === g.id, ru = ruOn ? roundupPending() : 0;
  const move = async sub => {
    const a = parseAmount(amt);
    if (!Number.isFinite(a) || a <= 0) { toast("Indiquez un montant."); return; }
    const v = sub ? -Math.min(a, g.saved || 0) : a; if (!v) return;
    try { await store.upsert("goals", {...g, saved:(g.saved || 0) + v, history:(g.history || []).concat({amount:v, date:todayStr(), by:me() || null}).slice(-60)}); setAmt(""); toast(sub ? "Montant retiré" : "Versement enregistré"); }
    catch (e) { handleWriteError(e); }
  };
  return <div className="goal"><div className="gh"><span className="tile"><Icon name="piggy-bank" /></span><strong>{g.name}</strong>
      {canEdit && <button className="x" aria-label={`Modifier ${g.name}`} onClick={() => openDialog("goal", {g})}><Icon name="pencil" /></button>}</div>
    <div className="track"><i style={{width:Math.min(100, r * 100).toFixed(1) + "%", background:r >= 1 ? "var(--good)" : "var(--accent)"}} /></div>
    <div className="gf"><span><strong className="ink">{fmt(g.saved)}</strong> sur {fmt(g.target)} ({Math.round(r * 100)} %)</span>
      <span>{r >= 1 ? "Objectif atteint" : g.deadline ? "pour le " + fmtDay(g.deadline, {day:"numeric", month:"long", year:"numeric"}) : ""}</span></div>
    {pace && <div className="gf"><span>{pace}</span></div>}
    {ruOn && <div className="gf"><span><Icon name="coins" /> Arrondis en attente : <strong className="ink">{fmt(ru)}</strong></span>{canEdit && ru ? <button className="btn sm ghost" onClick={sweepRoundup}>Verser les arrondis</button> : null}</div>}
    {canEdit && <div className="ga"><input className="inp" inputMode="decimal" placeholder="Montant (€)" aria-label={`Montant à verser pour ${g.name}`} value={amt} onChange={e => setAmt(e.target.value)} />
      <button className="btn sm" onClick={() => move(false)}>Verser</button><button className="btn sm ghost" onClick={() => move(true)}>Retirer</button></div>}
    {hist.length > 0 && <ul className="mini mt8">{hist.map((h, i) => <li key={i} className="muted"><span>{fmtDay(h.date)}{h.by ? " · " + memberName(h.by) : ""}</span><span className="num">{h.amount >= 0 ? "+" : "−"}{fmt(Math.abs(h.amount))}</span></li>)}</ul>}
  </div>;
}
function Goals({ canEdit }){
  return <section className="panel"><div className="phead"><h2>Objectifs d'épargne</h2><button className="btn sm" disabled={!canEdit} onClick={() => openDialog("goal", {})}>+ Objectif</button></div>
    {state.goals.length ? state.goals.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map(g => <Goal key={g.id} g={g} canEdit={canEdit} />)
      : <Empty icon="piggy-bank" action={canEdit ? () => openDialog("goal", {}) : null} label="+ Nouvel objectif">Aucun objectif d'épargne</Empty>}</section>;
}
function GoalDialog({ g, onClose }){
  const [f, setF] = useState({name:g ? g.name : "", target:g ? toInput(g.target) : "", deadline:g ? g.deadline || "" : "", err:""}), set = p => setF(x => ({...x, ...p}));
  const submit = async () => {
    const name = f.name.trim(), target = parseAmount(f.target);
    if (!name) return set({err:"Donnez un nom à l'objectif."});
    if (!Number.isFinite(target) || target <= 0) return set({err:"Indiquez le montant visé, par exemple 2000."});
    try { await store.upsert("goals", {...(g || {saved:0, history:[], createdAt:Date.now()}), name:name.slice(0, 40), target, deadline:f.deadline || null}); onClose(); toast(g ? "Objectif modifié" : "Objectif créé"); }
    catch (e) { handleWriteError(e); }
  };
  return <Dialog title={g ? "Modifier l'objectif" : "Nouvel objectif"} onClose={onClose} onSubmit={submit}>
    <div className="field"><input className="inp" maxLength={40} placeholder="ex. Vacances d'été" aria-label="Nom de l'objectif" autoFocus value={f.name} onChange={e => set({name:e.target.value})} /></div>
    <Field label="Montant visé (€)" htmlFor="gTarget"><input className="inp" id="gTarget" inputMode="decimal" placeholder="ex. 2000" value={f.target} onChange={e => set({target:e.target.value})} /></Field>
    <Field label="Pour quand (facultatif)" htmlFor="gDeadline"><input className="inp" id="gDeadline" type="date" value={f.deadline} onChange={e => set({deadline:e.target.value})} /></Field>
    <p className="err" role="alert">{f.err}</p>
    <div className="actions">{g && <button type="button" className="btn danger" onClick={async () => { onClose(); try { await removeWithUndo("goals", g, "Objectif supprimé"); } catch (e) { handleWriteError(e); } }}>Supprimer</button>}<button type="submit" className="btn push">Enregistrer</button></div>
  </Dialog>;
}

/* ---------- Badges ---------- */
export function BadgeGrid({ unlocked }){
  const set = unlocked ? new Set(unlocked) : null;
  return <div className="badges">{badgeList().map(b => { const ok = set ? set.has(b.id) : b.ok;
    return <div key={b.id} className={"badge-it " + (ok ? "" : "off")} title={b.desc}><span className="tile"><Icon name={b.icon} /></span><b>{b.name}</b><div className="muted bdesc">{b.desc}</div><span className="xp">+{b.xp} XP</span></div>; })}</div>;
}
const Badges = () => <section className="panel"><h2>Badges</h2><BadgeGrid unlocked={SV.me && SV.me.badges ? SV.me.badges.map(b => b.id) : null} /></section>;

/* ---------- Défis ---------- */
function Challenges({ canEdit }){
  const t = todayStr();
  return <section className="panel"><div className="phead"><h2>Défis d'économie</h2><button className="btn sm" disabled={!canEdit} onClick={() => openDialog("chal", {})}>+ Défi</button></div>
    {!state.challenges.length ? <Empty icon="flame" action={canEdit ? () => openDialog("chal", {}) : null} label="+ Nouveau défi">Aucun défi d'économie en cours</Empty>
      : state.challenges.slice().sort((a, b) => (b.start || "").localeCompare(a.start || "")).map(c => {
        const r = chalEval(c), scope = (c.cat ? catOf(c.cat).name : "toutes dépenses hors fixes") + (c.word ? ` contenant « ${c.word} »` : "");
        let body;
        if (c.kind === "max") { const p = c.max ? r.spent / c.max : 0;
          body = <><div className="track h8 my8"><i style={{width:Math.min(100, p * 100).toFixed(1) + "%", background:p > 1 ? "var(--danger)" : "var(--good)"}} /></div>
            <p className="small m0">{fmt(r.spent)} sur {fmt(c.max)} {r.done ? (r.ok ? "· Défi réussi" : "· Défi raté, la prochaine sera la bonne.") : p > 1 ? "· dépassé" : `· reste ${fmt(c.max - r.spent)}`}</p></>;
        } else body = <><div className="streak">{r.days.slice(-60).map((x, i) => <i key={i} className={x} />)}</div>
          <p className="small m0">{r.done ? (r.koN === 0 ? "Défi réussi, sans écart" : `Terminé : ${r.okN} jours réussis sur ${r.days.length}.`) : <>Série : <strong>{r.streak} jour{s(r.streak)}</strong> · {r.okN} réussi{s(r.okN)}, {r.koN} écart{s(r.koN)}</>}</p></>;
        return <div key={c.id} className={"card" + (r.done ? " op75" : "")}><div className="gh"><span className="tile"><Icon name={c.kind === "max" ? "target" : "ban"} /></span><strong>{c.name}</strong>
            {canEdit && <button className="x" aria-label={`Modifier ${c.name}`} onClick={() => openDialog("chal", {c})}><Icon name="pencil" /></button>}</div>
          <p className="muted small mt4 m0b">{scope} · du {fmtDay(c.start)} au {fmtDay(r.end)}{!r.done && r.end >= t ? ` · J-${daysBetween(t, r.end)}` : ""}</p>{body}</div>;
      })}</section>;
}
const CHAL_TPL = () => {
  const monthEnd = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1; })();
  return {resto:{name:"30 jours sans resto", kind:"zero", cat:"loisirs", word:"resto", days:30}, nospend:{name:"Semaine sans dépense", kind:"zero", cat:"", days:7},
    courses:{name:"Courses à 80 € cette semaine", kind:"max", cat:"courses", max:8000, days:7}, loisirs:{name:"Loisirs à 50 € ce mois-ci", kind:"max", cat:"loisirs", max:5000, days:monthEnd}};
};
function ChalDialog({ c, onClose }){
  const fill = x => ({name:x.name || "", kind:x.kind || "zero", cat:x.cat || "", word:x.word || "", max:x.max ? toInput(x.max) : "", start:x.start || todayStr(), days:String(x.days || 7), err:""});
  const [f, setF] = useState(() => fill(c || {})), set = p => setF(x => ({...x, ...p}));
  const submit = async () => {
    const name = f.name.trim(); if (!name) return set({err:"Donnez un nom au défi."});
    const days = parseInt(f.days, 10);
    if (!(days >= 1 && days <= 366)) return set({err:"La durée doit être entre 1 et 366 jours."});
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.start)) return set({err:"Choisissez une date de début."});
    const max = f.kind === "max" ? parseAmount(f.max) : 0;
    if (f.kind === "max" && !(max > 0)) return set({err:"Indiquez le montant maximum."});
    try { await store.upsert("challenges", {...(c || {createdAt:Date.now()}), name:name.slice(0, 40), kind:f.kind, cat:f.cat || "", word:f.word.trim().slice(0, 30), max, start:f.start, days});
      onClose(); if (!c) logAct(`a lancé le défi « ${name} »`); } catch (e) { handleWriteError(e); }
  };
  const tpl = [["resto", "utensils", "30 jours sans resto"], ["nospend", "ban", "Semaine sans dépense"], ["courses", "shopping-cart", "Courses 80 €/sem."], ["loisirs", "ticket", "Loisirs 50 €/mois"]];
  return <Dialog title={c ? "Modifier le défi" : "Nouveau défi"} onClose={onClose} onSubmit={submit}>
    {!c && <Field label="Modèles"><div className="chips">{tpl.map(([k, ic, l]) => <button key={k} type="button" className="chip" onClick={() => setF(fill(CHAL_TPL()[k]))}><Icon name={ic} />{l}</button>)}</div></Field>}
    <Field label="Nom du défi" htmlFor="cName"><input className="inp" id="cName" maxLength={40} value={f.name} onChange={e => set({name:e.target.value})} /></Field>
    <Field label="Type"><Chips label="Type" value={f.kind} onChange={v => set({kind:v})} items={[{id:"zero", label:"Aucune dépense"}, {id:"max", label:"Ne pas dépasser un montant"}]} /></Field>
    <Field label="Sur quoi" htmlFor="cCat"><select className="inp" id="cCat" value={f.cat} onChange={e => set({cat:e.target.value})}><option value="">Toutes les dépenses (hors fixes)</option>{allCats().map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
    <Field label="Seulement les dépenses contenant (facultatif)" htmlFor="cWord"><input className="inp" id="cWord" maxLength={30} placeholder="ex. resto" value={f.word} onChange={e => set({word:e.target.value})} /></Field>
    {f.kind === "max" && <Field label="Montant maximum (€)" htmlFor="cMax"><input className="inp" id="cMax" inputMode="decimal" value={f.max} onChange={e => set({max:e.target.value})} /></Field>}
    <div className="erow"><div className="f1"><label className="small" htmlFor="cStart">Début</label><input className="inp" id="cStart" type="date" value={f.start} onChange={e => set({start:e.target.value})} /></div>
      <div className="f1"><label className="small" htmlFor="cDays">Durée (jours)</label><input className="inp" id="cDays" inputMode="numeric" value={f.days} onChange={e => set({days:e.target.value})} /></div></div>
    <p className="err mt12" role="alert">{f.err}</p>
    <div className="actions">{c && <button type="button" className="btn danger" onClick={async () => { onClose(); try { await removeWithUndo("challenges", c, "Défi supprimé"); } catch (e) { handleWriteError(e); } }}>Supprimer</button>}<button type="submit" className="btn push">Enregistrer</button></div>
  </Dialog>;
}

/* ---------- Argent de poche ---------- */
function Kid({ k, canEdit }){
  const [amt, setAmt] = useState(""), [label, setLabel] = useState(""), hist = (k.history || []).slice(-4).reverse();
  const move = async give => {
    const a = parseAmount(amt); if (!Number.isFinite(a) || a <= 0) { toast("Indiquez un montant."); return; }
    const v = give ? a : -a, l = label.trim().slice(0, 40) || (give ? "Versement" : "Dépense");
    try { await store.upsert("kids", {...k, balance:(k.balance || 0) + v, history:(k.history || []).concat({amount:v, date:todayStr(), label:l}).slice(-60)}); setAmt(""); setLabel(""); }
    catch (e) { handleWriteError(e); }
  };
  return <div className="card"><div className="gh"><span className="tile"><Icon name="baby" /></span><strong>{k.name}</strong>
      {canEdit && <button className="x" aria-label={`Modifier ${k.name}`} onClick={() => openDialog("kid", {k})}><Icon name="pencil" /></button>}</div>
    <div className={"bigval " + (k.balance < 0 ? "over" : "")}>{fmt(k.balance || 0)}</div>
    <p className="muted small kidsub">{k.weekly > 0 ? `${fmt(k.weekly)} chaque ${WEEKDAYS[k.day ?? 3]}` : "Pas de versement automatique"}</p>
    {canEdit && <><div className="erow"><input className="inp r w" inputMode="decimal" placeholder="€" aria-label={`Montant pour ${k.name}`} value={amt} onChange={e => setAmt(e.target.value)} />
      <input className="inp" placeholder="pour quoi ? (facultatif)" maxLength={40} aria-label="Motif" value={label} onChange={e => setLabel(e.target.value)} /></div>
      <div className="actions m0"><button className="btn sm" onClick={() => move(true)}>+ Donner</button><button className="btn sm ghost" onClick={() => move(false)}>− Dépense</button></div></>}
    {hist.length > 0 && <ul className="mini mt10">{hist.map((h, i) => <li key={i} className="muted"><span>{fmtDay(h.date)} · {h.label || ""}</span><span className="num">{h.amount >= 0 ? "+" : "−"}{fmt(Math.abs(h.amount))}</span></li>)}</ul>}
  </div>;
}
function Kids({ canEdit }){
  return <section className="panel"><div className="phead"><h2>Argent de poche</h2><button className="btn sm" disabled={!canEdit} onClick={() => openDialog("kid", {})}>+ Enfant</button></div>
    {state.kids.length ? state.kids.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map(k => <Kid key={k.id} k={k} canEdit={canEdit} />)
      : <Empty icon="baby" action={canEdit ? () => openDialog("kid", {}) : null} label="+ Ajouter un enfant">Aucun enfant suivi pour l'argent de poche</Empty>}</section>;
}
function KidDialog({ k, onClose }){
  const [f, setF] = useState({name:k ? k.name : "", weekly:k ? toInput(k.weekly) : "", day:String(k ? (k.day ?? 3) : 3), err:""}), set = p => setF(x => ({...x, ...p}));
  const submit = async () => {
    const name = f.name.trim(); if (!name) return set({err:"Indiquez le prénom."});
    const weekly = f.weekly.trim() ? parseAmount(f.weekly) : 0;
    if (!Number.isFinite(weekly) || weekly < 0) return set({err:"Le montant doit être un nombre, par exemple 5."});
    const kid = {...(k || {balance:0, history:[], createdAt:Date.now(), lastAuto:todayStr()}), name:name.slice(0, 30), weekly, day:+f.day};
    if (k && !k.weekly && weekly) kid.lastAuto = todayStr();
    try { await store.upsert("kids", kid); onClose(); toast(k ? "Modifié" : "Ajouté"); } catch (e) { handleWriteError(e); }
  };
  return <Dialog title="Argent de poche" onClose={onClose} onSubmit={submit}>
    <div className="field"><input className="inp" maxLength={30} placeholder="Prénom" aria-label="Prénom" autoFocus value={f.name} onChange={e => set({name:e.target.value})} /></div>
    <Field label="Montant par semaine (€)" htmlFor="kWeekly"><input className="inp" id="kWeekly" inputMode="decimal" placeholder="ex. 5 — vide si aucun versement automatique" value={f.weekly} onChange={e => set({weekly:e.target.value})} /></Field>
    <Field label="Jour du versement"><Chips label="Jour du versement" value={f.day} onChange={v => set({day:v})} items={[1, 2, 3, 4, 5, 6, 0].map(d => ({id:String(d), label:WEEKDAYS[d].slice(0, 3)}))} /></Field>
    <p className="err" role="alert">{f.err}</p>
    <div className="actions">{k && <button type="button" className="btn danger" onClick={async () => { onClose(); try { await removeWithUndo("kids", k, `${k.name} supprimé`); } catch (e) { handleWriteError(e); } }}>Supprimer</button>}<button type="submit" className="btn push">Enregistrer</button></div>
  </Dialog>;
}

/* ---------- Projets et voyages ---------- */
function Projects({ canEdit }){
  const ps = state.projects.slice().sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0) || (b.createdAt || 0) - (a.createdAt || 0));
  const see = id => {
    const list = state.expenses.filter(x => x.project === id).sort((a, b) => b.date.localeCompare(a.date));
    if (list.length) state.month = list[0].date.slice(0, 7);
    state.flt = {who:"", cat:"", type:"project", tag:""}; state.searchYear = true;
    state.tab = "budget"; pref.set("pc.tab", "budget"); bump(); setTimeout(() => document.getElementById("list")?.scrollIntoView({behavior:"smooth"}), 50);
  };
  return <section className="panel"><div className="phead"><h2>Projets et voyages</h2><button className="btn sm" disabled={!canEdit} onClick={() => openDialog("project", {})}>+ Projet</button></div>
    {!ps.length ? <Empty icon="plane" action={canEdit ? () => openDialog("project", {}) : null} label="+ Nouveau projet">Aucun projet ou voyage en cours</Empty>
      : ps.map(p => {
        const list = state.expenses.filter(e => e.project === p.id), spent = totalOf(list), r = p.budget > 0 ? spent / p.budget : 0;
        const byCat = Object.entries(sumBy(list, e => catOf(e.cat).id)).sort((a, b) => b[1] - a[1]).slice(0, 4);
        const dates = p.start || p.end ? `${p.start ? fmtDay(p.start, {day:"numeric", month:"short", year:"numeric"}) : "…"} – ${p.end ? fmtDay(p.end, {day:"numeric", month:"short", year:"numeric"}) : "…"}` : "";
        return <div key={p.id} className={"card" + (p.archived ? " op65" : "")}><div className="gh"><span className="tile"><Icon name="target" /></span><strong>{p.name}</strong>
            {canEdit && <button className="x" aria-label={`Modifier ${p.name}`} onClick={() => openDialog("project", {p})}><Icon name="pencil" /></button>}</div>
          <p className="muted small projsub">{[dates, p.exclude ? "hors budget mensuel" : "", p.archived ? "terminé" : "", `${list.length} dépense${s(list.length)}`].filter(Boolean).join(" · ")}</p>
          <div className="bigval">{fmt(spent)}{p.budget > 0 && <span className="muted small projbud"> / {fmt(p.budget)}</span>}</div>
          {p.budget > 0 && <><div className="track h8 my8"><i style={{width:Math.min(100, r * 100).toFixed(1) + "%", background:r > 1 ? "var(--warn)" : "var(--accent)"}} /></div>
            <p className={"small m0 " + (r > 1 ? "over" : "muted")}>{r > 1 ? "Dépassé de " + fmt(spent - p.budget) : "Reste " + fmt(p.budget - spent)}</p></>}
          {byCat.length > 0 && <ul className="mini mt8">{byCat.map(([c, v]) => <li key={c}><span>{catOf(c).name}</span><span className="num">{fmt(v)}</span></li>)}</ul>}
          {canEdit && !p.archived && <div className="actions"><button className="btn sm ghost" onClick={() => openExpense(null, "expenses", {project:p.id, date:todayStr()})}>+ Dépense pour ce projet</button>
            <button className="btn sm ghost" onClick={() => see(p.id)}>Voir les dépenses</button></div>}
        </div>;
      })}</section>;
}
function ProjectDialog({ p, onClose }){
  const [f, setF] = useState({name:p ? p.name : "", budget:p ? toInput(p.budget) : "", start:p ? p.start || "" : "", end:p ? p.end || "" : "", exclude:!!p?.exclude, archived:!!p?.archived, err:""}), set = x => setF(y => ({...y, ...x}));
  const submit = async () => {
    const name = f.name.trim(); if (!name) return set({err:"Donnez un nom au projet."});
    const budget = f.budget.trim() ? parseAmount(f.budget) : 0;
    if (!Number.isFinite(budget) || budget < 0) return set({err:"Le budget doit être un montant."});
    try { await store.upsert("projects", {...(p || {createdAt:Date.now()}), name:name.slice(0, 40), budget, start:f.start || null, end:f.end || null, exclude:f.exclude, archived:f.archived}); onClose(); toast(p ? "Projet modifié" : "Projet créé"); }
    catch (e) { handleWriteError(e); }
  };
  const del = async () => { if (!confirm(`Supprimer « ${p.name} » ? Ses dépenses restent enregistrées, sans projet.`)) return; onClose(); try { await removeWithUndo("projects", p, "Projet supprimé"); } catch (e) { handleWriteError(e); } };
  return <Dialog title={p ? "Modifier le projet" : "Nouveau projet"} onClose={onClose} onSubmit={submit}>
    <div className="field"><input className="inp" maxLength={40} placeholder="ex. Vacances en Espagne" aria-label="Nom du projet" autoFocus value={f.name} onChange={e => set({name:e.target.value})} /></div>
    <Field label="Budget (€)" htmlFor="pBudget"><input className="inp" id="pBudget" inputMode="decimal" placeholder="facultatif" value={f.budget} onChange={e => set({budget:e.target.value})} /></Field>
    <div className="erow"><div className="f1"><label className="small" htmlFor="pStart">Début</label><input className="inp" id="pStart" type="date" value={f.start} onChange={e => set({start:e.target.value})} /></div>
      <div className="f1"><label className="small" htmlFor="pEnd">Fin</label><input className="inp" id="pEnd" type="date" value={f.end} onChange={e => set({end:e.target.value})} /></div></div>
    <div className="field mt12"><Check checked={f.exclude} onChange={v => set({exclude:v})}>Hors budget mensuel</Check></div>
    <div className="field"><Check checked={f.archived} onChange={v => set({archived:v})}>Projet terminé (archivé)</Check></div>
    <p className="err" role="alert">{f.err}</p>
    <div className="actions">{p && <button type="button" className="btn danger" onClick={del}>Supprimer</button>}<button type="submit" className="btn push">Enregistrer</button></div>
  </Dialog>;
}

/* ---------- Comptes entre amis ---------- */
function Groups({ canEdit }){
  const showArch = pref.get("pc.gArch", "0") === "1", list = state.groups.filter(g => showArch || !g.archived);
  return <section className="panel"><div className="phead"><h2>Comptes entre amis</h2><button className="btn sm" disabled={!canEdit} onClick={() => openGroup(null)}>+ Groupe</button></div>
    {state.groups.some(g => g.archived) && <Check className="check mb8" checked={showArch} onChange={v => { pref.set("pc.gArch", v ? "1" : "0"); bump(); }}>Voir les groupes archivés</Check>}
    {!list.length ? <Empty icon="users" action={canEdit ? () => openGroup(null) : null} label="+ Nouveau groupe">Aucun compte entre amis</Empty>
      : <ul className="items">{list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(g => {
        const total = (g.items || []).reduce((t, it) => t + it.amount, 0), tr = settlements(groupBalances(g)), pn = id => personName(g, id);
        return <li key={g.id}><span className="ic"><Icon name={g.locked ? "lock" : "users"} /></span>
          <span className="tx">{g.name}{g.archived && <> <span className="tag">archivé</span></>}<span>{g.people.length} participants · {(g.items || []).length} dépenses · {tr.length ? tr.slice(0, 2).map(t => `${pn(t.from)} doit ${fmt(t.amount)} à ${pn(t.to)}`).join(", ") + (tr.length > 2 ? "…" : "") : "équilibré"}</span></span>
          <b>{fmt(total)}</b><button className="x" aria-label={`Ouvrir ${g.name}`} onClick={() => openGroup(g.id)}>›</button></li>;
      })}</ul>}</section>;
}

/* ---------- Idées cadeaux ---------- */
function Wishes({ canEdit }){
  const buy = async (w, on) => {
    try {
      await store.upsert("wishes", {...w, bought:on});
      if (on && confirm(`Enregistrer l'achat de « ${w.label} » comme dépense ?`)) openExpense(null, "expenses", {label:`Cadeau : ${w.label}`.slice(0, 80), amount:w.price || 0, cat:"loisirs", tags:["cadeau"], date:todayStr()});
    } catch (e) { handleWriteError(e); bump(); }
  };
  const groups = {}; state.wishes.forEach(w => (groups[w.for || "Sans destinataire"] = groups[w.for || "Sans destinataire"] || []).push(w));
  return <section className="panel"><div className="phead"><h2>Idées cadeaux</h2><button className="btn sm" disabled={!canEdit} onClick={() => openDialog("wish", {})}>+ Idée</button></div>
    {!state.wishes.length ? <Empty icon="gift" action={canEdit ? () => openDialog("wish", {}) : null} label="+ Ajouter une idée">Aucune idée cadeau pour l'instant</Empty>
      : Object.keys(groups).sort().map(k => { const l = groups[k].sort((a, b) => (a.bought ? 1 : 0) - (b.bought ? 1 : 0)), todo = l.filter(w => !w.bought).reduce((t, w) => t + (w.price || 0), 0);
        return <div key={k}><h3><Icon name="gift" /> {k}{todo ? <> <span className="muted small fw4">· {fmt(todo)} d'idées</span></> : null}</h3><ul className="items">{l.map(w => <li key={w.id} className={w.bought ? "done" : ""}>
          <input key={String(!!w.bought)} type="checkbox" className="cbx" defaultChecked={!!w.bought} disabled={!canEdit} aria-label={`Acheté : ${w.label}`} onChange={e => buy(w, e.target.checked)} />
          <span className="tx">{w.label}<span>{[w.occasion, w.url].filter(Boolean).join(" · ")}</span></span>{w.price ? <b>{fmt(w.price)}</b> : null}
          {canEdit && <button className="x" aria-label={`Modifier ${w.label}`} onClick={() => openDialog("wish", {w})}><Icon name="pencil" /></button>}</li>)}</ul></div>; })}</section>;
}
function WishDialog({ w, onClose }){
  const [f, setF] = useState({label:w ? w.label : "", for:w ? w.for || "" : "", occ:w ? w.occasion || "" : "", price:w ? toInput(w.price) : "", url:w ? w.url || "" : "", err:""}), set = p => setF(x => ({...x, ...p}));
  const forList = Array.from(new Set(state.wishes.map(x => x.for).filter(Boolean).concat(members().map(m => m.name), state.kids.map(k => k.name))));
  const submit = async () => {
    const label = f.label.trim(); if (!label) return set({err:"Décrivez l'idée."});
    const price = f.price.trim() ? parseAmount(f.price) : 0;
    if (!Number.isFinite(price) || price < 0) return set({err:"Le prix doit être un montant."});
    try { await store.upsert("wishes", {...(w || {bought:false, createdAt:Date.now()}), label:label.slice(0, 60), for:f.for.trim().slice(0, 30), occasion:f.occ.trim().slice(0, 30), price, url:f.url.trim().slice(0, 200)}); onClose(); }
    catch (e) { handleWriteError(e); }
  };
  return <Dialog title="Idée cadeau" onClose={onClose} onSubmit={submit}>
    <Field label="Idée" htmlFor="wLabel"><input className="inp" id="wLabel" maxLength={60} placeholder="ex. Lego Technic" autoFocus value={f.label} onChange={e => set({label:e.target.value})} /></Field>
    <Field label="Pour qui" htmlFor="wFor"><input className="inp" id="wFor" maxLength={30} list="wForList" placeholder="ex. Nina, Mamie" value={f.for} onChange={e => set({for:e.target.value})} /><datalist id="wForList">{forList.map(n => <option key={n} value={n} />)}</datalist></Field>
    <Field label="Occasion" htmlFor="wOcc"><input className="inp" id="wOcc" maxLength={30} placeholder="ex. Noël, anniversaire" value={f.occ} onChange={e => set({occ:e.target.value})} /></Field>
    <Field label="Prix estimé (€)" htmlFor="wPrice"><input className="inp" id="wPrice" inputMode="decimal" value={f.price} onChange={e => set({price:e.target.value})} /></Field>
    <Field label="Lien ou magasin" htmlFor="wUrl"><input className="inp" id="wUrl" maxLength={200} value={f.url} onChange={e => set({url:e.target.value})} /></Field>
    <p className="err" role="alert">{f.err}</p>
    <div className="actions">{w && <button type="button" className="btn danger" onClick={async () => { onClose(); try { await removeWithUndo("wishes", w, "Idée supprimée"); } catch (e) { handleWriteError(e); } }}>Supprimer</button>}<button type="submit" className="btn push">Enregistrer</button></div>
  </Dialog>;
}

registerDialog("goal", GoalDialog);
registerDialog("chal", ChalDialog);
registerDialog("kid", KidDialog);
registerDialog("project", ProjectDialog);
registerDialog("wish", WishDialog);

export default function Projets({ canEdit }){
  useStore();
  return <Columns className="grid even"
    left={[<Goals key="goals" canEdit={canEdit} />, <Badges key="badges" />, <Challenges key="chals" canEdit={canEdit} />, <Kids key="kids" canEdit={canEdit} />]}
    right={[<Projects key="projects" canEdit={canEdit} />, <Groups key="groups" canEdit={canEdit} />, <Wishes key="wishes" canEdit={canEdit} />]} />;
}
