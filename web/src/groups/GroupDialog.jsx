/* Fenêtre d'un groupe entre amis (côté foyer) : participants, lien public + QR, archivage/verrouillage,
   ajout/modification de dépenses (catégorie, parts ou montants personnalisés, photo), soldes et règlements. */
import { useEffect, useRef, useState } from "react";
import { Dialog, openDialog, registerDialog } from "../ui/Dialog.jsx";
import { Icon } from "../ui/icons.jsx";
import { Check } from "../ui/bits.jsx";
import { useStore } from "../lib/hooks.js";
import { state, members, uid, todayStr, toInput, parseAmount, fmt, fmtDay, GROUP_CATS } from "../lib/core.js";
import { SV, api, store, toast, handleWriteError, uploadImage } from "../data/store.js";
import { removeWithUndo } from "../lib/domain.js";
import { groupPhotoDataUrl } from "../lib/image.js";
import { savePdf } from "../lib/files.js";
import { useGroupSummary, groupBalances, settlements, personName } from "./Summary.jsx";
import { openExpense } from "../dialogs/Money.jsx";

export const openGroup = id => openDialog("group", {id:id || null});

async function pdfGroup(g){
  const pn = id => personName(g, id), bal = groupBalances(g), tr = settlements(bal);
  const items = (g.items || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const total = items.filter(it => it.kind !== "settlement").reduce((s, it) => s + it.amount, 0);
  await savePdf(`groupe-${g.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`, "Récap · " + g.name, [
    {h:"Soldes", kv:g.people.map(p => [p.name, (bal[p.id] >= 0 ? "+" : "−") + fmt(Math.abs(bal[p.id]))])},
    {h:"Qui doit quoi", p:tr.length ? tr.map(t => `${pn(t.from)} doit ${fmt(t.amount)} à ${pn(t.to)}`).join(". ") + "." : "Tout le monde est à l'équilibre."},
    {h:"Dépenses", table:{head:["Date", "Libellé", "Payé par", "Montant"], widths:[.16, .44, .22, .18], align:["l", "l", "l", "r"],
      rows:items.map(it => [fmtDay(it.date, {day:"2-digit", month:"2-digit"}), (it.label || "Dépense") + (it.kind === "settlement" ? " (remboursement)" : ""), pn(it.payer), fmt(it.amount)])
        .concat([Object.assign(["", "", "Total", fmt(total)], {bold:true})])}},
  ]);
}

function LinkField({ gid }){
  const [link, setLink] = useState(null);
  const base = `/api/h/${encodeURIComponent(SV.hh.id)}/groups/${encodeURIComponent(gid)}/link`;
  const load = async () => { try { setLink(await api("GET", base)); } catch {} };
  useEffect(() => { load(); }, [gid]);
  const rotate = async () => { try { await api("POST", base + "/rotate"); await load(); toast("Lien généré"); } catch (e) { toast(e.message); } };
  const revoke = async () => {
    if (!confirm("Révoquer ce lien ? Il ne fonctionnera plus pour vos amis.")) return;
    try { await api("DELETE", base); setLink({token:null}); toast("Lien révoqué"); } catch (e) { toast(e.message); }
  };
  const urlRef = useRef(null);
  const copy = async () => { try { await navigator.clipboard.writeText(link.url); toast("Lien copié"); } catch { urlRef.current?.select(); toast("Sélectionnez et copiez avec Ctrl+C"); } };
  return <div className="field"><span className="lab">Lien pour des amis (sans compte)</span>
    <p className="hint m0 mb8">Ils pourront voir le groupe et ajouter leur part, sans se connecter.</p>
    {!link?.token ? <div><button type="button" className="btn sm" onClick={rotate}>Générer un lien</button></div>
      : <div><div className="erow"><input ref={urlRef} className="inp" readOnly aria-label="Lien de partage du groupe" value={link.url} /><button type="button" className="btn sm ghost" onClick={copy}>Copier</button></div>
        {link.qr && <img className="qrimg" src={link.qr} alt="QR code du lien" />}
        <div className="actions mt8"><button type="button" className="btn sm ghost" onClick={revoke}>Révoquer</button><button type="button" className="btn sm ghost" onClick={rotate}>Régénérer</button></div></div>}
  </div>;
}

/** Formulaire d'ajout / de modification d'une dépense de groupe */
function ItemForm({ g, edit, onDone }){
  const it = edit && (g.items || []).find(x => x.id === edit);
  const [f, setF] = useState(() => ({label:it?.label || "", amt:it ? toInput(it.amount) : "", cat:it?.cat || "autre", payer:it?.payer || g.people[0]?.id || "",
    parts:it ? (it.splits ? Object.keys(it.splits) : it.parts) : g.people.map(p => p.id), custom:!!it?.splits,
    splits:it?.splits ? Object.fromEntries(Object.entries(it.splits).map(([k, v]) => [k, toInput(v)])) : {}, photo:it?.photo || null, err:""}));
  const set = p => setF(x => ({...x, ...p})), amtRef = useRef(null), labelRef = useRef(null);
  useEffect(() => { if (edit) labelRef.current?.scrollIntoView({block:"center", behavior:"smooth"}); }, [edit]);
  const save = async items => { await store.upsert("groups", {...g, items}); onDone(); };
  const submit = async () => {
    const amt = parseAmount(f.amt); if (!(amt > 0)) { amtRef.current?.focus(); return; }
    const parts = g.people.map(p => p.id).filter(id => f.parts.includes(id)); if (!parts.length) { toast("Cochez au moins une personne."); return; }
    let splits = null;
    if (f.custom) {
      splits = {}; let sum = 0;
      parts.forEach(pid => { const v = parseAmount(f.splits[pid]); if (v > 0) { splits[pid] = v; sum += v; } });
      if (!Object.keys(splits).length) { toast("Indiquez au moins un montant personnalisé."); return; }
      if (sum !== amt) { toast(`Les montants font ${toInput(sum) || 0} € ; il faut ${toInput(amt)} € au total.`); return; }
    }
    const label = f.label.trim().slice(0, 50);
    let photo = f.photo || null;
    try {
      if (photo && photo.startsWith("data:")) {
        try { photo = await uploadImage(photo); } catch { toast("Erreur lors de l'envoi de la photo."); return; }
      }
      if (it) { await save((g.items || []).map(x => x.id === it.id ? {...x, label, amount:amt, cat:f.cat, payer:f.payer, parts, splits, photo} : x)); toast("Dépense modifiée"); }
      else { await save((g.items || []).concat({id:uid().slice(0, 8), label, amount:amt, cat:f.cat, photo, payer:f.payer, parts, splits, kind:"expense", date:todayStr(), createdAt:Date.now()}).slice(-300)); toast("Dépense ajoutée"); }
    } catch (e) { handleWriteError(e); }
  };
  const onPhoto = async e => { const file = e.target.files && e.target.files[0]; e.target.value = ""; if (!file) return; try { set({photo:await groupPhotoDataUrl(file)}); } catch { toast("Photo illisible."); } };
  const checked = g.people.filter(p => f.parts.includes(p.id));
  return <>
    <h3>{it ? "Modifier la dépense" : "Ajouter une dépense"}</h3>
    <div className="erow"><input ref={labelRef} className="inp" maxLength={50} placeholder="ex. Courses du samedi" aria-label="Libellé" value={f.label} onChange={e => set({label:e.target.value})} />
      <input ref={amtRef} className="inp r w" inputMode="decimal" placeholder="€" aria-label="Montant" value={f.amt} onChange={e => set({amt:e.target.value})} /></div>
    <div className="chips mb8">{GROUP_CATS.map(c => <button key={c.id} type="button" className="chip" aria-pressed={f.cat === c.id} onClick={() => set({cat:c.id})}><Icon name={c.ico} /> {c.name}</button>)}</div>
    <div className="erow"><span className="cn small">Payé par</span><select aria-label="Payé par" value={f.payer} onChange={e => set({payer:e.target.value})}>{g.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
    <div className="chips mb10">{g.people.map(p => <label key={p.id} className="chip"><input type="checkbox" className="cbstatic" checked={f.parts.includes(p.id)}
      onChange={e => set(x => ({parts:e.target.checked ? x.parts.concat(p.id) : x.parts.filter(id => id !== p.id)}))} /> {p.name}</label>)}</div>
    <Check checked={f.custom} onChange={v => set({custom:v})}>Montants personnalisés (au lieu de parts égales)</Check>
    {f.custom && <div className="my8">{checked.map(p => <div className="erow" key={p.id}><span className="cn small">{p.name}</span>
      <input className="inp r w" inputMode="decimal" placeholder="€" aria-label={`Montant pour ${p.name}`} value={f.splits[p.id] || ""} onChange={e => set(x => ({splits:{...x.splits, [p.id]:e.target.value}}))} /></div>)}</div>}
    <div className="erow aic">
      <label className="btn sm ghost"><Icon name="camera" /> Photo<input type="file" accept="image/*" hidden onChange={onPhoto} /></label>
      {f.photo && <><img className="gthumb" src={f.photo} alt="" /><button type="button" className="x" aria-label="Retirer la photo" onClick={() => set({photo:null})}><Icon name="x" /></button></>}
    </div>
    <div className="actions giact"><span className="muted small">Parts égales entre les personnes cochées, sauf montants personnalisés.</span>
      {it && <button type="button" className="linkbtn" onClick={onDone}>Annuler</button>}
      <button type="button" className="btn sm push" onClick={submit}>{it ? "Enregistrer" : "Ajouter"}</button></div>
  </>;
}

function GroupBody({ g, onClose }){
  const [edit, setEdit] = useState(null), [formKey, setFormKey] = useState(0);
  const done = () => { setEdit(null); setFormKey(k => k + 1); };
  const save = async items => { try { await store.upsert("groups", {...g, items}); done(); } catch (e) { handleWriteError(e); } };
  const s = useGroupSummary(g, {canDeleteAny:true, canConvert:false,
    onEdit:it => { setEdit(it.id); setFormKey(k => k + 1); },
    onDelete:it => save((g.items || []).filter(x => x.id !== it.id)),
    onSettle:t => save((g.items || []).concat({id:uid().slice(0, 8), label:"Remboursement", amount:t.amount, payer:t.from, parts:[t.to], kind:"settlement", date:todayStr(), createdAt:Date.now()})),
    onConvert:p => { const net = Math.round(-groupBalances(g)[p.id]); if (!(net > 0)) return; onClose(); openExpense(null, "expenses", {amount:net, label:"Groupe : " + g.name, date:todayStr()}); },
  });
  return <div>
    <ItemForm key={formKey + "|" + (edit || "")} g={g} edit={edit} onDone={done} />
    {s.charts}<h3>Qui doit quoi</h3>{s.settleHtml}{s.balCards}<h3>Dépenses ({s.count})</h3>{s.itemsHtml}
  </div>;
}

function GroupDialog({ id: id0, onClose }){
  useStore();
  const [gid, setGid] = useState(id0);
  const g = gid ? state.groups.find(x => x.id === gid) : null;
  const [name, setName] = useState(g ? g.name : ""), [people, setPeople] = useState(g ? g.people.map(p => p.name).join(", ") : members().map(m => m.name).join(", "));
  const nameRef = useRef(null);
  // Mise à jour en direct quand un ami ajoute une dépense (toast comme l'original)
  const sig = g ? (g.items || []).map(it => it.id).join(",") + "|" + !!g.locked + "|" + !!g.archived : null, lastSig = useRef(sig);
  useEffect(() => { if (lastSig.current && sig && sig !== lastSig.current && !document.activeElement?.matches("input, textarea, select")) toast("Le groupe a été mis à jour"); lastSig.current = sig; }, [sig]);

  const saveGroup = async () => {
    const n = name.trim(); if (!n) { nameRef.current?.focus(); return; }
    const names = people.split(",").map(x => x.trim()).filter(Boolean).slice(0, 20);
    if (names.length < 2) { toast("Indiquez au moins deux participants."); return; }
    const ppl = names.map(x => (g && g.people.find(p => p.name.toLowerCase() === x.toLowerCase())) || {id:uid().slice(0, 8), name:x.slice(0, 30)});
    try { const id = await store.upsert("groups", {...(g || {items:[], createdAt:Date.now()}), name:n.slice(0, 40), people:ppl}); setGid(id); toast("Groupe enregistré"); }
    catch (e) { handleWriteError(e); }
  };
  const flag = async (k, v, msg) => { try { await store.upsert("groups", {...g, [k]:v}); toast(msg); } catch (e) { handleWriteError(e); } };
  const dup = async () => {
    try { const id = await store.upsert("groups", {name:(g.name + " (copie)").slice(0, 40), people:g.people.map(p => ({id:uid().slice(0, 8), name:p.name})), items:[], createdAt:Date.now()});
      toast("Groupe dupliqué"); setGid(id); setName((g.name + " (copie)").slice(0, 40)); } catch (e) { handleWriteError(e); }
  };
  return <Dialog title={g ? g.name : "Nouveau groupe"} wide onClose={onClose} closeLabel="Fermer" form={false}>
    <div className="field"><input ref={nameRef} className="inp" maxLength={40} placeholder="ex. Week-end à la mer" aria-label="Nom du groupe" value={name} onChange={e => setName(e.target.value)} /></div>
    <div className="field"><label htmlFor="gpPeople">Participants (séparés par des virgules)</label><input className="inp" id="gpPeople" placeholder="ex. Léa, Tom, Julie, Marc" value={people} onChange={e => setPeople(e.target.value)} /></div>
    <div className="actions m0 mb12">{g && <button type="button" className="btn sm ghost" onClick={async () => { onClose(); try { await removeWithUndo("groups", g, "Groupe supprimé"); } catch (e) { handleWriteError(e); } }}>Supprimer le groupe</button>}
      <button type="button" className="btn sm push" onClick={saveGroup}>Enregistrer le groupe</button></div>
    {g && SV.hh && <LinkField gid={g.id} />}
    {g && <div className="field"><div className="actions m0 mb10 wrapf">
      <button type="button" className="btn sm ghost" onClick={async () => { try { await pdfGroup(g); } catch { toast("Export impossible."); } }}><Icon name="file-down" />Récap PDF</button>
      <button type="button" className="btn sm ghost" onClick={dup}><Icon name="copy" />Dupliquer</button>
      <Check checked={g.archived} onChange={v => flag("archived", v, v ? "Groupe archivé" : "Groupe désarchivé")}>Archivé</Check>
      <Check checked={g.locked} onChange={v => flag("locked", v, v ? "Groupe verrouillé : plus d'ajout possible depuis le lien public" : "Groupe déverrouillé")}>Verrouillé</Check>
    </div></div>}
    {g ? <GroupBody g={g} onClose={onClose} /> : <p className="muted small">Enregistrez le groupe pour ajouter des dépenses.</p>}
  </Dialog>;
}
registerDialog("group", GroupDialog);
