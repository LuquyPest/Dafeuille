/* Recherche globale (avec filtres), raccourcis clavier, corbeille (30 jours), vérification des données. */
import { useEffect, useRef, useState } from "react";
import { Dialog, openDialog, registerDialog } from "../ui/Dialog.jsx";
import { Icon } from "../ui/icons.jsx";
import { state, pref, bump, fmt, fmtDay, todayStr, dstr, norm, parseAmount, allCats, catOf, members, memberName } from "../lib/core.js";
import { store, toast, handleWriteError, onLoaded } from "../data/store.js";
import { warrantyEnd, nextOcc, since, LIST_NAMES, logAct, merchantKey } from "../lib/domain.js";
import { openExpense, openIncome, openTransfer } from "./Money.jsx";
import { openGroup } from "../groups/GroupDialog.jsx";

/* ---------- Recherche ---------- */
function globalSearch(q, f){
  const n = norm(q).trim(), money = !!(f.from || f.min != null || f.max != null);
  if (n.length < 2 && !f.type && !money) return [];
  const qAmt = /^\d+([.,]\d{1,2})?$/.test(q.trim()) ? parseAmount(q) : NaN;   // « 42 » ou « 42,50 » : recherche par montant
  const hit = s => n.length < 2 || norm(s).includes(n), out = [];
  const okMoney = (x, text) => (n.length < 2 || hit(text) || x.amount === qAmt) && (!f.from || (x.date || "") >= f.from) && (f.min == null || x.amount >= f.min) && (f.max == null || x.amount <= f.max);
  const want = k => !f.type || f.type === k, lim = n.length < 2 ? 100 : 40;
  const add = (kind, icon, title, sub, act, amt) => out.push({kind, icon, title, sub, act, amt});
  const accName = id => (state.accounts.find(a => a.id === id) || {}).name || "—", dfull = d => fmtDay(d, {day:"numeric", month:"short", year:"numeric"});
  const dlg = (name, props) => () => openDialog(name, props);
  if (want("exp")) state.expenses.concat(state.privates.map(e => ({...e, _l:"privates"}))).filter(e => okMoney(e, (e.label || "") + " " + (e.note || "") + " " + (e.tags || []).join(" ") + " " + catOf(e.cat).name))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, lim).forEach(e => add("Dépense", catOf(e.cat).ico || "tag", `${e.label || catOf(e.cat).name} — ${fmt(e.amount)}`, dfull(e.date), () => openExpense(state[e._l || "expenses"].find(x => x.id === e.id), e._l || "expenses"), e.amount));
  if (want("inc")) state.incomes.filter(i => okMoney(i, i.label || "")).sort((a, b) => b.date.localeCompare(a.date)).slice(0, lim).forEach(i => add("Revenu", "banknote", `${i.label || "Revenu"} — ${fmt(i.amount)}`, dfull(i.date), () => openIncome(i), i.amount));
  if (want("trf")) state.transfers.filter(t => okMoney(t, accName(t.fromAccount) + " " + accName(t.toAccount) + " " + (t.note || ""))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, lim).forEach(t => add("Virement", "repeat", `${accName(t.fromAccount)} → ${accName(t.toAccount)} — ${fmt(t.amount)}`, dfull(t.date), () => openTransfer(t)));
  if ((f.type && f.type !== "other") || money || n.length < 2) return out;
  state.papers.filter(p => hit(p.name + " " + (p.where || "") + " " + (p.note || ""))).forEach(p => add("Papier", "file-text", p.name, p.where || "", dlg("paper", {p})));
  state.warranties.filter(w => hit(w.name + " " + (w.store || "") + " " + (w.note || ""))).forEach(w => add("Garantie", "shield-check", w.name, "jusqu'au " + dfull(warrantyEnd(w)), dlg("warranty", {w})));
  state.wishes.filter(w => hit(w.label + " " + (w.for || "") + " " + (w.occasion || ""))).forEach(w => add("Idée cadeau", "gift", w.label, w.for || "", dlg("wish", {w})));
  state.events.filter(e => hit(e.title)).forEach(e => add("Événement", "cake", e.title, fmtDay(nextOcc(e), {day:"numeric", month:"long"}), dlg("event", {e})));
  state.todos.filter(x => hit(x.title)).forEach(x => add("À payer", "pin", x.title, x.due ? fmtDay(x.due) : "", dlg("todo", {t:x})));
  state.goals.filter(g => hit(g.name)).forEach(g => add("Objectif", "piggy-bank", g.name, fmt(g.saved) + " / " + fmt(g.target), dlg("goal", {g})));
  state.projects.filter(p => hit(p.name)).forEach(p => add("Projet", "target", p.name, "", dlg("project", {p})));
  state.shop.filter(x => hit(x.name)).forEach(x => add("Courses", "shopping-basket", x.name, x.done ? "dans le panier" : "sur la liste", () => { state.tab = "courses"; pref.set("pc.tab", "courses"); bump(); }));
  state.meals.filter(m => hit(m.dish + " " + (m.ingredients || []).join(" "))).slice(0, 5).forEach(m => add("Repas", "utensils", m.dish, fmtDay(m.date), dlg("meal", {ds:m.date, slot:m.slot})));
  state.inventory.filter(i => hit(i.name)).forEach(i => add("Placard", "refrigerator", i.name, i.place || "", dlg("inv", {i})));
  state.health.filter(h => hit(h.label + " " + (h.person || "") + " " + (h.note || ""))).forEach(h => add("Santé", "stethoscope", h.label, (h.person || "") + " " + fmtDay(h.date.slice(0, 10)), dlg("health", {h})));
  state.groups.filter(g => hit(g.name + " " + (g.items || []).map(i => i.label).join(" "))).forEach(g => add("Entre amis", "users", g.name, "", () => openGroup(g.id)));
  return out.slice(0, 60);
}
function SearchDialog({ onClose }){
  const [q, setQ] = useState(""), [f, setF] = useState({type:"", when:"", min:"", max:""}), set = p => setF(x => ({...x, ...p}));
  const t = todayStr(), d = new Date();
  const from = f.when === "m" ? t.slice(0, 8) + "01" : f.when === "y" ? t.slice(0, 4) + "-01-01" : f.when === "3m" ? dstr(new Date(d.getFullYear(), d.getMonth() - 3, d.getDate())) : "";
  const mn = parseAmount(f.min), mx = parseAmount(f.max), flt = {type:f.type, from, min:Number.isFinite(mn) ? mn : null, max:Number.isFinite(mx) ? mx : null};
  const res = globalSearch(q, flt), sum = k => res.filter(r => r.kind === k).reduce((a, r) => a + (r.amt || 0), 0), se = sum("Dépense"), si = sum("Revenu");
  return <Dialog title="Rechercher" wide onClose={onClose} closeLabel="Fermer" form={false}>
    <input className="inp" type="search" placeholder="Dépense, montant, papier, garantie, événement…" aria-label="Rechercher" autoFocus value={q} onChange={e => setQ(e.target.value)} />
    <div className="srch-f">
      <select aria-label="Type" value={f.type} onChange={e => set({type:e.target.value})}><option value="">Tous les types</option><option value="exp">Dépenses</option><option value="inc">Revenus</option><option value="trf">Virements</option><option value="other">Le reste (papiers, idées…)</option></select>
      <select aria-label="Période" value={f.when} onChange={e => set({when:e.target.value})}><option value="">Toutes les dates</option><option value="m">Ce mois</option><option value="3m">3 derniers mois</option><option value="y">Cette année</option></select>
      <input className="inp" inputMode="decimal" placeholder="Min €" aria-label="Montant minimum" value={f.min} onChange={e => set({min:e.target.value})} />
      <input className="inp" inputMode="decimal" placeholder="Max €" aria-label="Montant maximum" value={f.max} onChange={e => set({max:e.target.value})} />
    </div>
    <p className="srch-sum" aria-live="polite">{res.length ? `${res.length} résultat${res.length > 1 ? "s" : ""}${se ? " · dépenses " + fmt(se) : ""}${si ? " · revenus " + fmt(si) : ""}` : ""}</p>
    <ul className="sres mt6">{res.length ? res.map((r, i) => <li key={i}><button type="button" onClick={() => { onClose(); if (state.canWrite) r.act(); }}>
        <span className="tile"><Icon name={r.icon} /></span><span className="f1 minw0"><b>{r.title}</b><span className="muted small dblock">{r.sub}</span></span><span className="k">{r.kind}</span></button></li>)
      : <li className="muted small srch-none">{q.trim().length < 2 && !flt.type && !flt.from && flt.min == null && flt.max == null ? "Tapez au moins 2 lettres, ou choisissez un filtre." : "Aucun résultat."}</li>}</ul>
  </Dialog>;
}

const KeysDialog = ({ onClose }) => <Dialog title="Raccourcis clavier" onClose={onClose} closeLabel="Fermer" form={false}>
  <ul className="keys">
    <li><span>Nouvelle transaction</span><kbd>N</kbd></li><li><span>Saisie éclair</span><kbd>E</kbd></li><li><span>Rechercher partout</span><kbd>/</kbd></li>
    <li><span>Mois précédent / suivant</span><span><kbd>←</kbd> <kbd>→</kbd></span></li><li><span>Revenir au mois en cours</span><kbd>T</kbd></li>
    <li><span>Changer d'onglet</span><span><kbd>1</kbd> … <kbd>6</kbd></span></li><li><span>Mon profil</span><kbd>P</kbd></li><li><span>Classement</span><kbd>L</kbd></li>
    <li><span>Cette aide</span><kbd>?</kbd></li><li><span>Fermer une fenêtre</span><kbd>Échap</kbd></li>
  </ul></Dialog>;

/* ---------- Corbeille ---------- */
function TrashDialog({ onClose }){
  const l = state.trash.slice().sort((a, b) => b.at - a.at);
  const run = async fn => { try { await fn(); } catch (e) { handleWriteError(e); } };
  return <Dialog title="Corbeille" wide onClose={onClose} closeLabel="Fermer" form={false}>
    <p className="muted small mt0">Les éléments supprimés restent ici 30 jours.</p>
    {l.length ? <><ul className="items">{l.map(t => <li key={t.id}><span className="tx">{t.label}{t.amount ? " — " + fmt(t.amount) : ""}<span>{LIST_NAMES[t.list] || t.list} · supprimé {since(t.at)}{t.by ? " par " + memberName(t.by) : ""}</span></span>
        <button className="btn sm ghost" onClick={() => run(async () => { await store.upsert(t.list, t.item); await store.remove("trash", t.id); logAct(`a restauré « ${t.label} » depuis la corbeille`); toast("Restauré"); })}>Restaurer</button>
        <button className="x" aria-label="Supprimer définitivement" onClick={() => run(() => store.remove("trash", t.id))}><Icon name="x" /></button></li>)}</ul>
      <div className="actions"><button className="btn sm danger push" onClick={() => { if (confirm("Vider définitivement la corbeille ?")) run(async () => { for (const t of state.trash.slice()) await store.remove("trash", t.id); }); }}>Vider la corbeille</button></div></>
      : <div className="empty"><Icon name="trash-2" />Corbeille vide</div>}
  </Dialog>;
}
/** Éléments de plus de 30 jours retirés de la corbeille (une fois par session) */
let purged = false;
onLoaded(() => {
  if (purged || !state.canWrite) return; purged = true;
  state.trash.filter(t => Date.now() - t.at > 30 * 86400000).forEach(t => store.remove("trash", t.id).catch(() => {}));
});

/* ---------- Vérification des données ---------- */
function dataIssues(){
  const out = [], known = new Set(allCats().map(c => c.id)), mids = new Set(members().map(m => m.id).concat("pot"));
  const t = todayStr(), far = (() => { const d = new Date(); d.setDate(d.getDate() + 60); return dstr(d); })();
  const med = {}, byCat = {}, seen = {};
  state.expenses.forEach(e => (byCat[e.cat] = byCat[e.cat] || []).push(e.amount));
  Object.entries(byCat).forEach(([c, a]) => { a.sort((x, y) => x - y); med[c] = a[Math.floor(a.length / 2)]; });
  state.expenses.forEach(e => {
    const lab = `${e.label || catOf(e.cat).name} (${fmt(e.amount)}, ${fmtDay(e.date, {day:"numeric", month:"short", year:"numeric"})})`;
    if (!known.has(e.cat)) out.push([e, "Catégorie inconnue (supprimée ?) : " + lab]);
    if (!mids.has(e.payer)) out.push([e, "Payeur inconnu (ancien membre ?) : " + lab]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || "") || e.date < "2000-01-01" || e.date > far) out.push([e, "Date étrange : " + lab]);
    if (!(e.amount > 0)) out.push([e, "Montant nul ou négatif : " + lab]);
    else if (med[e.cat] && e.amount > med[e.cat] * 10 && e.amount > 50000) out.push([e, `Montant inhabituel pour ${catOf(e.cat).name} : ${lab}`]);
    const k = e.date + "|" + e.amount + "|" + merchantKey(e.label);
    if (seen[k] && !e.recurringId) out.push([e, "Doublon possible : " + lab]); else seen[k] = true;
    if (e.date > t && !e.recurringId) out.push([e, "Dépense dans le futur : " + lab]);
  });
  return out;
}
function CheckDialog({ onClose }){
  const issues = dataIssues();
  return <Dialog title="Vérification" wide onClose={onClose} closeLabel="Fermer" form={false}>
    {issues.length ? <><p className="small">{issues.length} point{issues.length > 1 ? "s" : ""} à vérifier. Touchez une ligne pour ouvrir la dépense.</p>
      <ul className="sres">{issues.slice(0, 100).map(([ex, m], i) => <li key={i}><button type="button" onClick={() => { onClose(); openExpense(state.expenses.find(x => x.id === ex.id) || ex, "expenses"); }}>
        <span className="tile"><Icon name="triangle-alert" /></span><span className="f1">{m}</span></button></li>)}</ul></>
      : <div className="empty"><Icon name="circle-check" /><strong>Tout est en ordre</strong></div>}
  </Dialog>;
}

registerDialog("search", SearchDialog);
registerDialog("keys", KeysDialog);
registerDialog("trash", TrashDialog);
registerDialog("check", CheckDialog);
