/* Réglages : partie « compte et accès au foyer » (portage de ACC_HTML / initServerSettings). */
import { useEffect, useState } from "react";
import { Icon } from "../ui/icons.jsx";
import { Check } from "../ui/bits.jsx";
import { pref } from "../lib/core.js";
import { SV, api, toast, refreshMe, logout, clearSnapshots } from "../data/store.js";
import { Avatar } from "../Shell.jsx";
import { openDialog } from "../ui/Dialog.jsx";

const ROLE = {owner:"Propriétaire", contributor:"Contributeur", viewer:"Lecteur"};
const hb = () => `/api/h/${encodeURIComponent(SV.hh.id)}`;
const fmtDateTime = iso => new Date(iso).toLocaleString("fr-FR", {day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit"});

/* ---------- Notifications push (par appareil) ---------- */
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const b64u = s => { const p = "=".repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map(c => c.charCodeAt(0))); };
async function currentPushSub(){ try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch { return null; } }
function Push(){
  const [st, setSt] = useState({label:"…", sub:null, denied:false, ok:pushSupported()}), [busy, setBusy] = useState(false), [prefs, setPrefs] = useState(SV.me.pushPrefs || {});
  const load = async () => {
    if (!pushSupported()) return setSt({ok:false, label:/iPhone|iPad/.test(navigator.userAgent) ? "Sur iPhone : ajoutez d'abord DAFeuille à l'écran d'accueil (Partager → Sur l'écran d'accueil)" : "Non disponibles sur ce navigateur"});
    const sub = await currentPushSub(), denied = Notification.permission === "denied";
    setSt({ok:true, sub, denied, label:sub ? "Activées" : denied ? "Bloquées dans les réglages du navigateur" : "Désactivées"});
  };
  useEffect(() => { load(); }, []);
  const toggle = async () => {
    setBusy(true);
    try {
      const sub = await currentPushSub();
      if (sub) { await api("DELETE", "/api/push/subscribe", {endpoint:sub.endpoint}).catch(() => {}); await sub.unsubscribe(); toast("Notifications désactivées sur cet appareil"); }
      else {
        if (await Notification.requestPermission() !== "granted") { toast("Notifications refusées"); return; }
        const {key} = await api("GET", "/api/push/key"); if (!key) { toast("Notifications non configurées sur ce serveur"); return; }
        const reg = await navigator.serviceWorker.ready;
        const s = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64u(key)});
        await api("POST", "/api/push/subscribe", {subscription:s.toJSON()});
        toast("Notifications activées sur cet appareil");
      }
    } catch (e) { toast(e.message || "Impossible d'activer les notifications"); }
    finally { setBusy(false); load(); }
  };
  const setPref = async (k, v) => {
    const next = {bills:prefs.bills !== false, budget:prefs.budget !== false, groups:prefs.groups !== false, badges:prefs.badges !== false, [k]:v};
    setPrefs(next);
    try { SV.me.pushPrefs = (await api("POST", "/api/me/push-prefs", next)).prefs; } catch (e) { toast(e.message); }
  };
  return <>
    <div className="acc-row"><span className="tx">Notifications sur cet appareil<span>{st.label}</span></span>
      {st.ok && !(st.denied && !st.sub) && <button type="button" className="btn sm ghost" disabled={busy} onClick={toggle}>{st.sub ? "Désactiver" : "Activer"}</button>}</div>
    {st.ok && st.sub && <div className="pushprefs">
      {[["bills", "Factures à payer aujourd'hui ou demain"], ["budget", "Budget dépassé par une dépense d'un autre membre"], ["groups", "Dépense ajoutée par un ami dans un groupe"], ["badges", "Badges débloqués"]].map(([k, l]) =>
        <Check key={k} checked={prefs[k] !== false} onChange={v => setPref(k, v)}>{l}</Check>)}</div>}
  </>;
}

function Totp(){
  const [box, setBox] = useState(null), [pw, setPw] = useState(""), [code, setCode] = useState(""), [err, setErr] = useState(""), [, force] = useState(0);
  const start = async () => {
    setErr("");
    if (SV.me.totp) { setBox({mode:"disable"}); return; }
    try { setBox({mode:"setup", ...(await api("POST", "/api/me/totp/setup"))}); } catch (e) { toast(e.message); }
  };
  const disable = async () => { try { await api("POST", "/api/me/totp/disable", {password:pw}); await refreshMe(); setBox(null); force(x => x + 1); toast("Double authentification désactivée"); } catch (e) { setErr(e.message); } };
  const enable = async () => { try { const r = await api("POST", "/api/me/totp/enable", {code}); await refreshMe(); setBox({mode:"codes", codes:r.backupCodes}); } catch (e) { setErr(e.message); } };
  return <>
    <div className="acc-row"><span className="tx">Double authentification<span>{SV.me.totp ? `Activée · ${SV.me.backupLeft} codes de secours restants` : "Désactivée"}</span></span>
      <button type="button" className="btn sm ghost" onClick={start}>{SV.me.totp ? "Désactiver" : "Activer"}</button></div>
    {box?.mode === "disable" && <div><div className="erow"><input className="inp" type="password" placeholder="Mot de passe" autoComplete="current-password" aria-label="Mot de passe" value={pw} onChange={e => setPw(e.target.value)} />
      <button type="button" className="btn sm" onClick={disable}>Confirmer</button></div><p className="err">{err}</p></div>}
    {box?.mode === "setup" && <div><p className="small muted mt8 m0b">Scannez ce code avec une application d'authentification (Google Authenticator, Microsoft Authenticator, 1Password…), puis saisissez le code affiché.</p>
      <img className="qr" src={box.qr} alt="QR code de double authentification" /><p className="small muted tcenter breakall">Clé : {box.secret}</p>
      <div className="erow"><input className="inp code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" aria-label="Code" value={code} onChange={e => setCode(e.target.value)} /><button type="button" className="btn sm" onClick={enable}>Activer</button></div><p className="err">{err}</p></div>}
    {box?.mode === "codes" && <div><p className="small my8"><b>Codes de secours</b> : gardez-les en lieu sûr. Chacun permet une connexion si vous perdez votre téléphone.</p>
      <div className="codes">{box.codes.map(c => <span key={c}>{c}</span>)}</div></div>}
  </>;
}

function Sessions(){
  const [list, setList] = useState(null), [err, setErr] = useState("");
  const load = async () => { try { setList((await api("GET", "/api/me/sessions")).sessions); } catch (e) { setErr(e.message); } };
  const revoke = async id => { try { await api("DELETE", `/api/me/sessions/${encodeURIComponent(id)}`); toast("Session révoquée"); load(); } catch (e) { toast(e.message); } };
  return <details className="more" onToggle={e => { if (e.currentTarget.open && !list) load(); }}><summary>Sessions actives</summary>
    <div>{err ? <p className="err">{err}</p> : !list ? <p className="muted small">Chargement…</p> : !list.length ? <p className="muted small">Aucune session.</p>
      : list.map(s => <div className="acc-row" key={s.id}><span className="tx">{s.current ? <b>Cette session</b> : (s.userAgent || "Appareil inconnu")}<span>{s.ip || "IP inconnue"} · Dernière activité {fmtDateTime(s.lastSeen)}</span></span>
        {s.current ? <span className="muted small">Actuelle</span> : <button type="button" className="x" aria-label="Révoquer cette session" onClick={() => revoke(s.id)}><Icon name="x" /></button>}</div>)}</div></details>;
}

async function download(url, name){
  try {
    const r = await fetch(url, {credentials:"same-origin", headers:{"X-PC":"1"}}); if (!r.ok) throw new Error();
    const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch { toast("Erreur lors de l'export."); }
}

export function AccountSection(){
  const [data, setData] = useState(null), [err, setErr] = useState(""), [email, setEmail] = useState(""), [role, setRole] = useState("contributor"), [invErr, setInvErr] = useState("");
  const [pw0, setPw0] = useState(""), [pw1, setPw1] = useState(""), [pwErr, setPwErr] = useState(""), [delPw, setDelPw] = useState(""), [delErr, setDelErr] = useState(""), [digest, setDigest] = useState(SV.me.weeklyDigest !== false);
  const load = async () => { try { setData(await api("GET", `${hb()}/members`)); } catch (e) { setErr(e.message); } };
  useEffect(() => { load(); }, []);
  const owner = data && data.role === "owner";
  const act = async fn => { try { await fn(); } catch (e) { toast(e.message); } load(); };
  const invite = async () => { setInvErr(""); try { await api("POST", `${hb()}/invites`, {email, role}); setEmail(""); toast("Invitation envoyée"); load(); } catch (e) { setInvErr(e.message); } };
  const removeMember = async m => {
    const self = m.id === SV.me.id; if (!confirm(self ? "Quitter ce foyer ?" : "Retirer l'accès de cette personne ?")) return;
    try { await api("DELETE", `${hb()}/members/${encodeURIComponent(m.id)}`); if (self) { pref.del("pc.srv.hid"); location.href = "/"; return; } toast("Accès retiré"); } catch (e) { toast(e.message); }
    load();
  };
  const setDigestOn = async on => { setDigest(on); try { await api("POST", "/api/me/digest", {on}); SV.me.weeklyDigest = on; toast(on ? "Résumé hebdomadaire activé" : "Résumé hebdomadaire désactivé"); } catch (e) { setDigest(!on); toast(e.message); } };
  const changePw = async () => { setPwErr(""); try { await api("POST", "/api/me/password", {current:pw0, password:pw1}); setPw0(""); setPw1(""); toast("Mot de passe modifié"); } catch (e) { setPwErr(e.message); } };
  const delAccount = async () => {
    if (!confirm("Supprimer définitivement votre compte ? Cette action est irréversible.")) return;
    setDelErr(""); try { await api("DELETE", "/api/me", {password:delPw}); clearSnapshots(); location.href = "/"; } catch (e) { setDelErr(e.message); }
  };
  return <div>
    <div className="field"><span className="lab">Foyer</span><div className="erow"><span className="cn"><b>{SV.hh.name}</b>&nbsp;<span className="muted small">· {(ROLE[SV.role] || "").toLowerCase()}</span></span>
      <button type="button" className="btn sm ghost" onClick={() => { pref.del("pc.srv.hid"); location.href = "/?choisir=1"; }}><Icon name="repeat" />Changer</button></div></div>
    <div className="field"><span className="lab">Accès au foyer</span>
      <div>{err ? <p className="err">{err}</p> : data && <>
        {data.members.map(m => <div className="acc-row" key={m.id}>
          <button type="button" className="tx mview" onClick={() => openDialog("profile", {user:m, editable:m.id === SV.me.id})}><span className="av av26"><Avatar user={m} /></span><span>{m.name || m.email}{m.me ? " (vous)" : ""}<span>{m.email}</span></span></button>
          {owner && !m.me ? <><select aria-label={`Rôle de ${m.name}`} value={m.role} onChange={e => act(async () => { await api("PATCH", `${hb()}/members/${encodeURIComponent(m.id)}`, {role:e.target.value}); toast("Rôle modifié"); })}>
              {Object.entries(ROLE).map(([x, l]) => <option key={x} value={x}>{l}</option>)}</select>
              <button type="button" className="x" aria-label={`Retirer ${m.name}`} onClick={() => removeMember(m)}><Icon name="x" /></button></>
            : <><span className="muted small">{ROLE[m.role]}</span>{m.me && !owner && <button type="button" className="btn sm ghost" onClick={() => removeMember(m)}>Quitter</button>}</>}
        </div>)}
        {data.invites.map(i => <div className="acc-row" key={i.id}><span className="tx">{i.email}<span>Invitation envoyée · {i.role === "viewer" ? "lecteur" : "contributeur"}</span></span>
          <button type="button" className="x" aria-label="Annuler l'invitation" onClick={() => act(async () => { await api("DELETE", `${hb()}/invites/${encodeURIComponent(i.id)}`); toast("Invitation annulée"); })}><Icon name="x" /></button></div>)}
      </>}</div>
      {SV.role === "owner" && <div><div className="erow mt8"><input className="inp" type="email" placeholder="E-mail à inviter" aria-label="E-mail à inviter" value={email} onChange={e => setEmail(e.target.value)} />
        <select aria-label="Rôle" value={role} onChange={e => setRole(e.target.value)}><option value="contributor">Contributeur</option><option value="viewer">Lecteur</option></select></div>
        <button type="button" className="btn sm" onClick={invite}><Icon name="users" />Envoyer l'invitation</button><p className="err mt8 m0b">{invErr}</p></div>}
    </div>
    <div className="field"><span className="lab">Mon compte</span>
      <div className="acc-row"><span className="tx">{SV.me.name || ""}<span>{SV.me.email}</span></span><button type="button" className="btn sm ghost" onClick={logout}>Se déconnecter</button></div>
      <Totp />
      <div className="acc-row"><Check className="check f1 m0" checked={digest} onChange={setDigestOn}>Recevoir chaque lundi un résumé de la semaine par e-mail</Check></div>
      <Push />
      <details className="more"><summary>Changer le mot de passe</summary>
        <input className="inp mb8" type="password" placeholder="Mot de passe actuel" autoComplete="current-password" aria-label="Mot de passe actuel" value={pw0} onChange={e => setPw0(e.target.value)} />
        <input className="inp mb8" type="password" placeholder="Nouveau mot de passe (10 caractères min.)" autoComplete="new-password" aria-label="Nouveau mot de passe" value={pw1} onChange={e => setPw1(e.target.value)} />
        <button type="button" className="btn sm" onClick={changePw}>Enregistrer</button><p className="err mt8 m0b">{pwErr}</p></details>
      <Sessions />
      <details className="more"><summary>Mes données</summary><div className="erow">
        <button type="button" className="btn sm ghost" onClick={() => download("/api/me/export", "dafeuille-mes-donnees.json")}><Icon name="download" />Export complet (JSON)</button>
        <button type="button" className="btn sm ghost" onClick={() => download("/api/me/export.csv", "dafeuille-transactions.csv")}><Icon name="file-spreadsheet" />Transactions (CSV)</button></div></details>
      <details className="more"><summary className="c-danger">Supprimer mon compte</summary>
        <p className="small muted">Cette action est définitive : votre compte, votre profil, vos badges et vos données privées seront supprimés. Un foyer que vous partagez avec d'autres personnes est conservé pour elles ; un foyer dont vous êtes seul·e membre est supprimé avec son contenu.</p>
        <input className="inp my8" type="password" placeholder="Mot de passe actuel" autoComplete="current-password" aria-label="Mot de passe actuel" value={delPw} onChange={e => setDelPw(e.target.value)} />
        <button type="button" className="btn sm danger" onClick={delAccount}>Supprimer définitivement mon compte</button><p className="err mt8 m0b">{delErr}</p></details>
    </div><hr className="sep" /></div>;
}
