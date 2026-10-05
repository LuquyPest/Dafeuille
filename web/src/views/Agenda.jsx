/* Onglet Agenda : calendrier du mois (+ lien ICS), factures et tâches, ménage, santé, événements, papiers. */
import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icons.jsx";
import { MAvatar, Empty, Chips, Check, Field } from "../ui/bits.jsx";
import { Columns } from "../ui/Columns.jsx";
import { Dialog, openDialog, registerDialog } from "../ui/Dialog.jsx";
import { useStore } from "../lib/hooks.js";
import { state, bump, HIDE, fmt, toInput, parseAmount, todayStr, fmtDay, monthLabel, prevKey, nextKey, parseD, pad, daysBetween,
  catOf, members, memberName, me, bud, inMonth, sumBy } from "../lib/core.js";
import { SV, api, store, toast, handleWriteError } from "../data/store.js";
import { removeWithUndo, logAct, upcomingEvents, eventsOn, choreDue, choreWho, guessCat } from "../lib/domain.js";
import { CatIc } from "../ui/bits.jsx";
import { openExpense } from "../dialogs/Money.jsx";

const s = n => n > 1 ? "s" : "";
const Del = ({ onClick }) => <button type="button" className="btn danger" onClick={onClick}>Supprimer</button>;
const delThen = (onClose, list, item, msg) => async () => { onClose(); try { await removeWithUndo(list, item, msg); } catch (e) { handleWriteError(e); } };

/* ---------- Calendrier ---------- */
function IcsField(){
  const [url, setUrl] = useState(undefined), ref = useRef(null);
  const base = SV.hh && `/api/h/${encodeURIComponent(SV.hh.id)}/ics-token`;
  useEffect(() => { if (base) api("GET", base).then(r => setUrl(r.url || null)).catch(() => {}); }, [base]);
  if (!base) return null;
  const gen = async () => { try { setUrl((await api("POST", base)).url); toast("Lien généré"); } catch (e) { toast(e.message); } };
  const revoke = async () => { if (!confirm("Révoquer ce lien ? Les calendriers abonnés ne se mettront plus à jour.")) return; try { await api("DELETE", base); setUrl(null); toast("Lien révoqué"); } catch (e) { toast(e.message); } };
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast("Lien copié"); } catch { ref.current?.select(); toast("Sélectionnez et copiez avec Ctrl+C"); } };
  return <div className="field mt14"><span className="lab">Lien calendrier (ICS)</span>
    <p className="hint m0 mb8">Abonnez Google/Apple Calendar à vos événements et factures.</p>
    {!url ? <div><button type="button" className="btn sm ghost" onClick={gen}>Générer le lien</button></div>
      : <div><div className="erow"><input ref={ref} className="inp" readOnly aria-label="Lien du calendrier" value={url} /><button type="button" className="btn sm ghost" onClick={copy}>Copier</button></div>
        <div className="actions mt8"><button type="button" className="btn sm ghost" onClick={revoke}>Révoquer</button></div></div>}
  </div>;
}
function Calendar(){
  const k = state.month, first = parseD(k + "-01"), days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const exp = sumBy(inMonth(state.expenses, k).filter(bud), e => e.date), inc = sumBy(inMonth(state.incomes, k), e => e.date, e => e.amount || 0);
  const todos = {}; state.todos.filter(x => x.due && x.due.startsWith(k)).forEach(x => (todos[x.due] = todos[x.due] || []).push(x));
  const fixed = new Set(inMonth(state.expenses, k).filter(e => e.recurringId).map(e => e.date));
  const t = todayStr(), off = (first.getDay() + 6) % 7, cells = [];
  ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"].forEach(d => cells.push(<div className="wd" key={d}>{d}</div>));
  for (let i = 0; i < off; i++) cells.push(<div className="empty-cell" key={"e" + i} />);
  for (let d = 1; d <= days; d++) {
    const ds = `${k}-${pad(d)}`, td = todos[ds] || [], ev = eventsOn(ds);
    cells.push(<button key={ds} className={(ds === t ? "today" : "") + " " + (ds === state.calDay ? "sel" : "")}
      aria-label={`${fmtDay(ds, {weekday:"long", day:"numeric", month:"long"})}${exp[ds] ? ", " + fmt(exp[ds]) + " dépensés" : ""}${td.length ? ", " + td.length + " échéance(s)" : ""}`}
      onClick={() => { state.calDay = state.calDay === ds ? null : ds; bump(); }}>
      <span className="dn">{d}</span>{exp[ds] ? <span className="dv">{HIDE ? "•••" : Math.round(exp[ds] / 100) + " €"}</span> : null}
      <span className="dots">{ev.length > 0 && <i className="dot-evt" />}{td.some(x => !x.done) && <i style={{background:ds < t ? "var(--danger)" : "var(--warn)"}} />}{fixed.has(ds) && <i className="dot-fix" />}{inc[ds] ? <i className="dot-inc" /> : null}</span></button>);
  }
  const sd = state.calDay && state.calDay.startsWith(k) ? state.calDay : null;
  let detail;
  if (!sd) detail = <p className="muted small m0"><span className="c-warn">●</span> échéance &nbsp; <span className="c-acc">●</span> fixe &nbsp; <span className="c-good">●</span> revenu &nbsp; <span className="c-evt">●</span> événement</p>;
  else {
    const items = inMonth(state.expenses, k).filter(e => e.date === sd).map(e => <li key={"x" + e.id}><CatIc c={catOf(e.cat)} /><span className="tx">{e.label || catOf(e.cat).name}{e.recurringId && <Icon name="repeat" />}<span>{memberName(e.payer)}</span></span><b>{fmt(e.amount)}</b></li>)
      .concat(inMonth(state.incomes, k).filter(e => e.date === sd).map(e => <li key={"i" + e.id}><span className="ic"><Icon name="banknote" /></span><span className="tx">{e.label || "Revenu"}</span><b className="down">+{fmt(e.amount)}</b></li>))
      .concat(eventsOn(sd).map(x => <li key={"v" + x.id}><span className="ic"><Icon name="party-popper" /></span><span className="tx">{x.title}{x.budget ? <span>budget {fmt(x.budget)}</span> : null}</span></li>))
      .concat((todos[sd] || []).map(x => <li key={"t" + x.id} className={x.done ? "done" : ""}><span className="ic"><Icon name="pin" /></span><span className="tx">{x.title}<span>{x.done ? "fait" : "à payer / à faire"}</span></span>{x.amount ? <b>{fmt(x.amount)}</b> : null}</li>));
    detail = <><h3 className="calh">{fmtDay(sd, {weekday:"long", day:"numeric", month:"long"})}</h3>{items.length ? <ul className="items">{items}</ul> : <p className="muted small">Rien ce jour-là.</p>}</>;
  }
  const go = n => { state.month = n; state.calDay = null; bump(); };
  return <section className="panel">
    <div className="month"><button aria-label="Mois précédent" onClick={() => go(prevKey(k))}>‹</button><span className="month-name">{monthLabel(k)}</span><button aria-label="Mois suivant" onClick={() => go(nextKey(k))}>›</button></div>
    <div className="cal">{cells}</div>
    <div className="mt14">{detail}</div>
    <IcsField />
  </section>;
}

/* ---------- Factures et tâches ---------- */
function Todos({ canEdit }){
  const t = todayStr();
  const open = state.todos.filter(x => !x.done).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const done = state.todos.filter(x => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 10);
  const toggle = async (x, on) => {
    try {
      await store.upsert("todos", {...x, done:on, doneAt:on ? Date.now() : null});
      if (on && x.amount && confirm(`Enregistrer « ${x.title} » (${fmt(x.amount)}) comme dépense ?`))
        openExpense(null, "expenses", {amount:x.amount, label:x.title, cat:guessCat(x.title), date:todayStr(), payer:x.who || me()});
    } catch (e) { handleWriteError(e); bump(); }
  };
  const item = x => {
    const late = !x.done && x.due && x.due < t, soon = !x.done && x.due && !late && daysBetween(t, x.due) <= 3;
    const when = x.due ? (late ? `en retard (${fmtDay(x.due)})` : x.due === t ? "aujourd'hui" : "le " + fmtDay(x.due, {weekday:"short", day:"numeric", month:"short"})) : "sans échéance";
    return <li key={x.id} className={x.done ? "done" : ""}><input key={String(!!x.done)} type="checkbox" className="cbx" defaultChecked={!!x.done} disabled={!canEdit} aria-label={x.title} onChange={e => toggle(x, e.target.checked)} />
      <span className="tx">{x.title}<span className={late ? "late" : soon ? "up" : ""}>{when}{x.who ? " · " + memberName(x.who) : ""}</span></span>
      {x.amount ? <b>{fmt(x.amount)}</b> : null}{canEdit && <button className="x" aria-label={`Modifier ${x.title}`} onClick={() => openDialog("todo", {t:x})}><Icon name="pencil" /></button>}</li>;
  };
  const upcoming = open.filter(x => x.amount).reduce((a, x) => a + x.amount, 0);
  return <section className="panel"><div className="phead"><h2>Factures et tâches</h2><button className="btn sm" disabled={!canEdit} onClick={() => openDialog("todo", {})}>+ Ajouter</button></div>
    {open.length ? <><ul className="items">{open.map(item)}</ul>{upcoming ? <p className="muted small mt10 m0b">Factures à venir : <strong>{fmt(upcoming)}</strong></p> : null}</> : <div className="empty"><Icon name="circle-check" />Rien à payer</div>}
    {done.length > 0 && <><h3>Fait récemment</h3><ul className="items">{done.map(item)}</ul></>}</section>;
}
function TodoDialog({ t, onClose }){
  const [f, setF] = useState({title:t ? t.title : "", amount:t ? toInput(t.amount) : "", due:t ? t.due || "" : "", who:t ? t.who || "" : "", err:""}), set = p => setF(x => ({...x, ...p}));
  const submit = async () => {
    const title = f.title.trim(); if (!title) return set({err:"Indiquez de quoi il s'agit."});
    const amount = f.amount.trim() ? parseAmount(f.amount) : 0;
    if (!Number.isFinite(amount) || amount < 0) return set({err:"Le montant doit être un nombre, par exemple 89,90."});
    try { await store.upsert("todos", {...(t || {done:false, createdAt:Date.now()}), title:title.slice(0, 80), amount:amount || null, due:f.due || null, who:f.who || ""}); onClose(); toast(t ? "Modifié" : "Ajouté"); }
    catch (e) { handleWriteError(e); }
  };
  return <Dialog title={t ? "Modifier" : "Nouvelle facture ou tâche"} onClose={onClose} onSubmit={submit}>
    <Field label="Quoi" htmlFor="tTitle"><input className="inp" id="tTitle" maxLength={80} placeholder="ex. Taxe foncière, résilier la salle de sport" autoFocus value={f.title} onChange={e => set({title:e.target.value})} /></Field>
    <Field label="Montant (€, si c'est une facture)" htmlFor="tAmount"><input className="inp" id="tAmount" inputMode="decimal" placeholder="facultatif" value={f.amount} onChange={e => set({amount:e.target.value})} /></Field>
    <Field label="Échéance" htmlFor="tDue"><input className="inp" id="tDue" type="date" value={f.due} onChange={e => set({due:e.target.value})} /></Field>
    <Field label="Qui s'en occupe"><Chips label="Qui s'en occupe" value={f.who} onChange={v => set({who:v})} items={[{id:"", label:"Personne en particulier"}].concat(members().map(m => ({id:m.id, label:m.name})))} /></Field>
    <p className="err" role="alert">{f.err}</p>
    <div className="actions">{t && <Del onClick={delThen(onClose, "todos", t, "Supprimé")} />}<button type="submit" className="btn push">Enregistrer</button></div>
  </Dialog>;
}

/* ---------- Tâches ménagères ---------- */
function Chores({ canEdit }){
  const t = todayStr();
  const done = async c => {
    const before = {...c}, who = choreWho(c);
    try { await store.upsert("chores", {...c, lastDone:todayStr(), turn:(c.turn || 0) + 1, lastBy:me() || who});
      logAct(`a fait « ${c.name} »`); toast(`« ${c.name} » fait · prochain tour : ${memberName(choreWho({...c, turn:(c.turn || 0) + 1}))}`, "Annuler", () => store.upsert("chores", before)); }
    catch (e) { handleWriteError(e); }
  };
  return <section className="panel"><div className="phead"><h2>Tâches ménagères</h2><button className="btn sm" disabled={!canEdit} onClick={() => openDialog("chore", {})}>+ Tâche</button></div>
    {!state.chores.length ? <div className="empty"><Icon name="brush" />Aucune tâche</div>
      : <ul className="items">{state.chores.slice().sort((a, b) => choreDue(a).localeCompare(choreDue(b))).map(c => {
        const due = choreDue(c), late = due < t, d = daysBetween(t, due), who = choreWho(c);
        return <li key={c.id}><span className="ic"><Icon name="brush" /></span><span className="tx">{c.name}
          <span className={late ? "late" : d === 0 ? "up" : ""}>{late ? `en retard de ${-d} j` : d === 0 ? "aujourd'hui" : d === 1 ? "demain" : `dans ${d} jours`} · tous les {c.freq} j{who && <> · au tour de <MAvatar id={who} />{memberName(who)}</>}</span></span>
          {canEdit && <><button className="btn sm" onClick={() => done(c)}>Fait</button><button className="x" aria-label={`Modifier ${c.name}`} onClick={() => openDialog("chore", {c})}><Icon name="pencil" /></button></>}</li>; })}</ul>}</section>;
}
function ChoreDialog({ c, onClose }){
  const [f, setF] = useState({name:c ? c.name : "", freq:String(c ? c.freq : 7), who:c ? c.who || [] : members().map(m => m.id), err:""}), set = p => setF(x => ({...x, ...p}));
  const submit = async () => {
    const name = f.name.trim(), freq = parseInt(f.freq, 10), who = members().map(m => m.id).filter(id => f.who.includes(id));
    if (!name) return set({err:"Indiquez la tâche."});
    if (!(freq >= 1 && freq <= 365)) return set({err:"La fréquence doit être entre 1 et 365 jours."});
    try { await store.upsert("chores", {...(c || {turn:0, lastDone:null, createdDate:todayStr(), createdAt:Date.now()}), name:name.slice(0, 40), freq, who}); onClose(); }
    catch (e) { handleWriteError(e); }
  };
  return <Dialog title="Tâche ménagère" onClose={onClose} onSubmit={submit}>
    <div className="field"><input className="inp" maxLength={40} placeholder="ex. Sortir les poubelles" aria-label="Tâche" autoFocus value={f.name} onChange={e => set({name:e.target.value})} /></div>
    <Field label="Tous les combien de jours" htmlFor="chFreq"><input className="inp" id="chFreq" inputMode="numeric" value={f.freq} onChange={e => set({freq:e.target.value})} /></Field>
    <Field label="Chacun son tour"><div className="chips">{members().map(m => <label key={m.id} className="chip"><input type="checkbox" className="cbstatic" checked={f.who.includes(m.id)}
      onChange={e => setF(x => ({...x, who:e.target.checked ? x.who.concat(m.id) : x.who.filter(i => i !== m.id)}))} /> {m.name}</label>)}</div></Field>
    <p className="err" role="alert">{f.err}</p>
    <div className="actions">{c && <Del onClick={delThen(onClose, "chores", c, "Tâche supprimée")} />}<button type="submit" className="btn push">Enregistrer</button></div>
  </Dialog>;
}

/* ---------- Santé ---------- */
const HEALTH_KINDS = [{id:"rdv", ico:"stethoscope", label:"Rendez-vous"}, {id:"vaccin", ico:"syringe", label:"Vaccin"}, {id:"traitement", ico:"pill", label:"Traitement"}, {id:"autre", ico:"clipboard-list", label:"Autre"}];
function Health({ canEdit }){
  const t = todayStr();
  let body;
  if (!state.health.length) body = <div className="empty"><Icon name="stethoscope" />Aucun rendez-vous</div>;
  else {
    const up = state.health.filter(h => (h.date || "").slice(0, 10) >= t).sort((a, b) => a.date.localeCompare(b.date));
    const past = state.health.filter(h => (h.date || "").slice(0, 10) < t).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
    const item = h => <li key={h.id}><span className="ic"><Icon name={(HEALTH_KINDS.find(k => k.id === h.kind) || HEALTH_KINDS[3]).ico} /></span>
      <span className="tx">{h.label}<span>{[h.person, fmtDay(h.date.slice(0, 10), {weekday:"short", day:"numeric", month:"short", year:"numeric"}) + (h.date.length > 10 ? " à " + h.date.slice(11, 16) : ""), h.note].filter(Boolean).join(" · ")}</span></span>
      {canEdit && <button className="x" aria-label={`Modifier ${h.label}`} onClick={() => openDialog("health", {h})}><Icon name="pencil" /></button>}</li>;
    body = <>{up.length ? <><h3 className="mt0">À venir</h3><ul className="items">{up.map(item)}</ul></> : <p className="muted small m0">Aucun rendez-vous à venir.</p>}
      {past.length > 0 && <><h3>Historique</h3><ul className="items">{past.map(item)}</ul></>}</>;
  }
  return <section className="panel"><div className="phead"><h2>Santé</h2><button className="btn sm" disabled={!canEdit} onClick={() => openDialog("health", {})}>+ Rendez-vous</button></div>{body}</section>;
}
function HealthDialog({ h, onClose }){
  const [f, setF] = useState({person:h ? h.person || "" : "", kind:h ? h.kind : "rdv", label:h ? h.label : "", date:h ? h.date : todayStr() + "T09:00", note:h ? h.note || "" : "", err:""}), set = p => setF(x => ({...x, ...p}));
  const submit = async () => {
    const label = f.label.trim();
    if (!label) return set({err:"Indiquez de quoi il s'agit."});
    if (!f.date) return set({err:"Choisissez la date."});
    try { await store.upsert("health", {...(h || {createdAt:Date.now()}), person:f.person.trim().slice(0, 30), kind:f.kind || "rdv", label:label.slice(0, 60), date:f.date, note:f.note.trim().slice(0, 120)}); onClose(); }
    catch (e) { handleWriteError(e); }
  };
  return <Dialog title="Santé" onClose={onClose} onSubmit={submit}>
    <Field label="Pour qui" htmlFor="hlPerson"><input className="inp" id="hlPerson" maxLength={30} list="hlPeople" value={f.person} onChange={e => set({person:e.target.value})} />
      <datalist id="hlPeople">{members().map(m => m.name).concat(state.kids.map(k => k.name)).map(n => <option key={n} value={n} />)}</datalist></Field>
    <Field label="Type"><Chips label="Type" value={f.kind} onChange={v => set({kind:v})} items={HEALTH_KINDS} /></Field>
    <Field label="Quoi" htmlFor="hlLabel"><input className="inp" id="hlLabel" maxLength={60} placeholder="ex. Dentiste Dr Martin, rappel DTP" autoFocus value={f.label} onChange={e => set({label:e.target.value})} /></Field>
    <Field label="Date" htmlFor="hlDate"><input className="inp" id="hlDate" type="datetime-local" value={f.date} onChange={e => set({date:e.target.value})} /></Field>
    <Field label="Note" htmlFor="hlNote"><input className="inp" id="hlNote" maxLength={120} value={f.note} onChange={e => set({note:e.target.value})} /></Field>
    <p className="err" role="alert">{f.err}</p>
    <div className="actions">{h && <Del onClick={delThen(onClose, "health", h, "Supprimé")} />}
      {h && <button type="button" className="btn sm ghost" onClick={() => { onClose(); openExpense(null, "expenses", {label:h.label, cat:"sante", date:h.date.slice(0, 10), refund:{amount:0, source:"Sécu", received:false}}); }}>+ Dépense</button>}
      <button type="submit" className="btn push">Enregistrer</button></div>
  </Dialog>;
}

/* ---------- Anniversaires et événements ---------- */
function Events({ canEdit }){
  const t = todayStr(), up = upcomingEvents(30), past = state.events.filter(e => !e.yearly && e.date < t);
  return <section className="panel"><div className="phead"><h2>Anniversaires et événements</h2><button className="btn sm" disabled={!canEdit} onClick={() => openDialog("event", {})}>+ Événement</button></div>
    {!state.events.length ? <Empty icon="cake" action={canEdit ? () => openDialog("event", {}) : null} label="+ Ajouter un événement">Aucun événement à venir</Empty>
      : <><ul className="items">{up.map(e => {
        const dd = daysBetween(t, e.next), age = e.yearly && e.date.slice(0, 4) < e.next.slice(0, 4) ? +e.next.slice(0, 4) - +e.date.slice(0, 4) : null;
        return <li key={e.id}><span className="ic"><Icon name="cake" /></span><span className="tx">{e.title}{age && /anniv/i.test(e.title) ? ` (${age} ans)` : ""}
          <span className={dd <= 7 ? "up" : ""}>{dd === 0 ? "aujourd'hui" : dd === 1 ? "demain" : `dans ${dd} jours`} · {fmtDay(e.next, {weekday:"short", day:"numeric", month:"long"})}{e.yearly ? " · chaque année" : ""}</span></span>
          {e.budget ? <b>{fmt(e.budget)}</b> : null}{canEdit && <button className="x" aria-label={`Modifier ${e.title}`} onClick={() => openDialog("event", {e:state.events.find(x => x.id === e.id)})}><Icon name="pencil" /></button>}</li>; })}</ul>
        {past.length > 0 && <p className="muted small mt10 m0b">{past.length} événement{s(past.length)} passé{s(past.length)}.</p>}</>}</section>;
}
function EventDialog({ e, onClose }){
  const [f, setF] = useState({title:e ? e.title : "", date:e ? e.date : "", yearly:e ? !!e.yearly : true, budget:e ? toInput(e.budget) : "", err:""}), set = p => setF(x => ({...x, ...p}));
  const submit = async () => {
    const title = f.title.trim();
    if (!title) return set({err:"Indiquez l'événement."});
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return set({err:"Choisissez la date (pour un anniversaire, la date de naissance)."});
    const budget = f.budget.trim() ? parseAmount(f.budget) : 0;
    try { await store.upsert("events", {...(e || {createdAt:Date.now()}), title:title.slice(0, 60), date:f.date, yearly:f.yearly, budget:Number.isFinite(budget) ? budget : 0}); onClose(); }
    catch (err) { handleWriteError(err); }
  };
  return <Dialog title="Événement" onClose={onClose} onSubmit={submit}>
    <Field label="Quoi" htmlFor="eTitle"><input className="inp" id="eTitle" maxLength={60} placeholder="ex. Anniversaire de Nina, mariage de Julie" autoFocus value={f.title} onChange={x => set({title:x.target.value})} /></Field>
    <Field label="Date" htmlFor="eDate"><input className="inp" id="eDate" type="date" value={f.date} onChange={x => set({date:x.target.value})} /></Field>
    <div className="field"><Check checked={f.yearly} onChange={v => set({yearly:v})}>Tous les ans</Check></div>
    <Field label="Budget prévu (€)" htmlFor="eBudget"><input className="inp" id="eBudget" inputMode="decimal" placeholder="facultatif" value={f.budget} onChange={x => set({budget:x.target.value})} /></Field>
    <p className="err" role="alert">{f.err}</p>
    <div className="actions">{e && <Del onClick={delThen(onClose, "events", e, "Événement supprimé")} />}<button type="submit" className="btn push">Enregistrer</button></div>
  </Dialog>;
}

/* ---------- Papiers importants ---------- */
function Papers({ canEdit }){
  const t = todayStr();
  return <section className="panel"><div className="phead"><h2>Papiers importants</h2><button className="btn sm" disabled={!canEdit} onClick={() => openDialog("paper", {})}>+ Papier</button></div>
    {!state.papers.length ? <div className="empty"><Icon name="file-text" />Aucun papier</div>
      : <ul className="items">{state.papers.slice().sort((a, b) => (a.expiry || "9999").localeCompare(b.expiry || "9999")).map(p => {
        const d = p.expiry ? daysBetween(t, p.expiry) : null;
        const st = d == null ? null : d < 0 ? <span className="late">expiré depuis {-d} j</span> : d <= 60 ? <span className="up">expire dans {d} j</span> : `valable jusqu'au ${fmtDay(p.expiry, {day:"numeric", month:"short", year:"numeric"})}`;
        const parts = [p.where || null, st, p.note || null].filter(Boolean);
        return <li key={p.id}><span className="ic"><Icon name="file-text" /></span><span className="tx">{p.name}<span>{parts.map((x, i) => <span className="inl" key={i}>{i > 0 && " · "}{x}</span>)}</span></span>
          {canEdit && <button className="x" aria-label={`Modifier ${p.name}`} onClick={() => openDialog("paper", {p})}><Icon name="pencil" /></button>}</li>; })}</ul>}</section>;
}
function PaperDialog({ p, onClose }){
  const [f, setF] = useState({name:p ? p.name : "", where:p ? p.where || "" : "", exp:p ? p.expiry || "" : "", note:p ? p.note || "" : "", err:""}), set = x => setF(y => ({...y, ...x}));
  const submit = async () => {
    const name = f.name.trim(); if (!name) return set({err:"Indiquez le document."});
    try { await store.upsert("papers", {...(p || {createdAt:Date.now()}), name:name.slice(0, 60), where:f.where.trim().slice(0, 80), expiry:f.exp || null, note:f.note.trim().slice(0, 120)}); onClose(); }
    catch (e) { handleWriteError(e); }
  };
  return <Dialog title="Papier important" onClose={onClose} onSubmit={submit}>
    <Field label="Document" htmlFor="ppName"><input className="inp" id="ppName" maxLength={60} placeholder="ex. Carte d'identité de Tom, contrôle technique" autoFocus value={f.name} onChange={e => set({name:e.target.value})} /></Field>
    <Field label="Où il se trouve" htmlFor="ppWhere"><input className="inp" id="ppWhere" maxLength={80} placeholder="ex. Classeur bleu, tiroir du bureau" value={f.where} onChange={e => set({where:e.target.value})} /></Field>
    <Field label="Date d'expiration ou de renouvellement" htmlFor="ppExp"><input className="inp" id="ppExp" type="date" value={f.exp} onChange={e => set({exp:e.target.value})} /></Field>
    <Field label="Note" htmlFor="ppNote"><input className="inp" id="ppNote" maxLength={120} value={f.note} onChange={e => set({note:e.target.value})} /></Field>
    <p className="err" role="alert">{f.err}</p>
    <div className="actions">{p && <Del onClick={delThen(onClose, "papers", p, "Papier supprimé")} />}<button type="submit" className="btn push">Enregistrer</button></div>
  </Dialog>;
}

registerDialog("todo", TodoDialog);
registerDialog("chore", ChoreDialog);
registerDialog("health", HealthDialog);
registerDialog("event", EventDialog);
registerDialog("paper", PaperDialog);
export const openTodo = t => openDialog("todo", {t});

export default function Agenda({ canEdit }){
  useStore();
  return <Columns className="grid even" left={[<Calendar key="cal" />]}
    right={[<Todos key="todos" canEdit={canEdit} />, <Chores key="chores" canEdit={canEdit} />, <Health key="health" canEdit={canEdit} />, <Events key="events" canEdit={canEdit} />, <Papers key="papers" canEdit={canEdit} />]} />;
}
