/* Réglages du foyer (membres, catégories, budgets, devises, cagnotte, enveloppes…) et préférences de l'appareil
   (verrou, taille du texte, contraste, couleur, thème, onglets et encarts affichés). Portage de setDlg. */
import { useState } from "react";
import { Dialog, openDialog, registerDialog } from "../ui/Dialog.jsx";
import { Icon } from "../ui/icons.jsx";
import { Chips, Check, Field, CatIco } from "../ui/bits.jsx";
import { state, pref, bump, BASE_CATS, EXTRA_COLORS, MEMBER_COLORS, CAT_ICONS, CURRENCIES, MAIN_CURRENCIES, DEFAULT_SETTINGS, LISTS,
  fmt, toInput, parseAmount, parseNum, uid, me, keyOf, todayStr, catOf, safeColor, safeImg } from "../lib/core.js";
import { SV, store, toast, handleWriteError, uploadImage } from "../data/store.js";
import { logAct, PANELS, panelCfg } from "../lib/domain.js";
import { squareThumb } from "../lib/image.js";
import { saveFile } from "../lib/files.js";
import { TABS, tabCfg } from "../Shell.jsx";
import { AccountSection } from "./Account.jsx";

/* ---------- Préférences de l'appareil (appliquées immédiatement) ---------- */
export function applyTheme(t){ if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme"); }
export function applyA11y(){
  document.documentElement.style.fontSize = pref.get("pc.fsize", "100") + "%";
  if (pref.get("pc.contrast", "0") === "1") document.documentElement.setAttribute("data-contrast", "high"); else document.documentElement.removeAttribute("data-contrast");
}
export function applyAccent(){ const a = pref.get("pc.accent", "vert"); if (a === "vert") document.documentElement.removeAttribute("data-accent"); else document.documentElement.setAttribute("data-accent", a); }
export async function hashPin(p){
  try { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pot-commun:" + p)); return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, "0")).join(""); }
  catch { let h = 0; for (const c of "pot-commun:" + p) h = (h * 31 + c.charCodeAt(0)) | 0; return "w" + h; }
}

/* ---------- Sauvegarde / restauration (fichier JSON) ---------- */
export async function backup(){
  const data = {app:"dafeuille", version:4, exportedAt:new Date().toISOString(), settings:state.settings, stats:state.stats};
  LISTS.forEach(l => data[l] = state[l]);
  const ok = await saveFile(`dafeuille-sauvegarde-${todayStr()}.json`, JSON.stringify(data, null, 1), "application/json");
  if (ok) { pref.set("pc.lastBackup", String(Date.now())); bump(); }
  return ok;
}
async function restore(file, say){
  let data; try { data = JSON.parse(await file.text()); } catch { say("Ce fichier n'est pas une sauvegarde valide."); return; }
  if (!data || !["dafeuille", "pot-commun"].includes(data.app)) { say("Ce fichier ne vient pas de DAFeuille."); return; }
  const n = LISTS.reduce((s, l) => s + (Array.isArray(data[l]) ? data[l].length : 0), 0);
  if (!confirm(`Restaurer ${n} éléments du ${new Date(data.exportedAt).toLocaleDateString("fr-FR")} ? Ils s'ajoutent aux données actuelles (les éléments identiques sont remplacés).`)) return;
  let done = 0;
  try {
    for (const l of LISTS) {
      if (!Array.isArray(data[l]) || (l === "privates" && !state.uid)) continue;
      for (const item of data[l]) { if (item && typeof item === "object") { await store.upsert(l, item); if (++done % 20 === 0) say(`Restauration… ${done} / ${n}`); } }
    }
    if (data.settings) await store.saveSettings({...DEFAULT_SETTINGS, ...data.settings});
    if (data.stats) await store.saveStats(data.stats);
    say(`${done} éléments restaurés.`); toast("Sauvegarde restaurée");
  } catch (e) { handleWriteError(e); say(`${done} éléments restaurés avant l'erreur.`); }
}

/* ---------- Onglets et encarts affichés ---------- */
function setMode(mode){
  pref.set("pc.mode", mode);
  if (mode === "simple") {
    pref.set("pc.tabs2", JSON.stringify(TABS.map(t => ({id:t.id, on:["budget", "analyse", "courses"].includes(t.id)}))));
    pref.set("pc.panels", JSON.stringify(PANELS.map(([id]) => ({id, on:["today", "week", "incomes", "balances", "journal"].includes(id)}))));
  } else if (mode === "complet") { pref.set("pc.tabs2", ""); pref.set("pc.panels", ""); }
  bump();
}
function CfgList({ kind, list, names, prefKey }){
  const save = l => { pref.set(prefKey, JSON.stringify(l)); pref.set("pc.mode", "perso"); bump(); };
  const move = (i, d) => { const l = list.slice(); [l[i + d], l[i]] = [l[i], l[i + d]]; save(l); };
  return <ul className="cfg">{list.map((x, i) => <li key={x.id}><label><input type="checkbox" checked={x.on || x.id === "budget"} disabled={x.id === "budget"}
      onChange={e => save(list.map(y => y.id === x.id ? {...y, on:e.target.checked} : y))} /> {names(x.id)}</label>
    <button type="button" aria-label="Monter" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="arrow-up" /></button>
    <button type="button" aria-label="Descendre" disabled={i === list.length - 1} onClick={() => move(i, 1)}><Icon name="arrow-down" /></button></li>)}</ul>;
}

const sub2str = (c, sc, sb) => (sc[c.id] || []).map(n => n + (sb[c.id + "/" + n] ? "=" + toInput(sb[c.id + "/" + n]) : "")).join(", ");

function SettingsDialog({ onClose }){
  const s = state.settings;
  const [d, setD] = useState(() => {
    const members = (s.members || []).map(m => ({...m}));
    if (!members.length) members.push({id:uid(), name:"", weight:100});
    members.forEach((m, i) => { if (!(m.weight > 0)) m.weight = Math.round(100 / members.length * 10) / 10; if (!m.color) m.color = MEMBER_COLORS[i % MEMBER_COLORS.length]; });
    const sc = s.subCats || {}, sb = s.subBudgets || {};
    return {members, customCats:(s.customCats || []).map(c => ({...c})), me:me(),
      catBudgets:Object.fromEntries(Object.entries(s.catBudgets || {}).map(([k, v]) => [k, toInput(v)])),
      weekBudgets:Object.fromEntries(Object.entries(s.weekBudgets || {}).map(([k, v]) => [k, toInput(v)])),
      potMonthly:Object.fromEntries(Object.entries(s.pot?.monthly || {}).map(([k, v]) => [k, toInput(v)])),
      favorites:(s.favorites || []).map(f => ({...f})), rates:Object.fromEntries(Object.entries(s.rates || {}).map(([k, v]) => [k, String(v).replace(".", ",")])),
      subs:Object.fromEntries(BASE_CATS.concat(s.customCats || []).map(c => [c.id, sub2str(c, sc, sb)])),
      house:s.houseName || "", currency:s.currency || "EUR", monthStart:String(s.monthStart || 1), budget:toInput(s.budget), alert:String(s.alertPct || 80),
      pot:!!s.pot?.enabled, env:!!s.envelopes, zero:!!s.zero?.enabled, zeroSave:toInput(s.zero?.save), round:!!s.roundup?.enabled, roundGoal:s.roundup?.goalId || state.goals[0]?.id || "",
      newCat:"", newIco:"tag", err:""};
  });
  const set = p => setD(x => ({...x, ...(typeof p === "function" ? p(x) : p)}));
  const setMember = (i, patch) => set(x => ({members:x.members.map((m, j) => j === i ? {...m, ...patch} : m)}));
  const equal = ms => ms.map(m => ({...m, weight:Math.round(100 / ms.length * 10) / 10}));
  const wsum = d.members.reduce((a, m) => a + (parseNum(m.weight) || 0), 0);
  const allDraft = BASE_CATS.concat(d.customCats.map(c => ({...c, custom:true})));
  // préférences de l'appareil (effet immédiat, comme l'original)
  const [dev, setDev] = useState(() => ({theme:pref.get("pc.theme", "auto"), fsize:pref.get("pc.fsize", "100"), contrast:pref.get("pc.contrast", "0") === "1", haptic:pref.get("pc.haptic", "1") === "1",
    accent:pref.get("pc.accent", "vert"), mode:pref.get("pc.mode", "complet"), pinNew:"", pinHint:pref.get("pc.pin", "") ? "Code actif sur cet appareil." : "", hasPin:!!pref.get("pc.pin", ""), backupMsg:""}));
  const setDv = p => setDev(x => ({...x, ...p}));

  const memberPhoto = async (i, file) => { try { setMember(i, {photo:await squareThumb(file)}); } catch { toast("Image illisible."); } };
  const addCat = () => {
    const name = d.newCat.trim().slice(0, 24); if (!name) return;
    if (allDraft.some(c => c.name.toLowerCase() === name.toLowerCase())) return set({err:"Cette catégorie existe déjà."});
    set(x => ({customCats:x.customCats.concat({id:"c-" + uid().slice(0, 8), name, ico:x.newIco || "tag", color:EXTRA_COLORS[x.customCats.length % EXTRA_COLORS.length]}), newCat:"", newIco:"tag", err:""}));
  };
  const rmCat = id => { if (!confirm("Supprimer cette catégorie ? Ses dépenses s'afficheront dans « Autre ».")) return; set(x => { const cb = {...x.catBudgets}; delete cb[id]; return {customCats:x.customCats.filter(c => c.id !== id), catBudgets:cb}; }); };
  const setPin = async () => {
    const p = dev.pinNew.trim();
    if (!/^\d{4,6}$/.test(p)) return setDv({pinHint:"Le code doit faire 4 à 6 chiffres."});
    pref.set("pc.pin", await hashPin(p)); pref.set("pc.pinlen", String(p.length)); setDv({pinNew:"", hasPin:true, pinHint:"Code actif sur cet appareil."}); toast("Code défini pour cet appareil");
  };

  const submit = async () => {
    const err = m => set({err:m});
    const ms = d.members.map(m => ({id:m.id, name:String(m.name).trim().slice(0, 30), weight:parseNum(m.weight) || 0, color:m.color, photo:m.photo || null})).filter(m => m.name);
    if (!ms.length) return err("Ajoutez au moins un membre avec un prénom.");
    if (ms.some(m => m.weight < 0)) return err("Les parts doivent être positives.");
    const sum = ms.reduce((a, m) => a + m.weight, 0);
    if (sum <= 0) ms.forEach(m => m.weight = Math.round(1000 / ms.length) / 10); else ms.forEach(m => m.weight = Math.round(m.weight / sum * 1000) / 10);
    const budget = d.budget.trim() ? parseAmount(d.budget) : 0;
    if (!Number.isFinite(budget) || budget < 0) return err("Le budget total doit être un montant, par exemple 1800.");
    const catBudgets = {};
    for (const [id, v] of Object.entries(d.catBudgets)) {
      if (!String(v).trim()) continue; const c = parseAmount(v);
      if (!Number.isFinite(c) || c < 0) return err(`Budget invalide pour « ${(allDraft.find(x => x.id === id) || {name:id}).name} ».`);
      if (c > 0) catBudgets[id] = c;
    }
    const weekBudgets = {};
    for (const [id, v] of Object.entries(d.weekBudgets)) { if (!String(v).trim()) continue; const c = parseAmount(v); if (!Number.isFinite(c) || c < 0) return err("Budget par semaine invalide."); if (c > 0) weekBudgets[id] = c; }
    const potMonthly = {};
    for (const [id, v] of Object.entries(d.potMonthly)) { if (!String(v).trim()) continue; const c = parseAmount(v); if (!Number.isFinite(c) || c < 0) return err("Versement de cagnotte invalide."); if (c > 0) potMonthly[id] = c; }
    const oldPot = s.pot || {}, pot = {enabled:d.pot, monthly:potMonthly, start:d.pot ? (oldPot.enabled && oldPot.start ? oldPot.start : keyOf(new Date())) : null};
    const rates = {};
    for (const [c, v] of Object.entries(d.rates)) { if (String(v ?? "").trim() === "") continue; const r = parseNum(v); if (!(r > 0)) return err(`Taux invalide pour ${c}.`); rates[c] = r; }
    const alertPct = Math.min(100, Math.max(10, parseInt(d.alert, 10) || 80));
    const subCats = {}, subBudgets = {};
    Object.entries(d.subs).forEach(([cid, str]) => {
      const names = [];
      String(str).split(",").map(x => x.trim()).filter(Boolean).slice(0, 12).forEach(p => {
        const [n, b] = p.split("=").map(x => x.trim()); if (!n || names.includes(n)) return;
        names.push(n.slice(0, 24)); const v = b ? parseAmount(b) : 0; if (v > 0) subBudgets[cid + "/" + n.slice(0, 24)] = v;
      });
      if (names.length) subCats[cid] = names;
    });
    const zs = d.zeroSave.trim() ? parseAmount(d.zeroSave) : 0, oldR = s.roundup || {}, rOn = d.round && !!d.roundGoal;
    if (d.me && ms.some(m => m.id === d.me)) pref.set("pc.me", d.me);
    try {
      for (const m of ms) if (m.photo && m.photo.startsWith("data:")) { try { m.photo = await uploadImage(m.photo); } catch {} }
      const envStart = d.env ? (s.envelopes && s.envStart ? s.envStart : keyOf(new Date())) : null;
      await store.saveSettings({...s, members:ms, budget, catBudgets, customCats:d.customCats, favorites:d.favorites, rates, alertPct, envelopes:d.env, envStart, weekBudgets, pot, onboarded:true,
        houseName:d.house.trim().slice(0, 30), currency:d.currency || "EUR", monthStart:+d.monthStart || 1, subCats, subBudgets,
        zero:{enabled:d.zero, save:Number.isFinite(zs) && zs > 0 ? zs : 0},
        roundup:{enabled:rOn, goalId:d.roundGoal || null, start:rOn ? (oldR.enabled && oldR.start ? oldR.start : todayStr()) : null, sweptAt:rOn ? (oldR.enabled ? oldR.sweptAt || Date.now() : Date.now()) : null}});
      logAct("a modifié les réglages du foyer");
      onClose(); toast("Réglages enregistrés");
    } catch (e) { handleWriteError(e); }
  };

  return <Dialog title="Réglages du foyer" onClose={onClose} onSubmit={submit}>
    {SV.hh && <AccountSection />}
    <div className="field"><span className="lab">Membres et parts (%)</span>
      <div>{d.members.map((m, i) => { const ph = safeImg(m.photo);
        return <div className="erow" key={m.id}>
          <button type="button" className="swatch" style={{background:safeColor(m.color) || MEMBER_COLORS[i % MEMBER_COLORS.length]}} aria-label={`Changer la couleur de ${m.name || "ce membre"}`}
            onClick={() => { const cur = m.color || MEMBER_COLORS[i % MEMBER_COLORS.length]; setMember(i, {color:MEMBER_COLORS[(MEMBER_COLORS.indexOf(cur) + 1) % MEMBER_COLORS.length]}); }} />
          <label className="swatch ph" title="Photo (appui long pour retirer)" style={ph ? {backgroundImage:`url('${ph}')`} : undefined} onContextMenu={e => { e.preventDefault(); setMember(i, {photo:null}); }}>
            {ph ? null : <Icon name="camera" />}<input type="file" accept="image/*" hidden onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) memberPhoto(i, f); }} /></label>
          <input className="inp" value={m.name} maxLength={30} placeholder="Prénom" aria-label={`Nom du membre ${i + 1}`} onChange={e => setMember(i, {name:e.target.value})} />
          <input className="inp r w" value={m.weight ?? ""} inputMode="decimal" aria-label={`Part de ${m.name || "ce membre"} en %`} onChange={e => setMember(i, {weight:e.target.value})} />
          <button type="button" className="iconbtn" aria-label={`Retirer ${m.name || "ce membre"}`} disabled={d.members.length < 2} onClick={() => set(x => ({members:equal(x.members.filter((_, j) => j !== i))}))}><Icon name="x" /></button></div>; })}</div>
      <button type="button" className="linkbtn" onClick={() => { if (d.members.length < 10) set(x => ({members:equal(x.members.concat({id:uid(), name:"", weight:0, color:MEMBER_COLORS[x.members.length % MEMBER_COLORS.length]}))})); }}>+ Ajouter un membre</button>
      <p className="hint">{d.members.length < 2 ? "" : Math.round(wsum) === 100 ? "Total : 100 %" : `Total : ${Math.round(wsum)} % (ramené à 100 %)`}</p>
    </div>
    <Field label="Sur cet appareil, je suis"><Chips label="Sur cet appareil, je suis" value={d.me} onChange={v => set({me:v})} items={d.members.map(m => ({id:m.id, label:m.name || "…"}))} /></Field>
    <hr className="sep" />
    <Field label="Nom du foyer" htmlFor="fHouse"><input className="inp" id="fHouse" maxLength={30} placeholder="DAFeuille" value={d.house} onChange={e => set({house:e.target.value})} /></Field>
    <div className="erow"><div className="f1"><label className="small muted" htmlFor="fCurrency">Devise</label><select className="inp" id="fCurrency" value={d.currency} onChange={e => set({currency:e.target.value})}>{MAIN_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
      <div className="f1"><label className="small muted" htmlFor="fMonthStart">Le mois commence</label><select className="inp" id="fMonthStart" value={d.monthStart} onChange={e => set({monthStart:e.target.value})}>
        {Array.from({length:28}, (_, i) => <option key={i} value={String(i + 1)}>{i === 0 ? "1er (mois calendaire)" : "le " + (i + 1)}</option>)}</select></div></div>
    <hr className="sep" />
    <Field label="Budget mensuel total (€)" htmlFor="fBudget"><input className="inp" id="fBudget" inputMode="decimal" placeholder="laisser vide si aucun" value={d.budget} onChange={e => set({budget:e.target.value})} /></Field>
    <Field label="Budgets par catégorie (mois · semaine)"><div>{allDraft.map(c => <div className="erow" key={c.id}><span className="cn"><CatIco c={c} /> {c.name}</span>
      <input className="inp r w" inputMode="decimal" placeholder="/mois" aria-label={`Budget mensuel ${c.name}`} value={d.catBudgets[c.id] ?? ""} onChange={e => set(x => ({catBudgets:{...x.catBudgets, [c.id]:e.target.value}}))} />
      <input className="inp r w" inputMode="decimal" placeholder="/sem." aria-label={`Budget par semaine ${c.name}`} value={d.weekBudgets[c.id] ?? ""} onChange={e => set(x => ({weekBudgets:{...x.weekBudgets, [c.id]:e.target.value}}))} />
      {c.custom ? <button type="button" className="iconbtn" aria-label={`Supprimer la catégorie ${c.name}`} onClick={() => rmCat(c.id)}><Icon name="x" /></button> : <span className="sp42" />}</div>)}</div></Field>
    <div className="field"><span className="lab">Nouvelle catégorie</span>
      <Field label="Sous-catégories"><div>{allDraft.map(c => <div className="erow" key={c.id}><span className="cn subcn"><CatIco c={c} /> {c.name}</span>
        <input className="inp" placeholder="ex. Bio, Drive=120" aria-label={`Sous-catégories ${c.name}`} value={d.subs[c.id] || ""} onChange={e => set(x => ({subs:{...x.subs, [c.id]:e.target.value}}))} /></div>)}</div></Field>
      <div className="erow"><input className="inp" maxLength={24} placeholder="ex. Animaux" aria-label="Nom de la catégorie" value={d.newCat} onChange={e => set({newCat:e.target.value})} />
        <button type="button" className="btn sm ghost" onClick={addCat}>Ajouter</button></div>
      <Chips className="ipick" label="Icône de la catégorie" value={d.newIco} onChange={v => set({newIco:v})} items={CAT_ICONS.map(n => ({id:n, label:<span title={n}><Icon name={n} /></span>}))} />
    </div>
    <Field label="Alerte budget à partir de"><div className="erow"><input className="inp r w" inputMode="numeric" aria-label="Seuil d'alerte en pourcentage" value={d.alert} onChange={e => set({alert:e.target.value})} /><span className="cn">% du budget</span></div></Field>
    <hr className="sep" />
    <Field label="Raccourcis"><div>{d.favorites.length ? d.favorites.map((f, i) => <div className="erow" key={f.id || i}><span className="cn"><CatIco c={catOf(f.cat)} /> {f.label}{f.amount ? ` · ${fmt(f.amount)}` : ""}</span>
      <button type="button" className="iconbtn" aria-label={`Supprimer le raccourci ${f.label}`} onClick={() => set(x => ({favorites:x.favorites.filter((_, j) => j !== i)}))}><Icon name="x" /></button></div>) : <p className="hint m0">Aucun raccourci.</p>}</div></Field>
    <Field label="Devises et taux (1 devise = x €)"><div>{CURRENCIES.filter(c => c !== "EUR").map(c => <div className="erow" key={c}><span className="cn">1 {c} =</span>
      <input className="inp r w" inputMode="decimal" placeholder="—" aria-label={`Taux ${c} en euros`} value={d.rates[c] ?? ""} onChange={e => set(x => ({rates:{...x.rates, [c]:e.target.value}}))} /><span>€</span></div>)}</div></Field>
    <hr className="sep" />
    <div className="field"><Check checked={d.pot} onChange={v => set({pot:v})}>Utiliser une cagnotte commune</Check>
      {d.pot && <div className="sub">{d.members.filter(m => String(m.name).trim()).map(m => <div className="erow" key={m.id}><span className="cn">{m.name}</span>
        <input className="inp r w" inputMode="decimal" placeholder="€/mois" aria-label={`Versement mensuel de ${m.name}`} value={d.potMonthly[m.id] ?? ""} onChange={e => set(x => ({potMonthly:{...x.potMonthly, [m.id]:e.target.value}}))} /></div>)}</div>}</div>
    <div className="field"><Check checked={d.env} onChange={v => set({env:v})}>Reporter les restes de budget au mois suivant</Check></div>
    <hr className="sep" />
    <div className="field"><button type="button" className="btn ghost" onClick={() => { onClose(); openDialog("import"); }}><Icon name="upload" />Importer un relevé bancaire</button></div>
    <div className="field"><span className="lab">Sauvegarde</span>
      <div className="actions m0"><button type="button" className="btn sm ghost" onClick={async () => { if (await backup()) setDv({backupMsg:"Sauvegarde téléchargée."}); }}><Icon name="download" />Sauvegarder</button>
        <label className="btn sm ghost"><Icon name="upload" />Restaurer<input type="file" accept=".json,application/json" hidden onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) restore(f, m => setDv({backupMsg:m})); }} /></label></div>
      <p className="hint">{dev.backupMsg}</p></div>
    <hr className="sep" />
    <div className="field"><span className="lab">Code de verrouillage (sur cet appareil)</span>
      <div className="erow"><input className="inp" inputMode="numeric" maxLength={6} placeholder="4 à 6 chiffres" autoComplete="off" aria-label="Nouveau code" value={dev.pinNew} onChange={e => setDv({pinNew:e.target.value})} />
        <button type="button" className="btn sm ghost" onClick={setPin}>{dev.hasPin ? "Changer" : "Définir"}</button>
        {dev.hasPin && <button type="button" className="btn sm ghost" onClick={() => { pref.set("pc.pin", ""); setDv({hasPin:false, pinHint:""}); toast("Code retiré"); }}>Retirer</button>}</div>
      <p className="hint">{dev.pinHint}</p></div>
    <Field label="Taille du texte"><Chips value={dev.fsize} onChange={v => { pref.set("pc.fsize", v); applyA11y(); setDv({fsize:v}); }} items={[{id:"100", label:"Normale"}, {id:"112.5", label:"Grande"}, {id:"125", label:"Très grande"}]} label="Taille du texte" /></Field>
    <div className="field"><Check checked={dev.contrast} onChange={v => { pref.set("pc.contrast", v ? "1" : "0"); applyA11y(); setDv({contrast:v}); }}>Contraste renforcé</Check></div>
    <div className="field"><Check checked={dev.haptic} onChange={v => { pref.set("pc.haptic", v ? "1" : "0"); setDv({haptic:v}); }}>Vibrations</Check></div>
    <Field label="Couleur de l'app (sur cet appareil)"><Chips value={dev.accent} onChange={v => { pref.set("pc.accent", v); applyAccent(); setDv({accent:v}); }} label="Couleur de l'app"
      items={[["vert", "Vert", "#0E6B5C"], ["bleu", "Bleu", "#2459A8"], ["prune", "Prune", "#7B2D6B"], ["orange", "Orange", "#B4531A"], ["ardoise", "Ardoise", "#3E4C59"]].map(([id, l, c]) => ({id, label:<><span className="accent-dot" style={{background:c}} /> {l}</>}))} /></Field>
    <div className="field"><button type="button" className="btn ghost" onClick={() => { onClose(); openDialog("tour"); }}><Icon name="compass" />Visite guidée</button></div>
    <hr className="sep" />
    <Field label="Affichage (sur cet appareil)"><Chips value={dev.mode} label="Affichage" onChange={v => { setDv({mode:v}); if (v !== "perso") setMode(v); else pref.set("pc.mode", "perso"); }}
      items={[{id:"simple", label:"Simple"}, {id:"complet", label:"Complet"}, {id:"perso", label:"Personnalisé"}]} /></Field>
    <Field label="Onglets affichés et ordre"><CfgList kind="t" list={tabCfg()} prefKey="pc.tabs2" names={id => TABS.find(t => t.id === id).label} /></Field>
    <Field label="Encarts de l'onglet Budget"><CfgList kind="p" list={panelCfg()} prefKey="pc.panels" names={id => PANELS.find(p => p[0] === id)[1]} /></Field>
    <hr className="sep" />
    <div className="field"><Check checked={d.zero} onChange={v => set({zero:v})}>Budget à zéro</Check>
      {d.zero && <div className="sub"><div className="erow"><span className="cn">Épargne prévue par mois</span><input className="inp r w" inputMode="decimal" placeholder="€" aria-label="Épargne prévue par mois" value={d.zeroSave} onChange={e => set({zeroSave:e.target.value})} /></div></div>}</div>
    <div className="field"><Check checked={d.round} onChange={v => set({round:v})}>Arrondi épargne</Check>
      {d.round && <div className="sub"><div className="erow"><span className="cn">Objectif</span><select aria-label="Objectif" value={d.roundGoal} onChange={e => set({roundGoal:e.target.value})}>
        {state.goals.length ? state.goals.map(g => <option key={g.id} value={g.id}>{g.name}</option>) : <option value="">Créez d'abord un objectif (onglet Projets)</option>}</select></div></div>}</div>
    <hr className="sep" />
    <div className="field"><div className="actions m0"><button type="button" className="btn sm ghost" onClick={() => { onClose(); openDialog("trash"); }}><Icon name="trash-2" />Corbeille</button>
      <button type="button" className="btn sm ghost" onClick={() => { onClose(); openDialog("check"); }}><Icon name="list-checks" />Vérifier les données</button></div></div>
    <Field label="Thème (sur cet appareil)"><Chips value={dev.theme} label="Thème" onChange={v => { pref.set("pc.theme", v); applyTheme(v); setDv({theme:v}); }} items={[{id:"auto", label:"Automatique"}, {id:"light", label:"Clair"}, {id:"dark", label:"Sombre"}]} /></Field>
    <p className="err" role="alert">{d.err}</p>
    <div className="actions"><button type="submit" className="btn push">Enregistrer les réglages</button></div>
  </Dialog>;
}
registerDialog("settings", SettingsDialog);
export const openSettings = () => openDialog("settings");
