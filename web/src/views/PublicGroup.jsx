/* Page publique d'un groupe (?groupe=jeton) : les amis voient le récap et ajoutent leur part sans compte.
   Les dépenses ajoutées depuis cet appareil restent modifiables 30 minutes (jeton de possession gardé localement).
   Rafraîchissement toutes les 20 s : React ne touche ni au formulaire en cours ni au focus. */
import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icons.jsx";
import { AuthCard } from "./Auth.jsx";
import { pref, parseAmount, parseNum, toInput, GROUP_CATS } from "../lib/core.js";
import { api, toast } from "../data/store.js";
import { groupPhotoDataUrl } from "../lib/image.js";
import { useGroupSummary, personName } from "../groups/Summary.jsx";

const claimsKey = t => "pc.pubclaims." + t;
const loadClaims = t => { try { return JSON.parse(localStorage.getItem(claimsKey(t)) || "{}"); } catch { return {}; } };
const saveClaims = (t, c) => { try { localStorage.setItem(claimsKey(t), JSON.stringify(c)); } catch {} };
const url = t => `/api/public/group/${encodeURIComponent(t)}`;

function AddForm({ token, g, editId, onDone }){
  const it = editId && g.items.find(x => x.id === editId);
  const [f, setF] = useState(() => ({name:pref.get("pc.pubname", ""), label:it?.label || "", amt:it ? toInput(it.amount) : "", cat:it?.cat || "autre", fx:false, cur:"", rate:"", photo:it?.photo || null, err:""}));
  const set = p => setF(x => ({...x, ...p}));
  const submit = async e => {
    e.preventDefault();
    const name = f.name.trim().slice(0, 30), label = f.label.trim().slice(0, 80), amt = parseAmount(f.amt), rate = parseNum(f.rate);
    if (!name) return set({err:"Indiquez votre nom."});
    if (!label) return set({err:"Indiquez un libellé."});
    if (!Number.isFinite(amt) || amt <= 0) return set({err:"Indiquez un montant."});
    if (f.fx && !(rate > 0)) return set({err:"Indiquez le taux de change."});
    pref.set("pc.pubname", name);
    const body = {label, cat:f.cat, photo:f.photo || null};
    if (f.fx) Object.assign(body, {currency:f.cur.trim().toUpperCase().slice(0, 6) || "USD", rate, origAmount:amt, amount:Math.round(amt * rate)}); else body.amount = amt;
    try {
      if (editId) { await api("PATCH", `${url(token)}/item/${encodeURIComponent(editId)}`, {...body, claimToken:loadClaims(token).items[editId].token}); toast("Dépense modifiée"); }
      else {
        const existing = g.people.find(p => p.name.toLowerCase() === name.toLowerCase());
        const r = await api("POST", `${url(token)}/item`, {...body, payerId:existing ? existing.id : null, payerName:existing ? null : name});
        const c = loadClaims(token); c.items = c.items || {}; c.items[r.itemId] = {token:r.claimToken, createdAt:Date.now()};
        if (r.personClaimToken && r.personId) { c.persons = c.persons || {}; c.persons[r.personId] = r.personClaimToken; }
        saveClaims(token, c); toast("Dépense ajoutée");
      }
      onDone(true);
    } catch (x) { set({err:x.message || "Erreur."}); }
  };
  const onPhoto = async e => { const file = e.target.files && e.target.files[0]; e.target.value = ""; if (!file) return; try { set({photo:await groupPhotoDataUrl(file)}); } catch { toast("Photo illisible."); } };
  const F = (n, label, extra = {}) => <div className="field"><label htmlFor={"a_" + n}>{label}</label><input className="inp" id={"a_" + n} type="text" value={f[n]} onChange={e => set({[n]:e.target.value})} {...extra} /></div>;
  return <><h3>{editId ? "Modifier votre dépense" : "Ajouter une dépense"}</h3>
    <form noValidate onSubmit={submit}>
      {F("name", "Votre nom")}{F("label", "Libellé")}
      <div className="chips mb8">{GROUP_CATS.map(c => <button key={c.id} type="button" className="chip" aria-pressed={f.cat === c.id} onClick={() => set({cat:c.id})}><Icon name={c.ico} /> {c.name}</button>)}</div>
      {F("amt", "Montant (€)", {inputMode:"decimal", placeholder:"0,00"})}
      <div className="field"><label className="check"><input type="checkbox" checked={f.fx} onChange={e => set({fx:e.target.checked})} /> Payé dans une autre devise</label>
        {f.fx && <div className="erow mt8"><input className="inp mw90" maxLength={6} placeholder="ex. USD" aria-label="Devise" value={f.cur} onChange={e => set({cur:e.target.value})} />
          <input className="inp r w" inputMode="decimal" placeholder="taux → EUR" aria-label="Taux de change" value={f.rate} onChange={e => set({rate:e.target.value})} /></div>}</div>
      <div className="erow aic">
        <label className="btn sm ghost"><Icon name="camera" /> Photo<input type="file" accept="image/*" hidden onChange={onPhoto} /></label>
        {f.photo && <><img className="gthumb" src={f.photo} alt="" /><button type="button" className="x" aria-label="Retirer la photo" onClick={() => set({photo:null})}><Icon name="x" /></button></>}
      </div>
      <p className="err">{f.err}</p>
      <div className="actions">{editId && <button type="button" className="linkbtn" onClick={() => onDone(false)}>Annuler</button>}<button className="btn" type="submit">{editId ? "Enregistrer" : "Ajouter"}</button></div>
    </form></>;
}

function Body({ token, g, reload }){
  const [editId, setEditId] = useState(null), [formKey, setFormKey] = useState(0);
  const claims = loadClaims(token);
  const s = useGroupSummary(g, {canDeleteAny:false, canConvert:false,
    editableItemIds:new Set(Object.keys(claims.items || {})), editablePersonIds:new Set(Object.keys(claims.persons || {})),
    onEdit:it => { setEditId(it.id); setFormKey(k => k + 1); },
    onDelete:async it => {
      if (!confirm("Supprimer cette dépense ?")) return;
      const claim = (loadClaims(token).items || {})[it.id];
      try { await api("DELETE", `${url(token)}/item/${encodeURIComponent(it.id)}?claimToken=${encodeURIComponent(claim ? claim.token : "")}`); await reload(); toast("Dépense supprimée"); } catch (e) { toast(e.message); }
    },
    onSettle:async t => { try { await api("POST", `${url(token)}/settle`, {from:t.from, to:t.to, amount:t.amount}); await reload(); toast("Marqué comme réglé"); } catch (e) { toast(e.message); } },
    onRename:async p => {
      const claim = (loadClaims(token).persons || {})[p.id]; if (!claim) return;
      const name = prompt("Nouveau nom :", personName(g, p.id)); if (!name || !name.trim()) return;
      try { await api("POST", `${url(token)}/person`, {personId:p.id, name:name.trim().slice(0, 30), claimToken:claim}); await reload(); } catch (e) { toast(e.message); }
    },
  });
  return <div className="gpage-grid">
    <div className="gcol">{s.charts}<h3>Qui doit quoi</h3>{s.settleHtml}{s.balCards}</div>
    <div className="gcol">
      <div><h3 tabIndex={-1}>Dépenses ({s.count})</h3>{s.itemsHtml}</div>
      <div>{!g.locked && <AddForm key={formKey + "|" + (editId || "")} token={token} g={g} editId={editId} onDone={async changed => { setEditId(null); setFormKey(k => k + 1); if (changed) await reload(); }} />}</div>
    </div>
  </div>;
}

export function PublicGroup({ token }){
  const [g, setG] = useState(null), [err, setErr] = useState(""), [live, setLive] = useState(""), sig = useRef("");
  const apply = (fresh, fromOthers) => {
    const s = JSON.stringify(fresh); if (s === sig.current) return;
    if (fromOthers && sig.current) {
      const n = (fresh.items || []).length - (JSON.parse(sig.current).items || []).length;
      setLive(n > 0 ? `${n} nouvelle${n > 1 ? "s" : ""} dépense${n > 1 ? "s" : ""} ajoutée${n > 1 ? "s" : ""} par d'autres participants.` : "Le groupe a été mis à jour.");
    }
    sig.current = s; setG(fresh);
  };
  const reload = async () => apply(await api("GET", url(token)), false);
  useEffect(() => {
    document.title = "DAFeuille";
    api("GET", url(token)).then(x => { apply(x, false); document.title = x.name + " · DAFeuille"; }).catch(e => setErr(e.message || "Ce lien n'est plus valable."));
    const t = setInterval(async () => { if (document.hidden) return; try { apply(await api("GET", url(token)), true); } catch {} }, 20000);
    return () => clearInterval(t);
  }, [token]);
  if (err) return <AuthCard><h1>Lien introuvable</h1><p className="sub">{err}</p></AuthCard>;
  if (!g) return <AuthCard><p className="sub">Chargement…</p></AuthCard>;
  return <AuthCard wide>
    <h1>{g.name}</h1><p className="sub">Ajoutez votre part, sans compte.</p>
    {g.locked && <div className="alert"><b>Groupe verrouillé</b> — plus aucun ajout n'est possible.</div>}
    <p className="sr-only" aria-live="polite">{live}</p>
    <Body token={token} g={g} reload={reload} />
  </AuthCard>;
}
