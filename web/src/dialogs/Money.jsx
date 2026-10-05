/* Fenêtres de saisie autour de l'argent : choix de transaction, revenu, virement, compte,
   saisie éclair, budgets, cagnotte, modification groupée. */
import { useEffect, useState } from "react";
import { Dialog, openDialog, registerDialog } from "../ui/Dialog.jsx";
import { Icon } from "../ui/icons.jsx";
import { Chips, Check, Field, CatIco } from "../ui/bits.jsx";
import { state, bump, allCats, catOf, members, memberName, me, currentWeights, fmt, toInput, parseAmount, todayStr, defDate, uid, ACC_TYPES,
  inMonth, sumBy, bud, curKey, dstr } from "../lib/core.js";
import { store, toast, handleWriteError } from "../data/store.js";
import { recId, written, logAct, removeWithUndo, goToDateMonth, parseTags, toTrash, ui } from "../lib/domain.js";
import { ExpenseDialog, openExpense, needsAccountFirst } from "./Expense.jsx";

export { openExpense, needsAccountFirst };
const dateOk = d => /^\d{4}-\d{2}-\d{2}$/.test(d);

export const openIncome = (inc, prefill) => { if (!inc && needsAccountFirst()) return; openDialog("income", {inc, prefill}); };
export function openTransfer(t){
  if (!t?.id && state.accounts.length < 2) { toast("Il faut au moins deux comptes pour faire un virement"); return; }
  openDialog("transfer", {t});
}
export const openAccount = a => openDialog("account", {a});
export const openKindChooser = () => { if (!needsAccountFirst()) openDialog("kind"); };
export const openQuick = () => { if (!needsAccountFirst()) openDialog("quick"); };
export const openBudgets = () => openDialog("budgets");
ui.openBudgets = openBudgets;

function KindDialog({ onClose }){
  const go = f => () => { onClose(); f(); };
  return (
    <Dialog title="Nouvelle transaction" onClose={onClose} form={false}>
      <div className="grid kindgrid">
        <button type="button" className="btn push jstart" autoFocus onClick={go(() => openExpense(null))}><Icon name="trending-down" />Dépense</button>
        <button type="button" className="btn push jstart bggood" onClick={go(() => openIncome(null))}><Icon name="trending-up" />Revenu</button>
        <button type="button" className="btn push ghost jstart" onClick={go(() => openTransfer(null))}><Icon name="repeat" />Virement entre comptes</button>
      </div>
    </Dialog>
  );
}

const AccountSelect = ({ id, value, onChange, empty }) => (
  <select className="inp" id={id} value={value} onChange={e => onChange(e.target.value)}>
    {empty != null && <option value="">{empty}</option>}
    {state.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
  </select>
);

function IncomeDialog({ inc, prefill = {}, onClose }){
  const [f, setF] = useState(() => ({amount:inc ? toInput(inc.amount) : (prefill.amount ? toInput(prefill.amount) : ""), label:inc ? inc.label || "" : "",
    who:inc ? inc.who || "" : (me() || ""), date:inc ? inc.date : defDate(), rec:false,
    account:state.accounts.some(a => a.id === inc?.accountId) ? inc.accountId : (inc ? "" : state.accounts[0]?.id || ""), err:""}));
  const set = p => setF(x => ({...x, ...p}));
  const submit = async () => {
    const amount = parseAmount(f.amount), date = f.date;
    if (!Number.isFinite(amount) || amount <= 0) return set({err:"Indiquez un montant supérieur à 0."});
    if (!dateOk(date)) return set({err:"Choisissez une date."});
    if (!inc && !f.account) return set({err:"Choisissez un compte."});
    const item = {amount, label:f.label.trim().slice(0, 60), who:f.who || "", date, accountId:f.account || null};
    try {
      if (inc) await store.upsert("incomes", {...inc, ...item});
      else if (f.rec) {
        const rid = uid(), k = date.slice(0, 7);
        await store.upsert("recurring", {id:rid, kind:"income", amount, label:item.label, who:item.who, accountId:item.accountId, day:Math.min(Number(date.slice(8, 10)), 28), start:k, skip:[], createdAt:Date.now()});
        const iid = recId(rid, k); written.add(iid);
        await store.upsert("incomes", {...item, id:iid, recurringId:rid, createdAt:Date.now()});
      } else await store.upsert("incomes", {...item, createdAt:Date.now()});
      onClose(); toast(inc ? "Revenu modifié" : "Revenu ajouté"); logAct(`${inc ? "a modifié" : "a ajouté"} le revenu « ${item.label || "Revenu"} » (${fmt(amount)})`);
      goToDateMonth(date);
    } catch (e) { handleWriteError(e); }
  };
  const del = async () => {
    onClose();
    try {
      const r = inc.recurringId && state.recurring.find(x => x.id === inc.recurringId);
      if (r) await store.upsert("recurring", {...r, skip:Array.from(new Set([...(r.skip || []), inc.date.slice(0, 7)]))});
      await removeWithUndo("incomes", inc, "Revenu supprimé", async () => {
        if (r) { const cur = state.recurring.find(x => x.id === r.id); if (cur) await store.upsert("recurring", {...cur, skip:(cur.skip || []).filter(k => k !== inc.date.slice(0, 7))}); }
      });
    } catch (e) { handleWriteError(e); }
  };
  return (
    <Dialog title={inc ? "Modifier le revenu" : "Nouveau revenu"} onClose={onClose} onSubmit={submit}>
      <Field label="Montant (€)" htmlFor="iAmount"><input className="inp amount" id="iAmount" inputMode="decimal" placeholder="0,00" autoFocus value={f.amount} onChange={e => set({amount:e.target.value})} /></Field>
      <p className="err" role="alert">{f.err}</p>
      <Field label="Libellé" htmlFor="iLabel"><input className="inp" id="iLabel" maxLength={60} placeholder="ex. Salaire, CAF, prime" value={f.label} onChange={e => set({label:e.target.value})} /></Field>
      <Field label="Pour"><Chips label="Pour" value={f.who} onChange={v => set({who:v})} items={[{id:"", label:"Foyer"}].concat(members().map(m => ({id:m.id, label:m.name})))} /></Field>
      <Field label="Date" htmlFor="iDate"><input className="inp" id="iDate" type="date" value={f.date} onChange={e => set({date:e.target.value})} /></Field>
      {state.accounts.length > 0 && <Field label="Compte" htmlFor="iAccount"><AccountSelect id="iAccount" value={f.account} onChange={v => set({account:v})} empty={inc ? "Aucun compte" : "Choisir un compte…"} /></Field>}
      {!inc && <div className="field"><Check checked={f.rec} onChange={v => set({rec:v})}>Chaque mois</Check></div>}
      <div className="actions">{inc && <button type="button" className="btn danger" onClick={del}>Supprimer</button>}<button type="submit" className="btn push">Enregistrer</button></div>
    </Dialog>
  );
}

function TransferDialog({ t, onClose }){
  const editing = !!(t && t.id);
  const [f, setF] = useState(() => ({from:t?.fromAccount || state.accounts[0]?.id || "", to:t?.toAccount || state.accounts[1]?.id || "",
    amount:t ? toInput(t.amount) : "", date:t?.date || defDate(), note:t?.note || "", err:""}));
  const set = p => setF(x => ({...x, ...p}));
  const submit = async () => {
    const amount = parseAmount(f.amount);
    if (!Number.isFinite(amount) || amount <= 0) return set({err:"Indiquez un montant supérieur à 0."});
    if (!f.from || !f.to || f.from === f.to) return set({err:"Choisissez deux comptes différents."});
    if (!dateOk(f.date)) return set({err:"Choisissez une date."});
    const item = {...(editing ? t : {createdAt:Date.now()}), amount, date:f.date, fromAccount:f.from, toAccount:f.to, note:f.note.trim().slice(0, 80) || null};
    try { await store.upsert("transfers", item); onClose(); toast(editing ? "Virement modifié" : "Virement enregistré"); } catch (e) { handleWriteError(e); }
  };
  return (
    <Dialog title={editing ? "Modifier le virement" : "Nouveau virement"} onClose={onClose} onSubmit={submit}>
      <Field label="Depuis le compte" htmlFor="vFrom"><AccountSelect id="vFrom" value={f.from} onChange={v => set({from:v})} /></Field>
      <Field label="Vers le compte" htmlFor="vTo"><AccountSelect id="vTo" value={f.to} onChange={v => set({to:v})} /></Field>
      <Field label="Montant (€)" htmlFor="vAmount"><input className="inp amount" id="vAmount" inputMode="decimal" placeholder="0,00" autoFocus value={f.amount} onChange={e => set({amount:e.target.value})} /></Field>
      <p className="err" role="alert">{f.err}</p>
      <Field label="Date" htmlFor="vDate"><input className="inp" id="vDate" type="date" value={f.date} onChange={e => set({date:e.target.value})} /></Field>
      <Field label="Note" htmlFor="vNote"><input className="inp" id="vNote" maxLength={80} placeholder="ex. Épargne du mois" value={f.note} onChange={e => set({note:e.target.value})} /></Field>
      <div className="actions">{editing && <button type="button" className="btn danger" onClick={async () => { onClose(); try { await removeWithUndo("transfers", t, "Virement supprimé"); } catch (e) { handleWriteError(e); } }}>Supprimer</button>}<button type="submit" className="btn push">Enregistrer</button></div>
    </Dialog>
  );
}

function AccountDialog({ a, onClose }){
  const [f, setF] = useState(() => ({name:a ? a.name : "", bal:a ? toInput(a.balance) || "0" : "", type:a ? a.type : "epargne", err:""}));
  const set = p => setF(x => ({...x, ...p}));
  const submit = async () => {
    const name = f.name.trim(); if (!name) return set({err:"Donnez un nom au compte."});
    const bal = parseAmount(f.bal); if (!Number.isFinite(bal)) return set({err:"Indiquez le solde, par exemple 3200."});
    const acc = {...(a || {createdAt:Date.now(), history:[]}), name:name.slice(0, 40), type:f.type || "autre", balance:bal, updatedAt:Date.now()};
    acc.history = (acc.history || []).concat({balance:bal, date:todayStr()}).slice(-36);
    try { await store.upsert("accounts", acc); onClose(); toast("Compte enregistré"); } catch (e) { handleWriteError(e); }
  };
  return (
    <Dialog title={a ? "Mettre à jour le compte" : "Nouveau compte"} onClose={onClose} onSubmit={submit}>
      <Field label="Nom" htmlFor="aName"><input className="inp" id="aName" maxLength={40} placeholder="ex. Livret A de Léa" autoFocus={!a} value={f.name} onChange={e => set({name:e.target.value})} /></Field>
      <Field label="Type"><Chips label="Type" value={f.type} onChange={v => set({type:v})} items={ACC_TYPES} /></Field>
      <Field label="Solde actuel (€)" htmlFor="aBal"><input className="inp" id="aBal" inputMode="decimal" placeholder="ex. 3200" autoFocus={!!a} value={f.bal} onChange={e => set({bal:e.target.value})} /></Field>
      <p className="err" role="alert">{f.err}</p>
      <div className="actions">{a && <button type="button" className="btn danger" onClick={async () => { onClose(); try { await removeWithUndo("accounts", a, "Compte supprimé"); } catch (e) { handleWriteError(e); } }}>Supprimer</button>}<button type="submit" className="btn push">Enregistrer</button></div>
    </Dialog>
  );
}

/* ---------- Saisie éclair : pavé numérique + catégories fréquentes ---------- */
function topCats(){
  const since = (() => { const d = new Date(); d.setDate(d.getDate() - 90); return dstr(d); })(), c = {};
  state.expenses.filter(e => e.date >= since && !e.recurringId).forEach(e => { const id = catOf(e.cat).id; c[id] = (c[id] || 0) + 1; });
  const ranked = Object.keys(c).sort((a, b) => c[b] - c[a]);
  ["courses", "loisirs", "transport", "sante", "enfants", "autre"].forEach(id => { if (!ranked.includes(id)) ranked.push(id); });
  return ranked.slice(0, 6).map(catOf);
}
function QuickDialog({ onClose }){
  const [buf, setBuf] = useState(""), [kind, setKind] = useState("expense"), [label, setLabel] = useState(""), [acc, setAcc] = useState(state.accounts[0]?.id || "");
  const cents = buf ? Math.round(parseFloat(buf.replace(",", ".")) * 100) : 0;
  const press = k => setBuf(b => {
    if (k === "⌫") return b.slice(0, -1);
    if (k === ",") return b.includes(",") ? b : (b || "0") + ",";
    const dec = b.split(",")[1]; if ((dec && dec.length >= 2) || b.replace(",", "").length >= 7) return b;
    return b === "0" ? k : b + k;
  });
  useEffect(() => {
    const h = e => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === "," || e.key === ".") press(","); else if (e.key === "Backspace" && e.target.tagName !== "INPUT") press("⌫"); };
    document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h);
  }, []);
  const addExpense = async c => {
    if (!(cents > 0)) return;
    const payer = me() || members()[0]?.id || "";
    try {
      const id = await store.upsert("expenses", {amount:cents, label:c.name, cat:c.id, payer, split:"all", shares:currentWeights(), accountId:acc || null, date:todayStr(), by:me() || null, createdAt:Date.now()});
      onClose(); logAct(`a ajouté « ${c.name} » (${fmt(cents)})`);
      toast(`${fmt(cents)} en ${c.name} enregistré`, "Annuler", () => store.remove("expenses", id));
    } catch (e) { handleWriteError(e); }
  };
  const addIncome = async () => {
    if (!(cents > 0)) return;
    const l = label.trim().slice(0, 60) || "Revenu rapide";
    try {
      const id = await store.upsert("incomes", {amount:cents, label:l, who:me() || "", accountId:acc || null, date:todayStr(), createdAt:Date.now()});
      onClose(); logAct(`a ajouté le revenu « ${l} » (${fmt(cents)})`);
      toast(`${fmt(cents)} de revenu enregistré`, "Annuler", () => store.remove("incomes", id));
    } catch (e) { handleWriteError(e); }
  };
  const more = () => { onClose(); if (kind === "income") openIncome(null, cents > 0 ? {amount:cents} : {}); else openExpense(null, "expenses", cents > 0 ? {amount:cents, date:todayStr()} : {}); };
  return (
    <Dialog title="Saisie éclair" onClose={onClose} closeLabel="Fermer" form={false}>
      <div className="qamt" aria-live="polite">{buf ? buf.replace(".", ",") + " €" : "0 €"}</div>
      <div className="qpad">{["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"].map(k =>
        <button key={k} type="button" aria-label={k === "⌫" ? "Effacer" : k} onClick={() => press(k)}>{k === "⌫" ? <Icon name="delete" /> : k}</button>)}</div>
      <div className="chips jcenter my4" role="radiogroup" aria-label="Nature">
        <button type="button" className="chip" aria-pressed={kind === "expense"} onClick={() => setKind("expense")}>− Dépense</button>
        <button type="button" className="chip" aria-pressed={kind === "income"} onClick={() => setKind("income")}>+ Revenu</button>
        <button type="button" className="chip" onClick={() => { onClose(); openTransfer(cents > 0 ? {amount:cents, date:todayStr()} : null); }}>⇄ Virement</button>
      </div>
      <div className="field qacc"><select className="inp" aria-label="Compte" value={acc} onChange={e => setAcc(e.target.value)}>{state.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
      <p className="hint tcenter">{kind === "income" ? "Montant, puis Enregistrer" : `Montant, puis catégorie${me() ? " · " + memberName(me()) : ""} · aujourd'hui`}</p>
      {kind === "expense" && <div className="qcats">{topCats().map(c =>
        <button key={c.id} type="button" style={{background:c.color}} disabled={!(cents > 0)} onClick={() => addExpense(c)}><Icon name={c.ico || "tag"} />{c.name}</button>)}</div>}
      {kind === "income" && <div className="field qinc">
        <input className="inp" maxLength={60} placeholder="ex. Salaire, CAF, prime" aria-label="Libellé du revenu" value={label} onChange={e => setLabel(e.target.value)} />
        <button type="button" className="btn push wfull mt10" disabled={!(cents > 0)} onClick={addIncome}>Enregistrer le revenu</button>
      </div>}
      <div className="actions"><button type="button" className="linkbtn" onClick={more}>Plus de détails…</button></div>
    </Dialog>
  );
}

function BudgetsDialog({ onClose }){
  const k = curKey(), byCat = sumBy(inMonth(state.expenses, k).filter(bud), e => catOf(e.cat).id), cb = state.settings.catBudgets || {};
  const [total, setTotal] = useState(toInput(state.settings.budget || 0));
  const [vals, setVals] = useState(() => Object.fromEntries(allCats().map(c => [c.id, cb[c.id] ? toInput(cb[c.id]) : ""])));
  const [err, setErr] = useState("");
  const submit = async () => {
    const tot = total.trim() ? parseAmount(total) : 0;
    if (!Number.isFinite(tot) || tot < 0) return setErr("Le budget total doit être un montant, par exemple 1800.");
    const catBudgets = {};
    for (const [id, s] of Object.entries(vals)) {
      if (!s.trim()) continue;
      const v = parseAmount(s);
      if (!Number.isFinite(v) || v < 0) return setErr("Montant invalide pour une catégorie.");
      if (v > 0) catBudgets[id] = v;
    }
    try { await store.saveSettings({...state.settings, budget:tot, catBudgets}); onClose(); toast("Budgets enregistrés"); } catch (e) { handleWriteError(e); }
  };
  return (
    <Dialog title="Budgets du mois" wide onClose={onClose} onSubmit={submit}>
      <p className="small muted mb12">Laissez vide pour ne pas suivre une catégorie. Vous êtes alerté dès <b>{(state.settings.alertPct || 80) + " %"}</b> d'un budget, et au dépassement.</p>
      <Field label="Budget total du foyer (€ / mois)" htmlFor="budTotal"><input className="inp" id="budTotal" inputMode="decimal" placeholder="facultatif" value={total} onChange={e => setTotal(e.target.value)} /></Field>
      <div>{allCats().map(c => { const v = byCat[c.id] || 0, b = cb[c.id] || 0;
        return <div className="erow" key={c.id}><span className="cn"><CatIco c={c} /> {c.name}</span><span className={"sp " + (b && v > b ? "over" : "")}>{fmt(v)} dépensés</span>
          <input className="inp r" inputMode="decimal" placeholder="—" aria-label={`Budget ${c.name} en euros`} value={vals[c.id]} onChange={e => setVals(x => ({...x, [c.id]:e.target.value}))} /></div>; })}</div>
      <p className="err" role="alert">{err}</p>
      <div className="actions"><button type="submit" className="btn push">Enregistrer</button></div>
    </Dialog>
  );
}

function PotDialog({ onClose }){
  const [kind, setKind] = useState("in"), [amt, setAmt] = useState(""), [who, setWho] = useState(me() || members()[0]?.id || ""), [err, setErr] = useState("");
  const submit = async () => {
    const a = parseAmount(amt); if (!Number.isFinite(a) || a <= 0) return setErr("Indiquez un montant.");
    try { await store.upsert("potmoves", {member:who || "", amount:a, kind, date:todayStr(), createdAt:Date.now()}); onClose(); logAct(`${kind === "out" ? "a retiré" : "a versé"} ${fmt(a)} ${kind === "out" ? "de" : "dans"} la cagnotte`); }
    catch (e) { handleWriteError(e); }
  };
  return (
    <Dialog title="Mouvement de cagnotte" onClose={onClose} onSubmit={submit}>
      <Field label="Type"><Chips value={kind} onChange={setKind} items={[{id:"in", label:"Versement"}, {id:"out", label:"Retrait"}]} label="Type" /></Field>
      <Field label="Montant (€)" htmlFor="potAmt"><input className="inp amount" id="potAmt" inputMode="decimal" placeholder="0,00" autoFocus value={amt} onChange={e => setAmt(e.target.value)} /></Field>
      <Field label="Qui"><Chips value={who} onChange={setWho} items={members().map(m => ({id:m.id, label:m.name}))} label="Qui" /></Field>
      <p className="err" role="alert">{err}</p>
      <div className="actions"><button type="submit" className="btn push">Enregistrer</button></div>
    </Dialog>
  );
}

/* ---------- Sélection multiple ---------- */
export function selectedItems(){ return Array.from(state.selIds).map(k => { const [l, id] = k.split("|"); const it = state[l].find(x => x.id === id); return it ? [l, it] : null; }).filter(Boolean); }
export function exitSel(){ state.sel = false; state.selIds.clear(); bump(); }
export async function deleteSelection(){
  const items = selectedItems(); if (!items.length) return;
  const copies = items.map(([l, it]) => [l, JSON.parse(JSON.stringify(it))]), n = items.length, s = n > 1 ? "s" : "";
  try {
    for (const [l, it] of items) { await store.remove(l, it.id); toTrash(l, it); }
    logAct(`a supprimé ${n} dépense${s}`);
    exitSel();
    toast(`${n} dépense${s} supprimée${s}`, "Annuler", async () => { for (const [l, it] of copies) await store.upsert(l, it); toast("Restauré"); });
  } catch (e) { handleWriteError(e); }
}
function BulkDialog({ onClose }){
  const [f, setF] = useState({cat:"", payer:"", proj:"", tag:""});
  const set = p => setF(x => ({...x, ...p}));
  const submit = async () => {
    const tags = parseTags(f.tag), items = selectedItems(); let n = 0;
    try {
      for (const [l, it] of items) {
        const u = {...it};
        if (f.cat) u.cat = f.cat;
        if (f.payer && l === "expenses") u.payer = f.payer;
        if (f.proj) u.project = f.proj === "__none" ? null : f.proj;
        if (tags.length) u.tags = Array.from(new Set([...(u.tags || []), ...tags])).slice(0, 8);
        await store.upsert(l, u); n++;
      }
      onClose(); logAct(`a modifié ${n} dépense${n > 1 ? "s" : ""} d'un coup`); exitSel(); toast(`${n} dépense${n > 1 ? "s" : ""} modifiée${n > 1 ? "s" : ""}`);
    } catch (e) { handleWriteError(e); }
  };
  const keep = <option value="">(ne pas changer)</option>;
  return (
    <Dialog title="Modifier la sélection" onClose={onClose} onSubmit={submit}>
      <Field label="Catégorie" htmlFor="bCat"><select className="inp" id="bCat" value={f.cat} onChange={e => set({cat:e.target.value})}>{keep}{allCats().map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Payé par" htmlFor="bPayer"><select className="inp" id="bPayer" value={f.payer} onChange={e => set({payer:e.target.value})}>{keep}{members().map(m => <option key={m.id} value={m.id}>{m.name}</option>)}{state.settings.pot?.enabled && <option value="pot">Cagnotte</option>}</select></Field>
      <Field label="Projet" htmlFor="bProj"><select className="inp" id="bProj" value={f.proj} onChange={e => set({proj:e.target.value})}>{keep}<option value="__none">Aucun projet</option>{state.projects.filter(p => !p.archived).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Ajouter une étiquette" htmlFor="bTag"><input className="inp" id="bTag" maxLength={30} placeholder="ex. #vacances" value={f.tag} onChange={e => set({tag:e.target.value})} /></Field>
      <div className="actions"><button type="submit" className="btn push">Appliquer</button></div>
    </Dialog>
  );
}

registerDialog("expense", ExpenseDialog);
registerDialog("kind", KindDialog);
registerDialog("income", IncomeDialog);
registerDialog("transfer", TransferDialog);
registerDialog("account", AccountDialog);
registerDialog("quick", QuickDialog);
registerDialog("budgets", BudgetsDialog);
registerDialog("pot", PotDialog);
registerDialog("bulk", BulkDialog);
