/* Onglet Courses : liste par rayon, menus de la semaine, placards et congélateur. */
import { useRef, useState } from "react";
import { Icon } from "../ui/icons.jsx";
import { MAvatar, Chips, Check, Field } from "../ui/bits.jsx";
import { Columns } from "../ui/Columns.jsx";
import { Dialog, openDialog, registerDialog } from "../ui/Dialog.jsx";
import { useStore } from "../lib/hooks.js";
import { state, pref, bump, todayStr, fmtDay, dstr, daysBetween, norm, me, memberName } from "../lib/core.js";
import { store, toast, handleWriteError } from "../data/store.js";
import { removeWithUndo, weekStart } from "../lib/domain.js";
import { AISLES, AISLE_ICONS, aisleOf } from "../lib/aisles.js";
import { savePdf } from "../lib/files.js";
import { openExpense } from "../dialogs/Money.jsx";

/** Ajoute des articles à la liste (sans doublon parmi ceux qui restent à acheter) ; renvoie le nombre ajouté */
export async function addToShop(names){
  const have = new Set(state.shop.filter(x => !x.done).map(x => norm(x.name).trim())); let n = 0;
  for (const nm of names) { const k = norm(nm).trim(); if (!k || have.has(k)) continue; have.add(k); await store.upsert("shop", {name:nm.slice(0, 60), qty:null, done:false, by:me() || null, createdAt:Date.now()}); n++; }
  return n;
}
async function clearBasket(){
  const done = state.shop.filter(i => i.done), counts = {...(state.stats.shop || {})};
  done.forEach(x => { const n = x.name.trim().toLowerCase(); const key = Object.keys(counts).find(k => k.toLowerCase() === n) || x.name.trim(); counts[key] = (counts[key] || 0) + 1; });
  const keys = Object.keys(counts); if (keys.length > 150) keys.sort((a, b) => counts[a] - counts[b]).slice(0, keys.length - 150).forEach(k => delete counts[k]);
  for (const x of done) await store.remove("shop", x.id);
  store.saveStats({...state.stats, shop:counts}).catch(() => {});
}
const addedN = (n, tail) => n ? `${n} ingrédient${n > 1 ? "s" : ""} ajouté${n > 1 ? "s" : ""} ${tail}` : "Tout est déjà sur la liste";

function Shop({ canEdit }){
  const [name, setName] = useState(""), [qty, setQty] = useState(""), nameRef = useRef(null);
  const byAisle = pref.get("pc.aisle", "1") === "1";
  const todo = state.shop.filter(x => !x.done).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const done = state.shop.filter(x => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const inList = new Set(state.shop.map(x => x.name.toLowerCase()));
  const sugg = Object.entries(state.stats.shop || {}).filter(([n]) => !inList.has(n.toLowerCase())).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const add = async e => {
    e.preventDefault(); const n = name.trim(); if (!n) return;
    setName(""); setQty(""); nameRef.current?.focus();
    try { await store.upsert("shop", {name:n.slice(0, 60), qty:qty.trim().slice(0, 10) || null, done:false, by:me() || null, createdAt:Date.now()}); } catch (err) { handleWriteError(err); }
  };
  const toggle = async (x, on) => { try { await store.upsert("shop", {...x, done:on, doneAt:on ? Date.now() : null}); } catch (e) { handleWriteError(e); bump(); } };
  const item = x => <li key={x.id} className={x.done ? "done" : ""}>
    <input key={String(!!x.done)} type="checkbox" className="cbx" defaultChecked={!!x.done} disabled={!canEdit} aria-label={x.name} onChange={e => toggle(x, e.target.checked)} />
    <span className="tx">{x.name}{x.qty && <> <span className="inl">· {x.qty}</span></>}{x.by && <span><MAvatar id={x.by} />ajouté par {memberName(x.by)}</span>}</span>
    {canEdit && <button className="x" aria-label={`Retirer ${x.name}`} onClick={async () => { try { await removeWithUndo("shop", x, `« ${x.name} » retiré`); } catch (e) { handleWriteError(e); } }}><Icon name="x" /></button>}</li>;
  let list;
  if (!todo.length) list = <div className="empty"><Icon name="shopping-basket" />Liste vide</div>;
  else if (byAisle) {
    const groups = {}; todo.forEach(x => (groups[aisleOf(x.name)] = groups[aisleOf(x.name)] || []).push(x));
    list = AISLES.map(a => a[0]).concat("Autre").filter(a => groups[a]).map(a => <div key={a}><h3><Icon name={AISLE_ICONS[a] || "shopping-basket"} /> {a}</h3><ul className="items">{groups[a].map(item)}</ul></div>);
  } else list = <ul className="items">{todo.map(item)}</ul>;
  const pay = () => {
    const names = state.shop.filter(i => i.done).map(i => i.name + (i.qty ? " (" + i.qty + ")" : "")).join(", ");
    openExpense(null, "expenses", {label:"Courses", cat:"courses", note:names.slice(0, 300), date:todayStr()}, async () => { try { await clearBasket(); } catch {} toast("Panier payé et vidé"); });
  };
  return <section className="panel"><h2>Liste de courses</h2>
    {canEdit && <form className="addrow" onSubmit={add}>
      <input ref={nameRef} className="inp" placeholder="Ajouter un article (ex. lait)" maxLength={60} aria-label="Article" value={name} onChange={e => setName(e.target.value)} />
      <input className="inp q" placeholder="Qté" maxLength={10} aria-label="Quantité" value={qty} onChange={e => setQty(e.target.value)} />
      <button className="btn" type="submit">Ajouter</button></form>}
    <div>
      {canEdit && sugg.length > 0 && <div className="sugg" aria-label="Suggestions">{sugg.map(([n]) => <button key={n} className="chip" onClick={async () => { try { await store.upsert("shop", {name:n, qty:null, done:false, by:me() || null, createdAt:Date.now()}); } catch (e) { handleWriteError(e); } }}>+ {n}</button>)}</div>}
      <div className="actions shopopts"><Check className="check small m0" checked={byAisle} onChange={v => { pref.set("pc.aisle", v ? "1" : "0"); bump(); }}>Trier par rayon</Check></div>
      {list}
      {done.length > 0 && <><h3>Dans le panier ({done.length})</h3><ul className="items">{done.map(item)}</ul>
        {canEdit && <div className="actions"><button className="btn sm ghost" onClick={async () => { if (confirm("Retirer les articles du panier ?")) try { await clearBasket(); } catch (e) { handleWriteError(e); } }}>Vider le panier</button>
          <button className="btn sm push" onClick={pay}>Payer le panier</button></div>}</>}
    </div></section>;
}

/* ---------- Placards et congélateur ---------- */
const PLACES = ["Frigo", "Congélateur", "Placard", "Cave"];
const placeIcon = p => p === "Congélateur" ? "snowflake" : p === "Frigo" ? "refrigerator" : p === "Cave" ? "wine" : "archive";
function Inventory({ canEdit }){
  let body;
  if (!state.inventory.length) body = <div className="empty"><Icon name="refrigerator" />Placards vides</div>;
  else {
    const t = todayStr(), groups = {};
    state.inventory.forEach(i => (groups[i.place || "Placard"] = groups[i.place || "Placard"] || []).push(i));
    const use = async i => { try { await store.remove("inventory", i.id); await addToShop([i.name]); toast(`« ${i.name} » ajouté à la liste de courses`, "Annuler", () => store.upsert("inventory", i)); } catch (e) { handleWriteError(e); } };
    body = PLACES.concat(Object.keys(groups).filter(p => !PLACES.includes(p))).filter(p => groups[p]).map(p => <div key={p}><h3><Icon name={placeIcon(p)} /> {p}</h3><ul className="items">
      {groups[p].sort((a, b) => (a.expiry || "9999").localeCompare(b.expiry || "9999")).map(i => { const d = i.expiry ? daysBetween(t, i.expiry) : null;
        return <li key={i.id}><span className="tx">{i.name}{i.qty && <> <span className="inl">· {i.qty}</span></>}
          <span className={d != null && d < 0 ? "late" : d != null && d <= 3 ? "up" : ""}>{d == null ? "sans date" : d < 0 ? `périmé depuis ${-d} j` : d === 0 ? "à consommer aujourd'hui" : `avant le ${fmtDay(i.expiry, {day:"numeric", month:"short"})}`}</span></span>
          {canEdit && <><button className="btn sm ghost" title="Consommé : retirer et ajouter à la liste de courses" onClick={() => use(i)}>À racheter</button>
            <button className="x" aria-label={`Modifier ${i.name}`} onClick={() => openDialog("inv", {i})}><Icon name="pencil" /></button></>}</li>; })}</ul></div>);
  }
  return <section className="panel"><div className="phead"><h2>Placards et congélateur</h2><button className="btn sm" disabled={!canEdit} onClick={() => openDialog("inv", {})}>+ Article</button></div>{body}</section>;
}
function InvDialog({ i, onClose }){
  const [f, setF] = useState({name:i ? i.name : "", qty:i ? i.qty || "" : "", exp:i ? i.expiry || "" : "", place:i ? i.place || "Placard" : pref.get("pc.lastPlace", "Congélateur"), err:""});
  const set = p => setF(x => ({...x, ...p}));
  const submit = async () => {
    const name = f.name.trim(); if (!name) return set({err:"Indiquez l'article."});
    pref.set("pc.lastPlace", f.place);
    try { await store.upsert("inventory", {...(i || {createdAt:Date.now()}), name:name.slice(0, 50), place:f.place, qty:f.qty.trim().slice(0, 12), expiry:f.exp || null}); onClose(); } catch (e) { handleWriteError(e); }
  };
  return <Dialog title="Article" onClose={onClose} onSubmit={submit}>
    <Field label="Article" htmlFor="ivName"><input className="inp" id="ivName" maxLength={50} placeholder="ex. Steaks hachés" autoFocus value={f.name} onChange={e => set({name:e.target.value})} /></Field>
    <Field label="Où"><Chips label="Où" value={f.place} onChange={v => set({place:v})} items={PLACES.map(p => ({id:p, label:p}))} /></Field>
    <div className="erow"><div className="f1"><label className="small" htmlFor="ivQty">Quantité</label><input className="inp" id="ivQty" maxLength={12} placeholder="ex. 4" value={f.qty} onChange={e => set({qty:e.target.value})} /></div>
      <div className="f1"><label className="small" htmlFor="ivExp">À consommer avant</label><input className="inp" id="ivExp" type="date" value={f.exp} onChange={e => set({exp:e.target.value})} /></div></div>
    <p className="err mt12" role="alert">{f.err}</p>
    <div className="actions">{i && <button type="button" className="btn danger" onClick={async () => { onClose(); try { await removeWithUndo("inventory", i, "Article retiré"); } catch (e) { handleWriteError(e); } }}>Supprimer</button>}<button type="submit" className="btn push">Enregistrer</button></div>
  </Dialog>;
}

/* ---------- Menus de la semaine ---------- */
function mealWeekStart(){ const d = weekStart(); d.setDate(d.getDate() + state.mealWeek * 7); return d; }
function dishLibrary(){ const lib = {}; state.meals.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).forEach(m => { if (m.dish) lib[norm(m.dish).trim()] = {dish:m.dish, ing:m.ingredients || []}; }); return lib; }
const ingList = s => s.split(/[,\n]/).map(x => x.trim()).filter(Boolean).slice(0, 30);

function MealDialog({ ds, slot, onClose }){
  const m = state.meals.find(x => x.id === `${ds}-${slot}`);
  const [dish, setDish] = useState(m ? m.dish : ""), [ing, setIng] = useState(m ? (m.ingredients || []).join(", ") : ""), dishRef = useRef(null);
  const lib = dishLibrary();
  const submit = async () => {
    const d = dish.trim(); if (!d) { dishRef.current?.focus(); return; }
    try { await store.upsert("meals", {id:`${ds}-${slot}`, date:ds, slot, dish:d.slice(0, 60), ingredients:ingList(ing), createdAt:Date.now()}); onClose(); } catch (e) { handleWriteError(e); }
  };
  return <Dialog title={`${slot === "midi" ? "Midi" : "Soir"} — ${fmtDay(ds, {weekday:"long", day:"numeric", month:"long"})}`} onClose={onClose} onSubmit={submit}>
    <Field label="Plat" htmlFor="mDish"><input ref={dishRef} className="inp" id="mDish" maxLength={60} list="dishList" placeholder="ex. Lasagnes" autoFocus value={dish}
      onChange={e => setDish(e.target.value)} onBlur={() => { const x = lib[norm(dish).trim()]; if (x && !ing.trim()) setIng(x.ing.join(", ")); }} />
      <datalist id="dishList">{Object.values(lib).map(x => <option key={x.dish} value={x.dish} />)}</datalist></Field>
    <Field label="Ingrédients (séparés par des virgules)" htmlFor="mIng"><textarea className="inp" id="mIng" maxLength={400} placeholder="ex. pâtes à lasagnes, bœuf haché, tomates, mozzarella" value={ing} onChange={e => setIng(e.target.value)} /></Field>
    <div className="actions">
      {m && <button type="button" className="btn danger" onClick={async () => { onClose(); try { await removeWithUndo("meals", m, "Repas effacé"); } catch (e) { handleWriteError(e); } }}>Effacer</button>}
      <button type="button" className="btn sm ghost" onClick={async () => { try { toast(addedN(await addToShop(ingList(ing)), "à la liste")); } catch (e) { handleWriteError(e); } }}><Icon name="shopping-cart" />Vers la liste</button>
      <button type="submit" className="btn push">Enregistrer</button></div>
  </Dialog>;
}

async function printShop(){
  const todo = state.shop.filter(x => !x.done), groups = {};
  todo.forEach(x => (groups[aisleOf(x.name)] = groups[aisleOf(x.name)] || []).push(x));
  const blocks = Object.keys(groups).map(a => ({h:a.replace(/^\S+\s/, ""), p:groups[a].map(x => "[  ]  " + x.name + (x.qty ? " (" + x.qty + ")" : "")).join("\n")}));
  if (!todo.length) blocks.push({p:"La liste est vide."});
  const s0 = mealWeekStart(), rows = [];
  for (let i = 0; i < 7; i++) { const d = new Date(s0); d.setDate(d.getDate() + i); const ds = dstr(d); const g = sl => (state.meals.find(m => m.id === `${ds}-${sl}`) || {}).dish || "";
    rows.push([d.toLocaleDateString("fr-FR", {weekday:"long", day:"numeric"}), g("midi"), g("soir")]); }
  if (rows.some(r => r[1] || r[2])) blocks.push({h:"Menus de la semaine", table:{head:["Jour", "Midi", "Soir"], widths:[.26, .37, .37], align:["l", "l", "l"], rows}});
  try { await savePdf(`courses-${todayStr()}.pdf`, "Liste de courses", blocks); } catch { toast("Le PDF n'a pas pu être créé."); }
}

function Meals({ canEdit }){
  const s0 = mealWeekStart(), t = todayStr(), byId = {}; state.meals.forEach(m => byId[m.id] = m);
  const cells = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(s0); d.setDate(d.getDate() + i); const ds = dstr(d);
    cells.push(<span key={ds} className={"dh " + (ds === t ? "today" : "")}>{d.toLocaleDateString("fr-FR", {weekday:"short", day:"numeric"})}</span>);
    ["midi", "soir"].forEach(sl => { const m = byId[`${ds}-${sl}`];
      cells.push(<button key={ds + sl} type="button" className={m ? "has" : ""} disabled={!canEdit} aria-label={`${sl} du ${fmtDay(ds, {weekday:"long", day:"numeric"})}${m ? " : " + m.dish : ""}`} onClick={() => openDialog("meal", {ds, slot:sl})}>{m ? m.dish : "+"}</button>); });
  }
  const toShop = async () => {
    const e0 = (() => { const d = mealWeekStart(); d.setDate(d.getDate() + 6); return dstr(d); })(), s = dstr(s0);
    const ing = state.meals.filter(m => m.date >= s && m.date <= e0).flatMap(m => m.ingredients || []);
    if (!ing.length) { toast("Aucun ingrédient dans les menus de cette semaine."); return; }
    try { toast(addedN(await addToShop(ing), "à la liste de courses")); } catch (e) { handleWriteError(e); }
  };
  const week = d => { state.mealWeek += d; bump(); };
  return <section className="panel">
    <div className="month"><button aria-label="Semaine précédente" onClick={() => week(-1)}>‹</button>
      <span className="month-name">{state.mealWeek === 0 ? "Menus de la semaine" : "Semaine du " + fmtDay(dstr(s0), {day:"numeric", month:"long"})}</span>
      <button aria-label="Semaine suivante" onClick={() => week(1)}>›</button></div>
    <div className="meal"><span /><span className="small muted">Midi</span><span className="small muted">Soir</span>{cells}</div>
    <div className="actions"><button className="btn sm ghost" onClick={printShop}><Icon name="printer" />PDF</button>
      {canEdit && <button className="btn sm ghost push" onClick={toShop}><Icon name="shopping-cart" />Vers la liste</button>}</div>
  </section>;
}

registerDialog("inv", InvDialog);
registerDialog("meal", MealDialog);

export default function Courses({ canEdit }){
  useStore();
  return <Columns className="grid even" left={[<Shop key="shop" canEdit={canEdit} />, <Inventory key="inv" canEdit={canEdit} />]} right={[<Meals key="meals" canEdit={canEdit} />]} />;
}
