/* Fenêtre « Nouvelle dépense / Modifier la dépense » : portage complet de expDlg. */
import { useMemo, useRef, useState } from "react";
import { Dialog, openDialog } from "../ui/Dialog.jsx";
import { Icon } from "../ui/icons.jsx";
import { Chips, Check, Field } from "../ui/bits.jsx";
import { state, pref, allCats, catOf, members, memberName, me, currentWeights, BASE, CURRENCIES, REFUND_SOURCES, fmt, toInput, parseAmount, parseNum,
  todayStr, defDate, uid, pad, bKey, parseD } from "../lib/core.js";
import { store, toast, handleWriteError, tickets } from "../data/store.js";
import { guessCat, merchantKey, looksDuplicate, subsOf, parseTags, allTags, recId, written, logAct, removeWithUndo, goToDateMonth } from "../lib/domain.js";
import { ticketDataUrl } from "../lib/image.js";

const privAllowed = () => !!state.uid;
const skipKeyOf = e => { const rr = state.recurring.find(x => x.id === e.recurringId); return rr && rr.freq === "week" ? e.date : e.date.slice(0, 7); };

export async function deleteExpense(e, list){
  logAct(`a supprimé « ${e.label || catOf(e.cat).name} » (${fmt(e.amount)})`);
  let r = null;
  if (e.recurringId) {
    r = state.recurring.find(x => x.id === e.recurringId);
    if (r) await store.upsert("recurring", {...r, skip:Array.from(new Set([...(r.skip || []), skipKeyOf(e)]))});
  }
  await removeWithUndo(list, e, `« ${e.label || catOf(e.cat).name} » supprimée`, async () => {
    if (r) { const cur = state.recurring.find(x => x.id === r.id); if (cur) await store.upsert("recurring", {...cur, skip:(cur.skip || []).filter(k => k !== skipKeyOf(e))}); }
  });
}

/** Il faut au moins un compte bancaire avant de saisir une transaction */
export function needsAccountFirst(){
  if (state.accounts.length) return false;
  toast("Créez d'abord un compte pour enregistrer une transaction");
  openDialog("account", {});
  return true;
}
export function openExpense(exp, list = "expenses", prefill = {}, onSaved = null, title){
  if (!exp && needsAccountFirst()) return;
  openDialog("expense", {exp, list, prefill, onSaved, title});
}

export function ExpenseDialog({ exp, list = "expenses", prefill = {}, onSaved, title, onClose }){
  const src = exp || prefill, ms = members(), potOn = !!(state.settings.pot && state.settings.pot.enabled);
  const amountRef = useRef(null);
  const init = () => {
    const cur = src.currency || BASE(), cat0 = src.cat ? catOf(src.cat).id : pref.get("pc.lastCat", "courses");
    let payer = src.payer || me() || pref.get("pc.lastPayer", "");
    if (!ms.some(m => m.id === payer) && payer !== "pot") payer = ms[0]?.id;
    if (src.payer === "pot" && potOn) payer = "pot";
    const projs = state.projects.filter(p => !p.archived || p.id === src.project);
    return {
      cur, amount:src.currency && src.currency !== BASE() ? toInput(src.origAmount) : toInput(src.amount),
      rate:src.rate ? String(src.rate).replace(".", ",") : (state.settings.rates?.[cur] ? String(state.settings.rates[cur]).replace(".", ",") : ""),
      label:src.label || "", cat:allCats().some(c => c.id === cat0) ? cat0 : "courses", sub:src.sub || "",
      payer, split:src.split && ms.some(m => m.id === src.split) ? src.split : "all",
      date:src.date || defDate(), priv:list === "privates", note:src.note || "",
      rec:false, recEvery:"1", multi:false, lines:[{amount:"", cat:"courses"}, {amount:"", cat:"autre"}],
      refundOn:!!src.refund, refundAmt:src.refund ? toInput(src.refund.amount) : "", refundSrc:src.refund?.source || "Mutuelle", refundRec:!!src.refund?.received,
      deduct:!!src.deductible, pro:false, recAll:!!prefill.recAll, warr:false, warrMonths:"24",
      proj:projs.some(p => p.id === src.project) ? src.project : "",
      account:state.accounts.some(a => a.id === src.accountId) ? src.accountId : (exp ? "" : state.accounts[0]?.id || ""),
      tags:(src.tags || []).map(t => "#" + t).join(" "),
      photo:{id:src.photo || null, small:null, removed:null}, photoMsg:"",
      catTouched:!!(exp || src.cat), err:"", busy:false,
    };
  };
  const [f, setF] = useState(init);
  const set = patch => setF(x => ({...x, ...(typeof patch === "function" ? patch(x) : patch)}));
  const err = m => set({err:m});

  const favs = state.settings.favorites || [];
  const curs = useMemo(() => Array.from(new Set([BASE()].concat(CURRENCIES, Object.keys(state.settings.rates || {}), src.currency ? [src.currency] : []))), []);
  const labels = useMemo(() => Array.from(new Set(state.expenses.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(e => e.label).filter(Boolean))).slice(0, 60), []);
  const projs = state.projects.filter(p => !p.archived || p.id === src.project);
  const rec = exp && exp.recurringId && state.recurring.find(r => r.id === exp.recurringId);
  const isNew = !exp, multi = f.multi && isNew;
  const subs = subsOf(f.cat);
  const tagSugg = allTags().filter(t => !parseTags(f.tags).includes(t)).slice(0, 8);
  const photoSrc = f.photo.small || (f.photo.id ? tickets.url(f.photo.id, f.priv) : null);

  const rateHint = () => {
    const a = parseAmount(f.amount), r = parseNum(f.rate);
    return Number.isFinite(a) && r > 0 ? `soit ${fmt(Math.round(a * r))}` : "Taux du jour, mémorisé ensuite.";
  };
  const splitHint = () => {
    if (f.split !== "all" || ms.length < 2) return "";
    const w = currentWeights(), sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    return "Selon les parts du foyer : " + ms.map(m => `${m.name} ${Math.round(w[m.id] / sum * 100)} %`).join(", ");
  };
  const recFreq = () => f.recEvery === "week" ? {freq:"week", every:1} : {freq:"month", every:+f.recEvery || 1};

  const onPhoto = async e => {
    const file = e.target.files && e.target.files[0]; e.target.value = ""; if (!file) return;
    set({photoMsg:"Préparation de la photo…"});
    try { const small = await ticketDataUrl(file); set(x => ({photo:{id:null, small, removed:x.photo.id && !x.photo.removed ? x.photo.id : x.photo.removed}, photoMsg:""})); }
    catch { set({photoMsg:"Cette image n'a pas pu être lue. Essayez une photo JPEG ou PNG."}); }
  };
  const showPhoto = () => {
    if (!photoSrc) return;
    if (!photoSrc.startsWith("data:")) { window.open(photoSrc, "_blank", "noopener"); return; }
    const w = window.open("", "_blank");
    if (w) { w.document.title = "Ticket"; w.document.body.style.margin = "0"; const i = w.document.createElement("img"); i.src = photoSrc; i.style.maxWidth = "100%"; w.document.body.appendChild(i); }
  };
  const useFav = fv => {
    set(x => ({label:fv.label || "", cat:fv.cat ? catOf(fv.cat).id : x.cat, payer:fv.payer && ms.some(m => m.id === fv.payer) ? fv.payer : x.payer,
      split:fv.split || x.split, amount:fv.amount ? toInput(fv.amount) : x.amount, catTouched:true}));
    amountRef.current && amountRef.current.focus();
  };
  const saveFav = async () => {
    const label = f.label.trim();
    if (!label) return err("Donnez un libellé pour créer un raccourci.");
    const amt = parseAmount(f.amount);
    const list2 = favs.filter(x => x.label.toLowerCase() !== label.toLowerCase());
    list2.push({id:uid().slice(0, 8), label, cat:f.cat, payer:f.payer || "", split:f.split || "all", amount:Number.isFinite(amt) && amt > 0 && f.cur === BASE() ? amt : 0});
    try { await store.saveSettings({...state.settings, favorites:list2.slice(-12)}); toast(`Raccourci « ${label} » enregistré`); } catch (e) { handleWriteError(e); }
  };
  const duplicate = () => {
    const c = {...exp}; ["id", "_l", "recurringId", "groupId", "createdAt", "photo", "refund"].forEach(k => delete c[k]);
    c.date = todayStr(); onClose();
    openExpense(null, list, c, null, "Copie de la dépense");
  };
  const del = async () => { onClose(); try { await deleteExpense(exp, list); } catch (e) { handleWriteError(e); } };

  const submit = async () => {
    const cur = f.cur, orig = parseAmount(f.amount);
    if (!Number.isFinite(orig) || orig <= 0) { err("Indiquez un montant supérieur à 0, par exemple 12,50."); amountRef.current?.focus(); return; }
    let rate = 1;
    if (cur !== BASE()) { rate = parseNum(f.rate); if (!(rate > 0)) return err(`Indiquez le taux : combien vaut 1 ${cur} en euros.`); }
    const conv = c => Math.round(c * rate), date = f.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err("Choisissez une date.");
    if (isNew && !f.account) return err("Choisissez un compte.");
    const priv = f.priv && privAllowed(), isRec = f.rec && isNew && !priv && !multi;
    const label = f.label.trim().slice(0, 80), cat = f.cat || "autre";
    const payer = f.payer || "", split = ms.length > 1 ? (f.split || "all") : "all";
    let refund = null;
    if (f.refundOn && !multi) {
      const ra = parseAmount(f.refundAmt);
      if (!Number.isFinite(ra) || ra <= 0) return err("Indiquez le montant du remboursement attendu.");
      refund = {amount:ra, source:f.refundSrc || "Autre", received:f.refundRec, receivedDate:f.refundRec ? (exp?.refund?.receivedDate || todayStr()) : null};
    }
    let lineItems = null;
    if (multi) {
      lineItems = f.lines.map(l => ({amount:parseAmount(l.amount), cat:l.cat})).filter(l => Number.isFinite(l.amount) && l.amount > 0);
      const sum = lineItems.reduce((s, l) => s + l.amount, 0);
      if (lineItems.length < 2) return err("Remplissez au moins deux lignes de répartition.");
      if (sum !== orig) return err(`Les lignes font ${toInput(sum) || 0} ; il faut qu'elles fassent ${toInput(orig)} au total.`);
    }
    if (f.pro && !refund) refund = {amount:conv(orig), source:"Employeur", received:false, receivedDate:null};
    const tags = parseTags(f.tags); if (f.pro && !tags.includes("pro")) tags.push("pro");
    const base = {sub:(!multi && f.sub) || null, tags:tags.length ? tags : null, project:f.proj || null, accountId:f.account || null, label, cat, date,
      note:f.note.trim().slice(0, 300) || null, deductible:f.deduct || null, refund, currency:cur !== BASE() ? cur : null, rate:cur !== BASE() ? rate : null, by:me() || null};
    if (!priv) Object.assign(base, {payer, split});
    const prevShares = exp && (exp.split === "all" || !exp.split) ? exp.shares : null;
    const shares = !priv && split === "all" ? (prevShares || currentWeights()) : null;
    if (isNew && !multi && !priv) {
      const dup = looksDuplicate(conv(orig), date, label);
      if (dup && !confirm(`Une dépense de ${fmt(dup.amount)} « ${dup.label || catOf(dup.cat).name} » existe déjà à cette date. L'ajouter quand même ?`)) return;
    }
    set({busy:true, err:""});
    try {
      let photoId = f.photo.id;
      if (f.photo.small) {
        try { photoId = await tickets.put(f.photo.small, priv); }
        catch { toast("La photo n'a pas pu être enregistrée ; la dépense est enregistrée sans."); }
      }
      base.photo = photoId || null;
      const target = priv ? "privates" : "expenses";
      if (exp) {
        const item = {...exp, ...base, amount:conv(orig), origAmount:cur !== BASE() ? orig : null, shares};
        delete item._l;
        if (list !== target) { const old = item.id; delete item.id; delete item.recurringId; await store.upsert(target, item); await store.remove(list, old); }
        else await store.upsert(target, item);
        const r = item.recurringId && f.recAll && state.recurring.find(x => x.id === item.recurringId);
        if (r && list === target) {
          const tpl = {amount:item.amount, label, cat, payer, split, shares, accountId:base.accountId}, day = Math.min(Number(date.slice(8, 10)), 28);
          await store.upsert("recurring", {...r, ...tpl, day});
          const later = state.expenses.filter(x => x.recurringId === r.id && x.id !== item.id && x.date > item.date);
          for (const x of later) await store.upsert("expenses", {...x, ...tpl, date:r.freq === "week" ? x.date : x.date.slice(0, 8) + pad(day)});
          toast("Dépense fixe modifiée pour les mois suivants");
        } else toast("Dépense modifiée");
      } else if (isRec) {
        const rid = uid(), k = date.slice(0, 7), day = Math.min(Number(date.slice(8, 10)), 28), fq = recFreq();
        await store.upsert("recurring", {id:rid, kind:"expense", amount:conv(orig), label, cat, payer, split, shares, accountId:base.accountId, day, start:k, startDate:date, ...fq, skip:[], by:me() || null, createdAt:Date.now()});
        const eid = fq.freq === "week" ? `rec-${rid}-${date}` : recId(rid, k); written.add(eid);
        await store.upsert("expenses", {...base, id:eid, amount:conv(orig), origAmount:cur !== BASE() ? orig : null, shares, recurringId:rid, createdAt:Date.now()});
        toast("Dépense fixe ajoutée : elle reviendra chaque mois");
      } else if (multi) {
        const gid = uid().slice(0, 8);
        for (const l of lineItems) await store.upsert(target, {...base, cat:l.cat, amount:conv(l.amount), origAmount:cur !== BASE() ? l.amount : null, shares, groupId:gid, createdAt:Date.now()});
        toast(`${lineItems.length} lignes ajoutées`);
      } else {
        await store.upsert(target, {...base, amount:conv(orig), origAmount:cur !== BASE() ? orig : null, shares, createdAt:Date.now()});
        toast("Dépense ajoutée");
      }
      if (f.warr && isNew) {
        const months = Math.max(1, Math.min(240, parseInt(f.warrMonths, 10) || 24));
        store.upsert("warranties", {name:label || catOf(cat).name, store:"", date, months, price:conv(orig), note:"", createdAt:Date.now()}).catch(() => {});
      }
      logAct(exp ? `a modifié « ${label || catOf(cat).name} » (${fmt(conv(orig))})` : `a ajouté « ${label || catOf(cat).name} » (${fmt(conv(orig))})`);
      if (f.photo.removed) tickets.del(f.photo.removed, list === "privates");
      if (cur !== BASE() && state.settings.rates?.[cur] !== rate) store.saveSettings({...state.settings, rates:{...(state.settings.rates || {}), [cur]:rate}}).catch(() => {});
      pref.set("pc.lastCat", cat); if (payer) pref.set("pc.lastPayer", payer);
      const mk = !multi && merchantKey(label);
      if (mk && (state.settings.merchantCats || {})[mk] !== cat) {
        const mc = {...(state.settings.merchantCats || {}), [mk]:cat};
        const keys = Object.keys(mc); if (keys.length > 400) delete mc[keys[0]];
        store.saveSettings({...state.settings, merchantCats:mc}).catch(() => {});
      }
      onClose();
      if (onSaved) await onSaved();
      goToDateMonth(date);
    } catch (e) { handleWriteError(e); set({busy:false}); }
  };

  const lineSum = f.lines.reduce((s, l) => s + (parseAmount(l.amount) || 0), 0), total = parseAmount(f.amount);
  const setLine = (i, patch) => set(x => ({lines:x.lines.map((l, j) => j === i ? {...l, ...patch} : l)}));
  const moreOpen = !!(src.note || src.photo || src.refund || src.deductible || (src.currency && src.currency !== BASE()));

  return (
    <Dialog title={title || (exp ? "Modifier la dépense" : "Nouvelle dépense")} onClose={onClose} onSubmit={submit}>
      {isNew && favs.length > 0 && <div className="field"><div className="chips">{favs.map(fv =>
        <button key={fv.id} type="button" className="chip" onClick={() => useFav(fv)}><Icon name={catOf(fv.cat).ico || "tag"} /> {fv.label}</button>)}</div></div>}
      <div className="field">
        <label htmlFor="fAmount">Montant</label>
        <div className="amtrow">
          <input ref={amountRef} className="inp amount" id="fAmount" inputMode="decimal" autoComplete="off" placeholder="0,00" autoFocus value={f.amount} onChange={e => set({amount:e.target.value})} />
          <select className="inp" aria-label="Devise" value={f.cur} onChange={e => { const c = e.target.value, r = state.settings.rates?.[c]; set({cur:c, rate:r ? String(r).replace(".", ",") : ""}); }}>
            {curs.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {f.cur !== BASE() && <div>
          <div className="erow mt8"><span className="cn small">1 {f.cur} =</span><input className="inp r w" inputMode="decimal" aria-label="Taux de change en euros" value={f.rate} onChange={e => set({rate:e.target.value})} /><span>€</span></div>
          <p className="hint">{rateHint()}</p>
        </div>}
      </div>
      <p className="err" role="alert">{f.err}</p>
      <div className="field">
        <label htmlFor="fLabel">Libellé</label>
        <input className="inp" id="fLabel" maxLength={80} placeholder="ex. Courses Leclerc" list="labelsList" value={f.label}
          onChange={e => { const v = e.target.value; set(x => { const g = !x.catTouched && !x.multi ? guessCat(v) : "autre"; return {label:v, ...(g !== "autre" ? {cat:g, sub:""} : {})}; }); }} />
        <datalist id="labelsList">{labels.map(l => <option key={l} value={l} />)}</datalist>
      </div>
      {!multi && <Field label="Catégorie"><Chips label="Catégorie" value={f.cat} onChange={v => set({cat:v, sub:"", catTouched:true})}
        items={allCats().map(c => ({id:c.id, label:<><Icon name={c.ico || "tag"} /> {c.name}</>}))} /></Field>}
      {!multi && subs.length > 0 && <Field label="Sous-catégorie"><Chips value={subs.includes(f.sub) ? f.sub : ""} onChange={v => set({sub:v})}
        items={[{id:"", label:"Aucune"}].concat(subs.map(s => ({id:s, label:s})))} /></Field>}
      {privAllowed() && <div className="field"><Check checked={f.priv} onChange={v => set({priv:v})}>Dépense perso (privée)</Check></div>}
      {!f.priv && <Field label="Payé par"><Chips label="Payé par" value={f.payer} onChange={v => set({payer:v})}
        items={ms.map(m => ({id:m.id, label:m.name})).concat(potOn ? [{id:"pot", label:<><Icon name="piggy-bank" /> Cagnotte</>}] : [])} /></Field>}
      {!f.priv && ms.length >= 2 && <Field label="Pour qui"><Chips label="Pour qui" value={f.split} onChange={v => set({split:v})}
        items={[{id:"all", label:"Tout le foyer"}].concat(ms.map(m => ({id:m.id, label:"Seulement " + m.name})))} /><p className="hint">{splitHint()}</p></Field>}
      <Field label="Date" htmlFor="fDate"><input className="inp" id="fDate" type="date" value={f.date} onChange={e => set({date:e.target.value})} /></Field>
      <Field label="Étiquettes" htmlFor="fTags">
        <input className="inp" id="fTags" maxLength={80} placeholder="ex. #noël #voiture" autoComplete="off" value={f.tags} onChange={e => set({tags:e.target.value})} />
        {tagSugg.length > 0 && <div className="chips mt8">{tagSugg.map(t => <button key={t} type="button" className="chip" onClick={() => set(x => ({tags:(x.tags.trim() ? x.tags.trim() + " " : "") + "#" + t}))}>#{t}</button>)}</div>}
      </Field>
      {projs.length > 0 && <Field label="Projet" htmlFor="fProj"><select className="inp" id="fProj" value={f.proj} onChange={e => set({proj:e.target.value})}>
        <option value="">Aucun</option>{projs.map(p => <option key={p.id} value={p.id}>{p.name}{p.exclude ? " (hors budget)" : ""}</option>)}</select></Field>}
      {state.accounts.length > 0 && <Field label="Compte" htmlFor="fAccount"><select className="inp" id="fAccount" value={f.account} onChange={e => set({account:e.target.value})}>
        <option value="">{exp ? "Aucun compte" : "Choisir un compte…"}</option>{state.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
      {rec && <div className="field"><Check checked={f.recAll} onChange={v => set({recAll:v})}>Appliquer aussi aux mois suivants</Check></div>}

      <details className="more" open={moreOpen || undefined}>
        <summary>Plus d'options</summary>
        <Field label="Commentaire" htmlFor="fNote"><textarea className="inp" id="fNote" maxLength={300} placeholder="ex. pour l'anniversaire de Mamie" value={f.note} onChange={e => set({note:e.target.value})} /></Field>
        <Field label="Photo du ticket">
          <div className="photo">
            {photoSrc && <img src={photoSrc} alt="Ticket" onClick={showPhoto} />}
            <label className="btn sm ghost"><Icon name="camera" /><span>{photoSrc ? "Changer" : "Ajouter une photo"}</span>
              <input type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} /></label>
            {photoSrc && <button type="button" className="x" aria-label="Retirer la photo" onClick={() => set(x => ({photo:{id:null, small:null, removed:x.photo.id || x.photo.removed}, photoMsg:""}))}><Icon name="x" /></button>}
          </div>
          <p className="ai-msg mt6">{f.photoMsg}</p>
        </Field>
        {isNew && !f.priv && !multi && <div className="field">
          <Check checked={f.rec} onChange={v => set({rec:v})}>Répéter</Check>
          {f.rec && <select className="inp" aria-label="Fréquence" value={f.recEvery} onChange={e => set({recEvery:e.target.value})}>
            <option value="week">Chaque semaine</option><option value="1">Chaque mois</option><option value="2">Tous les 2 mois</option><option value="3">Tous les 3 mois</option><option value="6">Tous les 6 mois</option><option value="12">Chaque année</option>
          </select>}
        </div>}
        {isNew && !f.rec && <div className="field">
          <Check checked={f.multi} onChange={v => set({multi:v})}>Répartir le ticket sur plusieurs catégories</Check>
          {multi && <div className="sub lines">
            {f.lines.map((l, i) => <div className="erow" key={i}>
              <input className="inp r w" inputMode="decimal" value={l.amount} placeholder="0,00" aria-label={`Montant ligne ${i + 1}`} onChange={e => setLine(i, {amount:e.target.value})} />
              <select aria-label={`Catégorie ligne ${i + 1}`} value={l.cat} onChange={e => setLine(i, {cat:e.target.value})}>{allCats().map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <button type="button" className="x" aria-label={`Retirer la ligne ${i + 1}`} disabled={f.lines.length < 3} onClick={() => set(x => ({lines:x.lines.filter((_, j) => j !== i)}))}><Icon name="x" /></button>
            </div>)}
            <div className="erow"><button type="button" className="linkbtn" onClick={() => set(x => ({lines:x.lines.concat({amount:"", cat:"autre"})}))}>+ Ajouter une ligne</button>
              <span className={"cn small jend " + (Number.isFinite(total) && lineSum !== total ? "over" : "muted")}>{Number.isFinite(total) ? (lineSum === total ? "Tout est réparti" : `reste à répartir : ${toInput(total - lineSum) || "0"}`) : ""}</span></div>
          </div>}
        </div>}
        {!multi && <div className="field">
          <Check checked={f.refundOn} onChange={v => set(x => ({refundOn:v, refundAmt:v && !x.refundAmt ? x.amount : x.refundAmt}))}>Remboursement attendu</Check>
          {f.refundOn && <div className="sub">
            <div className="erow"><span className="cn small">Montant attendu</span><input className="inp r w" inputMode="decimal" value={f.refundAmt} onChange={e => set({refundAmt:e.target.value})} aria-label="Montant attendu" /><span>€</span></div>
            <Chips value={f.refundSrc} onChange={v => set({refundSrc:v})} items={REFUND_SOURCES.map(s => ({id:s, label:s}))} label="Source du remboursement" />
            <Check className="check mt10" checked={f.refundRec} onChange={v => set({refundRec:v})}>Déjà reçu</Check>
          </div>}
        </div>}
        {isNew && <div className="field">
          <Check checked={f.warr} onChange={v => set({warr:v})}>Suivre la garantie de cet achat</Check>
          {f.warr && <div className="sub"><div className="erow"><span className="cn small">Durée de garantie</span><input className="inp r w" inputMode="numeric" value={f.warrMonths} onChange={e => set({warrMonths:e.target.value})} aria-label="Durée en mois" /><span>mois</span></div></div>}
        </div>}
        <div className="field"><Check checked={f.pro} onChange={v => set({pro:v})}>Note de frais (employeur)</Check></div>
        <div className="field"><Check checked={f.deduct} onChange={v => set({deduct:v})}>Déductible des impôts</Check></div>
      </details>

      <div className="actions">
        {exp && <button type="button" className="btn danger" onClick={del}>Supprimer</button>}
        {exp && <button type="button" className="btn sm ghost" onClick={duplicate}><Icon name="copy" />Dupliquer</button>}
        {isNew && <button type="button" className="btn sm ghost" onClick={saveFav}><Icon name="star" />Raccourci</button>}
        <button type="submit" className="btn push" disabled={f.busy}>Enregistrer</button>
      </div>
    </Dialog>
  );
}
