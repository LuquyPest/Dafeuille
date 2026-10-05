/* Onglet Patrimoine : comptes (soldes vivants) et virements, crédits, projection à 12 mois, simulateur de crédit,
   voitures, garanties, compteurs d'énergie. */
import { useState } from "react";
import { Icon } from "../ui/icons.jsx";
import { Empty, Chips, Check, Field } from "../ui/bits.jsx";
import { Columns } from "../ui/Columns.jsx";
import { Dialog, openDialog, registerDialog } from "../ui/Dialog.jsx";
import { useStore } from "../lib/hooks.js";
import { state, fmt, toInput, parseAmount, parseNum, todayStr, fmtDay, monthLabel, prevKey, nextKey, parseD, dstr, daysBetween, uid, ACC_TYPES,
  members, me, currentWeights, inMonth, totalOf, incTotal, curKey } from "../lib/core.js";
import { store, toast, handleWriteError } from "../data/store.js";
import { removeWithUndo, warrantyEnd } from "../lib/domain.js";
import { openAccount, openTransfer } from "../dialogs/Money.jsx";

const Del = ({ onClick }) => <button type="button" className="btn danger" onClick={onClick}>Supprimer</button>;
const delThen = (onClose, list, item, msg) => async () => { onClose(); try { await removeWithUndo(list, item, msg); } catch (e) { handleWriteError(e); } };
const n1 = v => (Math.round(v * 10) / 10).toLocaleString("fr-FR");

/* ---------- Comptes ---------- */
export function accountMovements(a){
  const since = a.updatedAt || 0, sinceDay = dstr(new Date(since));
  // Une opération importée d'un relevé compte selon sa date bancaire : antérieure au pointage, elle est déjà dans le solde.
  const after = e => e.imported ? e.date > sinceDay : (e.createdAt || 0) >= since;
  let sum = 0;
  state.expenses.forEach(e => { if (e.accountId === a.id && after(e)) sum -= (e.amount || 0); });
  state.incomes.forEach(e => { if (e.accountId === a.id && after(e)) sum += (e.amount || 0); });
  state.transfers.forEach(t => { if ((t.createdAt || 0) < since) return; if (t.fromAccount === a.id) sum -= (t.amount || 0); if (t.toAccount === a.id) sum += (t.amount || 0); });
  return sum;
}
export const accountBalance = a => (a.balance || 0) + accountMovements(a);
const sortedAccounts = () => state.accounts.slice().sort((a, b) => ACC_TYPES.findIndex(t => t.id === a.type) - ACC_TYPES.findIndex(t => t.id === b.type));
const accTotal = types => sortedAccounts().filter(a => types.includes(a.type)).reduce((s, a) => s + accountBalance(a), 0);
const accIcon = t => t === "courant" ? "credit-card" : t === "epargne" ? "piggy-bank" : t === "placement" ? "trending-up" : "landmark";

function Accounts({ canEdit }){
  const accs = sortedAccounts(), accName = id => (state.accounts.find(a => a.id === id) || {}).name || "—";
  const trf = state.transfers.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  // Évolution du total (historique des pointages)
  const months = new Set(); accs.forEach(a => (a.history || []).forEach(h => months.add(String(h.date).slice(0, 7))));
  const ks = Array.from(months).sort().slice(-12);
  const vals = ks.map(k => accs.reduce((s, a) => { const h = (a.history || []).filter(x => String(x.date).slice(0, 7) <= k).sort((p, q) => String(q.date).localeCompare(String(p.date)))[0]; return s + (h ? h.balance : 0); }, 0));
  const max = Math.max(...vals.map(Math.abs), 1);
  return <section className="panel"><div className="phead"><h2>Comptes</h2>
      <button className="btn sm ghost" disabled={!canEdit} onClick={() => openTransfer(null)}>+ Virement</button><button className="btn sm" disabled={!canEdit} onClick={() => openAccount(null)}>+ Compte</button></div>
    <div>{accs.length ? <><ul className="items">{accs.map(a => { const bal = accountBalance(a), mv = accountMovements(a);
        return <li key={a.id}><span className="ic"><Icon name={accIcon(a.type)} /></span>
          <span className="tx">{a.name}<span>{(ACC_TYPES.find(t => t.id === a.type) || {}).label || ""} · pointé le {fmtDay(dstr(new Date(a.updatedAt || Date.now())))}{mv ? ` · ${mv > 0 ? "+" : ""}${fmt(mv)} depuis` : ""}</span></span>
          <b className={bal < 0 ? "over" : ""}>{fmt(bal)}</b>{canEdit && <button className="x" aria-label={`Mettre à jour ${a.name}`} onClick={() => openAccount(a)}><Icon name="pencil" /></button>}</li>; })}</ul>
        <div className="kpis mt12"><div className="kpi"><span>Comptes courants</span><b>{fmt(accTotal(["courant"]))}</b></div><div className="kpi"><span>Épargne</span><b>{fmt(accTotal(["epargne", "placement"]))}</b></div>
          <div className="kpi"><span>Total</span><b>{fmt(accTotal(["courant", "epargne", "placement", "autre"]))}</b></div></div>
        {ks.length >= 2 && <><h3>Évolution du total</h3><div className="cols h100">{vals.map((v, i) => <div className="c" key={ks[i]} title={`${monthLabel(ks[i])} : ${fmt(v)}`}>
          <i style={{height:`calc((100% - 22px) * ${(Math.abs(v) / max).toFixed(4)})`}} /><b>{parseD(ks[i] + "-01").toLocaleDateString("fr-FR", {month:"narrow"})}</b></div>)}</div></>}</>
      : <Empty icon="landmark" action={canEdit ? () => openAccount(null) : null} label="+ Ajouter un compte">Aucun compte suivi</Empty>}</div>
    <div className="mt10">{trf.length > 0 && <><h3>Virements récents</h3><ul className="items">{trf.map(t => <li key={t.id}><span className="ic"><Icon name="repeat" /></span>
      <span className="tx">{accName(t.fromAccount)} → {accName(t.toAccount)}<span>{fmtDay(t.date)}{t.note ? " · " + t.note : ""}</span></span>
      <b>{fmt(t.amount)}</b>{canEdit && <button className="x" aria-label="Modifier ce virement" onClick={() => openTransfer(t)}><Icon name="pencil" /></button>}</li>)}</ul></>}</div>
  </section>;
}

/* ---------- Crédits ---------- */
function debtInfo(d){
  const r = (d.rate || 0) / 100 / 12, B = d.remaining || 0, P = d.monthly || 0;
  let n = Infinity;
  if (B <= 0) n = 0; else if (P > 0) n = r > 0 ? (r * B < P ? Math.ceil(-Math.log(1 - r * B / P) / Math.log(1 + r)) : Infinity) : Math.ceil(B / P);
  const end = Number.isFinite(n) ? (() => { const x = new Date(); x.setMonth(x.getMonth() + n); return x; })() : null;
  return {n, end, interest:Number.isFinite(n) ? Math.max(0, n * P - B) : null};
}
const sortedDebts = () => state.debts.slice().sort((a, b) => (b.remaining || 0) - (a.remaining || 0));
function Debts({ canEdit }){
  const debts = sortedDebts();
  const pay = async d => {
    const before = {...d}, remaining = Math.max(0, Math.round((d.remaining || 0) * (1 + (d.rate || 0) / 1200) - d.monthly));
    try { await store.upsert("debts", {...d, remaining, updatedAt:Date.now()}); toast(`Capital restant : ${fmt(remaining)}`, "Annuler", () => store.upsert("debts", before)); } catch (e) { handleWriteError(e); }
  };
  return <section className="panel"><div className="phead"><h2>Crédits et dettes</h2><button className="btn sm" disabled={!canEdit} onClick={() => openDialog("debt", {})}>+ Crédit</button></div>
    {!debts.length ? <div className="empty"><Icon name="credit-card" />Aucun crédit</div> : <>{debts.map(d => {
      const i = debtInfo(d), prog = d.principal > 0 ? 1 - (d.remaining || 0) / d.principal : 0;
      return <div className="card" key={d.id}><div className="gh"><span className="tile"><Icon name="landmark" /></span><strong>{d.name}</strong>
          {canEdit && <button className="x" aria-label={`Modifier ${d.name}`} onClick={() => openDialog("debt", {d})}><Icon name="pencil" /></button>}</div>
        <div className="bigval">{fmt(d.remaining)}<span className="muted projbud"> restants</span></div>
        <div className="track h8 my8"><i style={{width:Math.min(100, Math.max(0, prog * 100)).toFixed(1) + "%", background:"var(--good)"}} /></div>
        <p className="small muted m0">{Math.round(prog * 100)} % remboursé · {fmt(d.monthly)} / mois{d.rate ? ` · ${String(d.rate).replace(".", ",")} %` : ""}</p>
        <p className="small mt4">{i.n === 0 ? "Remboursé" : i.end ? <>Fin estimée : <strong>{i.end.toLocaleDateString("fr-FR", {month:"long", year:"numeric"})}</strong> ({i.n} mois){i.interest != null ? ` · intérêts restants ≈ ${fmt(i.interest)}` : ""}</> : <span className="over">La mensualité ne couvre pas les intérêts.</span>}</p>
        {canEdit && d.remaining > 0 && <div className="actions"><button className="btn sm ghost" onClick={() => pay(d)}>Mensualité payée</button></div>}</div>;
    })}<p className="small debtfoot">Total restant dû : <strong>{fmt(debts.reduce((s, d) => s + (d.remaining || 0), 0))}</strong></p></>}</section>;
}
function DebtDialog({ d, onClose }){
  const [f, setF] = useState({name:d ? d.name : "", principal:d ? toInput(d.principal) : "", remaining:d ? toInput(d.remaining) : "", monthly:d ? toInput(d.monthly) : "", rate:d && d.rate ? String(d.rate).replace(".", ",") : "", err:""}), set = p => setF(x => ({...x, ...p}));
  const submit = async () => {
    const name = f.name.trim(); if (!name) return set({err:"Donnez un nom au crédit."});
    const principal = parseAmount(f.principal), remaining = parseAmount(f.remaining), monthly = parseAmount(f.monthly), rate = f.rate.trim() ? parseNum(f.rate) : 0;
    if (!Number.isFinite(remaining) || remaining < 0) return set({err:"Indiquez le capital restant dû."});
    if (!Number.isFinite(monthly) || monthly <= 0) return set({err:"Indiquez la mensualité."});
    if (!Number.isFinite(rate) || rate < 0) return set({err:"Le taux doit être un nombre, par exemple 3,2."});
    try { await store.upsert("debts", {...(d || {createdAt:Date.now()}), name:name.slice(0, 40), principal:Number.isFinite(principal) && principal > 0 ? principal : remaining, remaining, monthly, rate, updatedAt:Date.now()}); onClose(); toast("Crédit enregistré"); }
    catch (e) { handleWriteError(e); }
  };
  const F = (id, label, k, ph) => <Field label={label} htmlFor={id}><input className="inp" id={id} inputMode="decimal" placeholder={ph} value={f[k]} onChange={e => set({[k]:e.target.value})} /></Field>;
  return <Dialog title={d ? "Modifier le crédit" : "Nouveau crédit"} onClose={onClose} onSubmit={submit}>
    <Field label="Nom" htmlFor="dName"><input className="inp" id="dName" maxLength={40} placeholder="ex. Prêt immobilier, crédit auto" autoFocus value={f.name} onChange={e => set({name:e.target.value})} /></Field>
    {F("dPrincipal", "Montant emprunté (€)", "principal")}{F("dRemaining", "Capital restant dû (€)", "remaining")}{F("dMonthly", "Mensualité (€)", "monthly")}{F("dRate", "Taux annuel (%)", "rate", "ex. 3,2")}
    <p className="err" role="alert">{f.err}</p>
    <div className="actions">{d && <Del onClick={delThen(onClose, "debts", d, "Crédit supprimé")} />}<button type="submit" className="btn push">Enregistrer</button></div>
  </Dialog>;
}

/* ---------- Projection sur 12 mois ---------- */
function Projection(){
  const now = curKey(), past = [prevKey(now), prevKey(prevKey(now)), prevKey(prevKey(prevKey(now)))];
  const nets = past.map(k => incTotal(inMonth(state.incomes, k)) - totalOf(inMonth(state.expenses, k))).filter((_, i) => incTotal(inMonth(state.incomes, past[i])) > 0);
  const accs = state.accounts, debts = sortedDebts();
  let body;
  if (!nets.length && !accs.length) body = <div className="empty"><Icon name="chart-line" />Ajoutez revenus et comptes pour voir la projection</div>;
  else {
    const totalAcc = accTotal(["courant", "epargne", "placement", "autre"]), totalDebt = debts.reduce((s, d) => s + (d.remaining || 0), 0);
    const net = nets.length ? Math.round(nets.reduce((a, b) => a + b, 0) / nets.length) : 0;
    const sim = debts.map(d => ({B:d.remaining || 0, P:d.monthly || 0, r:(d.rate || 0) / 1200})), vals = [];
    for (let i = 1; i <= 12; i++) { sim.forEach(x => { x.B = Math.max(0, x.B * (1 + x.r) - x.P); }); vals.push(totalAcc + net * i - sim.reduce((s, x) => s + x.B, 0)); }
    const cur = totalAcc - totalDebt, maxAbs = Math.max(...vals.map(Math.abs), Math.abs(cur), 1);
    const keys = []; let kk = now; for (let i = 0; i < 12; i++) { kk = nextKey(kk); keys.push(kk); }
    body = <><div className="kpis"><div className="kpi"><span>Patrimoine net aujourd'hui</span><b>{fmt(cur)}</b></div>
        <div className="kpi"><span>Épargne nette / mois</span><b className={net < 0 ? "over" : ""}>{nets.length ? fmt(net) : "—"}</b></div>
        <div className="kpi"><span>Dans 12 mois</span><b className={vals[11] < cur ? "over" : "down"}>{fmt(vals[11])}</b></div></div>
      <div className="cols h130">{vals.map((v, i) => <div className="c" key={keys[i]} title={`${monthLabel(keys[i])} : ${fmt(v)}`}>
        <i style={{height:`calc((100% - 22px) * ${(Math.abs(v) / maxAbs).toFixed(4)})`, background:v < 0 ? "var(--warn)" : "var(--accent-soft)"}} /><b>{parseD(keys[i] + "-01").toLocaleDateString("fr-FR", {month:"narrow"})}</b></div>)}</div></>;
  }
  return <section className="panel"><h2>Projection sur 12 mois</h2><div>{body}</div></section>;
}

/* ---------- Simulateur de crédit (valeurs gardées entre deux visites de l'onglet) ---------- */
const cs = {amt:"15000", rate:"4", years:"5"};
function CredSim(){
  const [, force] = useState(0), set = (k, v) => { cs[k] = v; force(x => x + 1); };
  const P = parseNum(cs.amt), r = parseNum(cs.rate) / 1200, n = Math.round(parseNum(cs.years) * 12);
  let body;
  if (!(P > 0) || !(n > 0) || !(r >= 0)) body = <p className="muted small m0">Renseignez le montant, le taux et la durée.</p>;
  else {
    const m = r ? P * r / (1 - Math.pow(1 + r, -n)) : P / n, total = m * n, inc = incTotal(inMonth(state.incomes, prevKey(curKey())));
    const curDebt = state.debts.filter(d => d.remaining > 0).reduce((s, d) => s + (d.monthly || 0), 0) / 100, ratio = inc ? (curDebt + m) / (inc / 100) : 0;
    body = <><div className="kpis m0"><div className="kpi"><span>Mensualité</span><b>{fmt(m * 100)}</b></div><div className="kpi"><span>Coût des intérêts</span><b>{fmt((total - P) * 100)}</b></div><div className="kpi"><span>Total remboursé</span><b>{fmt(total * 100)}</b></div></div>
      {inc ? <p className="small mt10 m0b">Avec vos revenus du mois dernier ({fmt(inc)}), l'endettement passerait à <b className={ratio > 0.35 ? "over" : ""}>{(Math.round(ratio * 1000) / 10).toLocaleString("fr-FR")} %</b>{ratio > 0.35 ? " — au-dessus des 35 % généralement acceptés par les banques." : "."}</p> : null}
      <p className="muted small mt6 m0b">Hors assurance et frais de dossier.</p></>;
  }
  const In = (id, label, k) => <div className="f1"><label className="small" htmlFor={id}>{label}</label><input className="inp" id={id} inputMode="decimal" value={cs[k]} onChange={e => set(k, e.target.value)} /></div>;
  return <section className="panel"><h2>Simulateur de crédit</h2>
    <div className="erow">{In("csAmt", "Montant (€)", "amt")}{In("csRate", "Taux (%)", "rate")}{In("csYears", "Durée (ans)", "years")}</div>
    <div className="mt10">{body}</div></section>;
}

/* ---------- Voiture ---------- */
function carStats(c){
  const en = (c.entries || []).slice().sort((a, b) => (a.km || 0) - (b.km || 0) || a.date.localeCompare(b.date));
  const kms = en.map(e => e.km).filter(k => k > 0), fills = en.filter(e => e.kind === "plein" && e.km > 0 && e.liters > 0);
  let cons = null; if (fills.length >= 2) { const lit = fills.slice(1).reduce((s, f) => s + f.liters, 0), dist = fills[fills.length - 1].km - fills[0].km; if (dist > 0) cons = lit / dist * 100; }
  const dist = kms.length >= 2 ? Math.max(...kms) - Math.min(...kms) : 0, total = en.reduce((s, e) => s + (e.amount || 0), 0);
  const lastM = en.filter(e => e.kind === "entretien").sort((a, b) => b.date.localeCompare(a.date))[0];
  return {en, cons, total, perKm:dist ? total / dist : null, km:kms.length ? Math.max(...kms) : null, lastM};
}
function Cars({ canEdit }){
  const delEntry = async (c, eid) => { try { await store.upsert("cars", {...c, entries:c.entries.filter(x => x.id !== eid)}); } catch (e) { handleWriteError(e); } };
  return <section className="panel"><div className="phead"><h2>Voiture</h2><button className="btn sm" disabled={!canEdit} onClick={() => openDialog("car", {})}>+ Véhicule</button></div>
    {!state.cars.length ? <div className="empty"><Icon name="car" />Aucun véhicule</div> : state.cars.map(c => { const s = carStats(c), soon = c.nextKm && s.km && c.nextKm - s.km <= 1000;
      return <div className="card" key={c.id}><div className="gh"><span className="tile"><Icon name="car" /></span><strong>{c.name}</strong>
          {canEdit && <button className="x" aria-label={`Modifier ${c.name}`} onClick={() => openDialog("car", {c})}><Icon name="pencil" /></button>}</div>
        <div className="kpis my8"><div className="kpi"><span>Compteur</span><b>{s.km ? s.km.toLocaleString("fr-FR") + " km" : "—"}</b></div><div className="kpi"><span>Conso.</span><b>{s.cons ? n1(s.cons) + " L/100" : "—"}</b></div><div className="kpi"><span>Coût / km</span><b>{s.perKm ? fmt(s.perKm) : "—"}</b></div></div>
        <p className="small muted m0">{s.en.length} entrée{s.en.length > 1 ? "s" : ""} · total {fmt(s.total)}{s.lastM ? ` · dernier entretien le ${fmtDay(s.lastM.date, {day:"numeric", month:"short", year:"numeric"})}` : ""}</p>
        {c.nextKm ? <p className={"small mt4 " + (soon ? "up" : "")}>Prochain entretien à {c.nextKm.toLocaleString("fr-FR")} km{s.km ? ` (dans ${(c.nextKm - s.km).toLocaleString("fr-FR")} km)` : ""}</p> : null}
        {s.en.length > 0 && <ul className="mini mt8">{s.en.slice(-4).reverse().map(e => <li key={e.id}><span>{fmtDay(e.date)} · {e.kind === "plein" ? "plein" + (e.liters ? " " + String(e.liters).replace(".", ",") + " L" : "") : e.kind === "entretien" ? (e.note || "entretien") : (e.note || "autre")}{e.km ? " · " + e.km.toLocaleString("fr-FR") + " km" : ""}</span>
          <span className="num">{fmt(e.amount)}</span>{canEdit && <button className="x" aria-label="Supprimer" onClick={() => delEntry(c, e.id)}><Icon name="x" /></button>}</li>)}</ul>}
        {canEdit && <div className="actions"><button className="btn sm" onClick={() => openDialog("carEntry", {cid:c.id})}>+ Plein ou entretien</button></div>}</div>; })}</section>;
}
function CarDialog({ c, onClose }){
  const [f, setF] = useState({name:c ? c.name : "", next:c && c.nextKm ? String(c.nextKm) : "", err:""}), set = p => setF(x => ({...x, ...p}));
  const submit = async () => {
    const name = f.name.trim(); if (!name) return set({err:"Donnez un nom au véhicule."});
    const nk = parseInt(f.next, 10);
    try { await store.upsert("cars", {...(c || {entries:[], createdAt:Date.now()}), name:name.slice(0, 30), nextKm:nk > 0 ? nk : null}); onClose(); } catch (e) { handleWriteError(e); }
  };
  return <Dialog title="Véhicule" onClose={onClose} onSubmit={submit}>
    <div className="field"><input className="inp" maxLength={30} placeholder="ex. Clio" aria-label="Nom" autoFocus value={f.name} onChange={e => set({name:e.target.value})} /></div>
    <Field className="field mt12" label="Prochain entretien (km, facultatif)" htmlFor="cvNext"><input className="inp" id="cvNext" inputMode="numeric" value={f.next} onChange={e => set({next:e.target.value})} /></Field>
    <p className="err" role="alert">{f.err}</p>
    <div className="actions">{c && <Del onClick={delThen(onClose, "cars", c, "Véhicule supprimé")} />}<button type="submit" className="btn push">Enregistrer</button></div>
  </Dialog>;
}
function CarEntryDialog({ cid, onClose }){
  const [f, setF] = useState({kind:"plein", date:todayStr(), km:"", amt:"", lit:"", note:"", exp:true, err:""}), set = p => setF(x => ({...x, ...p}));
  const submit = async () => {
    const c = state.cars.find(x => x.id === cid); if (!c) return;
    const amount = parseAmount(f.amt), km = parseInt(f.km, 10), liters = parseNum(f.lit);
    if (!Number.isFinite(amount) || amount < 0) return set({err:"Indiquez le montant."});
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return set({err:"Choisissez la date."});
    const note = f.note.trim().slice(0, 80), kind = f.kind;
    try {
      await store.upsert("cars", {...c, entries:(c.entries || []).concat({id:uid().slice(0, 8), date:f.date, kind, km:km > 0 ? km : null, liters:kind === "plein" && liters > 0 ? liters : null, amount, note}).slice(-300)});
      if (f.exp && amount > 0) await store.upsert("expenses", {amount, label:kind === "plein" ? `Plein ${c.name}` : `${kind === "entretien" ? "Entretien" : "Voiture"} ${c.name}${note ? " – " + note : ""}`.slice(0, 80), cat:"transport", payer:me() || members()[0]?.id || "", split:"all", shares:currentWeights(), date:f.date, by:me() || null, tags:["voiture"], createdAt:Date.now()});
      onClose(); toast("Enregistré");
    } catch (e) { handleWriteError(e); }
  };
  return <Dialog title="Plein ou entretien" onClose={onClose} onSubmit={submit}>
    <Field label="Type"><Chips label="Type" value={f.kind} onChange={v => set({kind:v})} items={[{id:"plein", label:<><Icon name="fuel" /> Plein</>}, {id:"entretien", label:<><Icon name="wrench" /> Entretien</>}, {id:"autre", label:"Autre"}]} /></Field>
    <div className="erow"><div className="f1"><label className="small" htmlFor="ceDate">Date</label><input className="inp" id="ceDate" type="date" value={f.date} onChange={e => set({date:e.target.value})} /></div>
      <div className="f1"><label className="small" htmlFor="ceKm">Compteur (km)</label><input className="inp" id="ceKm" inputMode="numeric" value={f.km} onChange={e => set({km:e.target.value})} /></div></div>
    <div className="erow mt12"><div className="f1"><label className="small" htmlFor="ceAmt">Montant (€)</label><input className="inp" id="ceAmt" inputMode="decimal" autoFocus value={f.amt} onChange={e => set({amt:e.target.value})} /></div>
      {f.kind === "plein" && <div className="f1"><label className="small" htmlFor="ceLit">Litres</label><input className="inp" id="ceLit" inputMode="decimal" value={f.lit} onChange={e => set({lit:e.target.value})} /></div>}</div>
    <Field className="field mt12" label="Note" htmlFor="ceNote"><input className="inp" id="ceNote" maxLength={80} placeholder="ex. vidange, pneus" value={f.note} onChange={e => set({note:e.target.value})} /></Field>
    <div className="field"><Check checked={f.exp} onChange={v => set({exp:v})}>Ajouter aussi aux dépenses</Check></div>
    <p className="err" role="alert">{f.err}</p>
    <div className="actions"><button type="submit" className="btn push">Enregistrer</button></div>
  </Dialog>;
}

/* ---------- Garanties ---------- */
function Warranties({ canEdit }){
  const t = todayStr();
  const l = state.warranties.map(w => ({...w, end:warrantyEnd(w)})).sort((a, b) => (a.end < t ? 1 : 0) - (b.end < t ? 1 : 0) || a.end.localeCompare(b.end));
  return <section className="panel"><div className="phead"><h2>Garanties et gros achats</h2><button className="btn sm" disabled={!canEdit} onClick={() => openDialog("warranty", {})}>+ Achat</button></div>
    {!l.length ? <div className="empty"><Icon name="shield-check" />Aucun achat suivi</div> : <ul className="items">{l.map(w => {
      const d = daysBetween(t, w.end), expired = d < 0;
      const parts = [w.store || null, "acheté le " + fmtDay(w.date, {day:"numeric", month:"short", year:"numeric"}),
        expired ? "garantie terminée" : <span className={d <= 60 ? "up" : ""}>garantie jusqu'au {fmtDay(w.end, {day:"numeric", month:"short", year:"numeric"})}</span>, w.note || null].filter(Boolean);
      return <li key={w.id} className={expired ? "op6" : ""}><span className="ic"><Icon name="shield-check" /></span><span className="tx">{w.name}<span>{parts.map((x, i) => <span className="inl" key={i}>{i > 0 && " · "}{x}</span>)}</span></span>
        {w.price ? <b>{fmt(w.price)}</b> : null}{canEdit && <button className="x" aria-label={`Modifier ${w.name}`} onClick={() => openDialog("warranty", {w:state.warranties.find(x => x.id === w.id)})}><Icon name="pencil" /></button>}</li>; })}</ul>}</section>;
}
function WarrantyDialog({ w, onClose }){
  const [f, setF] = useState({name:w ? w.name : "", store:w ? w.store || "" : "", date:w ? w.date : todayStr(), months:String(w ? w.months : 24), price:w ? toInput(w.price) : "", note:w ? w.note || "" : "", err:""}), set = p => setF(x => ({...x, ...p}));
  const submit = async () => {
    const name = f.name.trim(), months = parseInt(f.months, 10);
    if (!name) return set({err:"Indiquez l'article."});
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return set({err:"Choisissez la date d'achat."});
    if (!(months >= 1 && months <= 240)) return set({err:"La garantie doit durer entre 1 et 240 mois."});
    const price = f.price.trim() ? parseAmount(f.price) : 0;
    try { await store.upsert("warranties", {...(w || {createdAt:Date.now()}), name:name.slice(0, 60), store:f.store.trim().slice(0, 40), date:f.date, months, price:Number.isFinite(price) ? price : 0, note:f.note.trim().slice(0, 120)}); onClose(); }
    catch (e) { handleWriteError(e); }
  };
  return <Dialog title="Achat sous garantie" onClose={onClose} onSubmit={submit}>
    <Field label="Article" htmlFor="wrName"><input className="inp" id="wrName" maxLength={60} placeholder="ex. Lave-linge Bosch" autoFocus value={f.name} onChange={e => set({name:e.target.value})} /></Field>
    <Field label="Magasin" htmlFor="wrStore"><input className="inp" id="wrStore" maxLength={40} value={f.store} onChange={e => set({store:e.target.value})} /></Field>
    <div className="erow"><div className="f1"><label className="small" htmlFor="wrDate">Date d'achat</label><input className="inp" id="wrDate" type="date" value={f.date} onChange={e => set({date:e.target.value})} /></div>
      <div className="f1"><label className="small" htmlFor="wrMonths">Garantie (mois)</label><input className="inp" id="wrMonths" inputMode="numeric" value={f.months} onChange={e => set({months:e.target.value})} /></div></div>
    <Field className="field mt12" label="Prix (€)" htmlFor="wrPrice"><input className="inp" id="wrPrice" inputMode="decimal" value={f.price} onChange={e => set({price:e.target.value})} /></Field>
    <Field label="Note (n° de série, où est la facture…)" htmlFor="wrNote"><input className="inp" id="wrNote" maxLength={120} value={f.note} onChange={e => set({note:e.target.value})} /></Field>
    <p className="err" role="alert">{f.err}</p>
    <div className="actions">{w && <Del onClick={delThen(onClose, "warranties", w, "Achat supprimé")} />}<button type="submit" className="btn push">Enregistrer</button></div>
  </Dialog>;
}

/* ---------- Compteurs d'énergie ---------- */
function meterPeriods(m){
  const r = (m.readings || []).slice().sort((a, b) => a.date.localeCompare(b.date)), out = [];
  for (let i = 1; i < r.length; i++) { const days = Math.max(1, daysBetween(r[i - 1].date, r[i].date)), used = r[i].value - r[i - 1].value; out.push({from:r[i - 1].date, to:r[i].date, used, perDay:used / days}); }
  return out;
}
function Meter({ m, canEdit }){
  const [v, setV] = useState(""), [d, setD] = useState(todayStr());
  const r = (m.readings || []).slice().sort((a, b) => a.date.localeCompare(b.date)), last = r[r.length - 1], per = meterPeriods(m).slice(-8);
  const lastP = per[per.length - 1], month = lastP ? lastP.perDay * 30.4 : null, maxU = Math.max(...per.map(p => p.perDay), 0.0001), u = m.unit || "";
  const add = async () => {
    const val = parseNum(v);
    if (!Number.isFinite(val) || val < 0) { toast("Indiquez la valeur du compteur."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { toast("Choisissez la date du relevé."); return; }
    const prev = (m.readings || []).filter(x => x.date < d).sort((x, y) => y.date.localeCompare(x.date))[0];
    if (prev && val < prev.value && !confirm("Ce relevé est inférieur au précédent. L'enregistrer quand même ?")) return;
    try { await store.upsert("meters", {...m, readings:(m.readings || []).filter(x => x.date !== d).concat({date:d, value:val}).slice(-120)}); setV(""); toast("Relevé enregistré"); } catch (e) { handleWriteError(e); }
  };
  return <div className="card"><div className="gh"><span className="tile"><Icon name="gauge" /></span><strong>{m.name}</strong>
      {canEdit && <button className="x" aria-label={`Modifier ${m.name}`} onClick={() => openDialog("meter", {m})}><Icon name="pencil" /></button>}</div>
    {last ? <p className="small muted my4">Dernier relevé : <strong className="ink">{last.value.toLocaleString("fr-FR")} {u}</strong> le {fmtDay(last.date, {day:"numeric", month:"short", year:"numeric"})}</p> : <p className="small muted">Aucun relevé.</p>}
    {month != null && <p className="small m0">Rythme actuel : <strong>{n1(lastP.perDay)} {u}/jour</strong>, soit ≈ {Math.round(month).toLocaleString("fr-FR")} {u} par mois{m.price ? ` (≈ ${fmt(month * m.price * 100)})` : ""}.</p>}
    {per.length > 1 && <div className="cols h90 mt8">{per.map(p => <div className="c" key={p.to} title={`${fmtDay(p.from)} – ${fmtDay(p.to)} : ${n1(p.perDay)} ${u}/jour`}><i style={{height:`calc((100% - 22px) * ${(p.perDay / maxU).toFixed(4)})`}} /><b>{fmtDay(p.to, {month:"narrow"})}</b></div>)}</div>}
    {canEdit && <div className="erow mt10"><input className="inp r" inputMode="decimal" placeholder="Nouveau relevé" aria-label="Valeur du compteur" value={v} onChange={e => setV(e.target.value)} />
      <input className="inp" type="date" aria-label="Date du relevé" value={d} onChange={e => setD(e.target.value)} /><button className="btn sm" onClick={add}>Ajouter</button></div>}
  </div>;
}
function Meters({ canEdit }){
  return <section className="panel"><div className="phead"><h2>Compteurs d'énergie</h2><button className="btn sm" disabled={!canEdit} onClick={() => openDialog("meter", {})}>+ Compteur</button></div>
    {!state.meters.length ? <div className="empty"><Icon name="gauge" />Aucun compteur</div> : state.meters.map(m => <Meter key={m.id} m={m} canEdit={canEdit} />)}</section>;
}
function MeterDialog({ m, onClose }){
  const [f, setF] = useState({name:m ? m.name : "", unit:m ? m.unit || "" : "kWh", price:m && m.price ? String(m.price).replace(".", ",") : "", err:""}), set = p => setF(x => ({...x, ...p}));
  const submit = async () => {
    const name = f.name.trim(); if (!name) return set({err:"Donnez un nom au compteur."});
    const price = f.price.trim() ? parseNum(f.price) : 0;
    if (!Number.isFinite(price) || price < 0) return set({err:"Le prix doit être un nombre, par exemple 0,25."});
    try { await store.upsert("meters", {...(m || {readings:[], createdAt:Date.now()}), name:name.slice(0, 30), unit:f.unit.trim().slice(0, 8), price}); onClose(); } catch (e) { handleWriteError(e); }
  };
  return <Dialog title="Compteur" onClose={onClose} onSubmit={submit}>
    <div className="field"><input className="inp" maxLength={30} placeholder="ex. Électricité" aria-label="Nom" autoFocus value={f.name} onChange={e => set({name:e.target.value})} /></div>
    <div className="erow"><div className="f1"><label className="small" htmlFor="mtUnit">Unité</label><input className="inp" id="mtUnit" maxLength={8} placeholder="kWh" value={f.unit} onChange={e => set({unit:e.target.value})} /></div>
      <div className="f1"><label className="small" htmlFor="mtPrice">Prix par unité (€)</label><input className="inp" id="mtPrice" inputMode="decimal" placeholder="ex. 0,25" value={f.price} onChange={e => set({price:e.target.value})} /></div></div>
    <p className="err mt12" role="alert">{f.err}</p>
    <div className="actions">{m && <Del onClick={delThen(onClose, "meters", m, "Compteur supprimé")} />}<button type="submit" className="btn push">Enregistrer</button></div>
  </Dialog>;
}

registerDialog("debt", DebtDialog);
registerDialog("car", CarDialog);
registerDialog("carEntry", CarEntryDialog);
registerDialog("warranty", WarrantyDialog);
registerDialog("meter", MeterDialog);

export default function Patrimoine({ canEdit }){
  useStore();
  return <Columns className="grid even" left={[<Accounts key="acc" canEdit={canEdit} />, <Debts key="debts" canEdit={canEdit} />]}
    right={[<Projection key="proj" />, <CredSim key="sim" />, <Cars key="cars" canEdit={canEdit} />, <Warranties key="war" canEdit={canEdit} />, <Meters key="met" canEdit={canEdit} />]} />;
}
