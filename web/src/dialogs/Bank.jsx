/* Connexion bancaire automatique (open banking, GoCardless Bank Account Data) : relier un compte
   bancaire une fois, puis les dépenses et revenus se remplissent tout seuls (synchronisation
   automatique côté serveur, et bouton « Synchroniser maintenant » ici). */
import { useEffect, useState } from "react";
import { Dialog, openDialog, registerDialog } from "../ui/Dialog.jsx";
import { Icon } from "../ui/icons.jsx";
import { Field } from "../ui/bits.jsx";
import { state, members, fmtDay } from "../lib/core.js";
import { SV, api, toast, handleWriteError } from "../data/store.js";

const hb = () => `/api/h/${encodeURIComponent(SV.hh.id)}`;
export const openBankLinks = () => openDialog("bankLinks");

const STATUS_FR = {pending:"En attente de connexion", linked:"Connectée", error:"Erreur", revoked:"Révoquée"};

function ConnectForm({ onDone }){
  const [list, setList] = useState(null), [err, setErr] = useState(""), [q, setQ] = useState("");
  const [institutionId, setInstitutionId] = useState(""), [memberId, setMemberId] = useState(members()[0]?.id || ""), [accountId, setAccountId] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { api("GET", `${hb()}/bank/institutions`).then(r => setList(r.institutions)).catch(e => setErr(e.message)); }, []);
  const filtered = list ? list.filter(i => !q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase())) : null;
  const connect = async () => {
    if (!institutionId) return setErr("Choisissez votre banque.");
    if (!memberId) return setErr("Choisissez à qui attribuer les opérations.");
    setBusy(true); setErr("");
    try { const r = await api("POST", `${hb()}/bank/connect`, {institutionId, memberId, appAccountId:accountId || null}); location.href = r.redirectUrl; }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return <div>
    <p className="muted small mt0">Vous serez redirigé vers votre banque (ou une page sécurisée GoCardless) pour autoriser l'accès, lecture seule, révocable à tout moment.</p>
    <Field label="Votre banque" htmlFor="bkSearch">
      <input className="inp" id="bkSearch" placeholder="Rechercher…" value={q} onChange={e => setQ(e.target.value)} />
      {err && !list ? <p className="err">{err}</p> : !list ? <p className="muted small mt8">Chargement…</p> : (
        <div className="bklist">{filtered.length ? filtered.map(i => <label key={i.id} className="bkrow">
          <input type="radio" name="bkinst" checked={institutionId === i.id} onChange={() => setInstitutionId(i.id)} />
          {i.logo && <img src={i.logo} alt="" className="bklogo" />}<span>{i.name}</span></label>)
          : <p className="muted small">Aucune banque trouvée.</p>}</div>
      )}
    </Field>
    <Field label="Attribuer les opérations à"><select className="inp" value={memberId} onChange={e => setMemberId(e.target.value)}>{members().map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
    {state.accounts.length > 0 && <Field label="Compte DAFeuille associé (facultatif)" htmlFor="bkAcc">
      <select className="inp" id="bkAcc" value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">Aucun</option>{state.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
    <p className="err" role="alert">{err}</p>
    <div className="actions"><button type="button" className="linkbtn" onClick={onDone}>Annuler</button><button type="button" className="btn push" disabled={busy || !list} onClick={connect}>Connecter ma banque</button></div>
  </div>;
}

function BankLinksDialog({ onClose }){
  const [links, setLinks] = useState(null), [configured, setConfigured] = useState(true), [adding, setAdding] = useState(false), [busyId, setBusyId] = useState(null);
  const load = async () => { try { const r = await api("GET", `${hb()}/bank/links`); setLinks(r.links); setConfigured(r.configured); } catch (e) { toast(e.message); } };
  useEffect(() => { load(); }, []);
  const sync = async id => { setBusyId(id); try { const r = await api("POST", `${hb()}/bank/${id}/sync`, {}); toast(r.imported ? `${r.imported} opération${r.imported > 1 ? "s" : ""} importée${r.imported > 1 ? "s" : ""}` : "Déjà à jour"); await load(); } catch (e) { handleWriteError(e); } finally { setBusyId(null); } };
  const remove = async id => { if (!confirm("Déconnecter cette banque ? Les opérations déjà importées restent enregistrées.")) return; try { await api("DELETE", `${hb()}/bank/${id}`); toast("Connexion supprimée"); await load(); } catch (e) { handleWriteError(e); } };
  return <Dialog title="Connexion bancaire" onClose={onClose} closeLabel="Fermer" form={false}>
    {!configured ? <p className="muted small mt0">La connexion bancaire automatique n'est pas configurée sur ce serveur (clés GoCardless absentes de la configuration).</p> : adding ? <ConnectForm onDone={() => { setAdding(false); load(); }} /> : <div>
      {!links ? <p className="muted small">Chargement…</p> : !links.length ? <p className="muted small mt0">Aucune banque connectée. Les dépenses et revenus se rempliront automatiquement une fois une banque reliée.</p>
        : <ul className="items">{links.map(l => <li key={l.id}><span className="ic"><Icon name={l.status === "linked" ? "landmark" : l.status === "error" ? "triangle-alert" : "clock"} /></span>
          <span className="tx">{l.institution_name}{l.account_name ? " · " + l.account_name : ""}<span>{STATUS_FR[l.status] || l.status}{l.last_sync_at ? " · synchronisé " + fmtDay(l.last_sync_at.slice(0, 10)) : ""}{l.error ? " · " + l.error : ""}</span></span>
          {l.status === "linked" && <button className="btn sm ghost" disabled={busyId === l.id} onClick={() => sync(l.id)}>{busyId === l.id ? "…" : "Synchroniser"}</button>}
          <button className="x" aria-label={`Déconnecter ${l.institution_name}`} onClick={() => remove(l.id)}><Icon name="x" /></button></li>)}</ul>}
      <div className="actions"><button type="button" className="btn sm" onClick={() => setAdding(true)}><Icon name="plus" />Connecter une banque</button></div>
    </div>}
  </Dialog>;
}
registerDialog("bankLinks", BankLinksDialog);
