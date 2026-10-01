/* Écrans hors application : connexion, inscription, liens par e-mail, double authentification,
   invitation et choix du foyer. Portage des vues authShow() de l'app d'origine. */
import { useEffect, useState } from "react";
import { Icon, Logo } from "../ui/icons.jsx";
import { api, SV, refreshMe, logout } from "../data/store.js";

const params = new URLSearchParams(location.search);
export const clearParams = () => history.replaceState(null, "", location.pathname);

export function AuthCard({ children, wide }){
  return (
    <div id="auth">
      <div className={"acard" + (wide ? " gpage" : "")}>
        <div className="ahead"><Logo /><b>DAFeuille</b></div>
        {children}
      </div>
    </div>
  );
}
const Msg = ({ text, ok }) => text ? <div className={"msg " + (ok ? "ok" : "ko")} role={ok ? "status" : "alert"}>{text}</div> : null;
function Field({ name, label, type = "text", autoFocus, ...rest }){
  return <div className="field"><label htmlFor={"a_" + name}>{label}</label><input className="inp" id={"a_" + name} name={name} type={type} autoFocus={autoFocus} {...rest} /></div>;
}
/** Formulaire : bouton désactivé pendant l'envoi, message d'erreur sous les champs. */
function Form({ id, onSubmit, submit, children, style, btnClass = "" }){
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  return (
    <form id={id} noValidate style={style} onSubmit={async e => {
      e.preventDefault(); setErr(""); setBusy(true);
      try { await onSubmit(Object.fromEntries(new FormData(e.currentTarget).entries())); }
      catch (x) { setErr((x && x.message) || "Erreur."); }
      finally { setBusy(false); }
    }}>
      {children}
      <p className="err" role="alert">{err}</p>
      <button className={"btn " + btnClass} type="submit" disabled={busy}>{submit}</button>
    </form>
  );
}
const Link = ({ onClick, children }) => <button type="button" className="linkbtn" onClick={onClick}>{children}</button>;

/** Pilote des écrans d'accueil ; appelle onOpen(hid) quand un foyer doit être ouvert. */
export function AuthFlow({ initial, onOpen }){
  const [s, setS] = useState(initial);
  const go = (view, props = {}) => setS({view, ...props});
  const afterLogin = async fresh => {
    await refreshMe();
    const inv = params.get("invite"); if (inv) return go("invite", {token:inv});
    const want = params.get("h") || (!fresh && localStorage.getItem("pc.srv.hid"));
    if (want && SV.households.some(x => x.id === want)) return onOpen(want);
    if (SV.households.length === 1 && !fresh) return onOpen(SV.households[0].id);
    go("households");
  };
  switch (s.view) {
    case "login": return (
      <AuthCard>
        <h1>Connexion</h1><p className="sub">Retrouvez vos foyers et vos comptes.</p><Msg text={s.msg} ok={s.ok} />
        <Form id="fLogin" submit="Se connecter" onSubmit={async v => { const r = await api("POST", "/api/auth/login", v); if (r.mfa) go("mfa"); else await afterLogin(true); }}>
          <Field name="email" label="E-mail" type="email" autoComplete="email" required autoFocus />
          <Field name="password" label="Mot de passe" type="password" autoComplete="current-password" required />
        </Form>
        <div className="alt"><Link onClick={() => go("magic")}>Recevoir un lien de connexion par e-mail</Link><Link onClick={() => go("forgot")}>Mot de passe oublié</Link><Link onClick={() => go("signup")}>Créer un compte</Link></div>
      </AuthCard>);
    case "signup": return (
      <AuthCard>
        <h1>Créer un compte</h1><p className="sub">{s.invite ? "Votre compte rejoindra automatiquement le foyer qui vous invite." : "Un e-mail de confirmation vous sera envoyé."}</p>
        <Form id="fSignup" submit="Créer mon compte" onSubmit={async v => {
          if (v.password !== v.password2) throw {message:"Les deux mots de passe ne correspondent pas."};
          await api("POST", "/api/auth/signup", {name:v.name, email:v.email, password:v.password, invite:s.invite || undefined});
          go("sent", {email:v.email, title:"Confirmez votre adresse", text:"Ouvrez l'e-mail que nous venons d'envoyer et touchez « Confirmer mon adresse »."});
        }}>
          <Field name="name" label="Prénom" autoComplete="given-name" maxLength={60} autoFocus />
          <Field name="email" label="E-mail" type="email" autoComplete="email" required defaultValue={s.email || ""} />
          <Field name="password" label="Mot de passe (10 caractères minimum)" type="password" autoComplete="new-password" required minLength={10} />
          <Field name="password2" label="Confirmer le mot de passe" type="password" autoComplete="new-password" required />
        </Form>
        <div className="alt"><Link onClick={() => go("login")}>J'ai déjà un compte</Link></div>
      </AuthCard>);
    case "sent": return (
      <AuthCard><h1>{s.title}</h1><p className="sub">{s.text}</p><div className="msg ok">{s.email}</div><div className="alt"><Link onClick={() => go("login")}>Retour à la connexion</Link></div></AuthCard>);
    case "magic": return (
      <AuthCard>
        <h1>Lien de connexion</h1><p className="sub">Recevez un lien valable 15 minutes, sans mot de passe.</p>
        <Form id="fMagic" submit="Envoyer le lien" onSubmit={async v => { await api("POST", "/api/auth/magic", v); go("sent", {email:v.email, title:"Vérifiez vos e-mails", text:"Si un compte existe, un lien de connexion vient d'être envoyé."}); }}>
          <Field name="email" label="E-mail" type="email" autoComplete="email" required autoFocus />
        </Form>
        <div className="alt"><Link onClick={() => go("login")}>Retour</Link></div>
      </AuthCard>);
    case "forgot": return (
      <AuthCard>
        <h1>Mot de passe oublié</h1><p className="sub">Nous vous enverrons un lien pour en choisir un nouveau.</p>
        <Form id="fForgot" submit="Envoyer" onSubmit={async v => { await api("POST", "/api/auth/forgot", v); go("sent", {email:v.email, title:"Vérifiez vos e-mails", text:"Si un compte existe, un lien de réinitialisation vient d'être envoyé."}); }}>
          <Field name="email" label="E-mail" type="email" autoComplete="email" required autoFocus />
        </Form>
        <div className="alt"><Link onClick={() => go("login")}>Retour</Link></div>
      </AuthCard>);
    case "reset": return (
      <AuthCard>
        <h1>Nouveau mot de passe</h1><p className="sub">10 caractères minimum.</p>
        <Form id="fReset" submit="Enregistrer" onSubmit={async v => {
          if (v.password !== v.password2) throw {message:"Les deux mots de passe ne correspondent pas."};
          await api("POST", "/api/auth/reset", {token:s.token, password:v.password}); clearParams(); go("login", {msg:"Mot de passe modifié. Connectez-vous.", ok:true});
        }}>
          <Field name="password" label="Nouveau mot de passe" type="password" autoComplete="new-password" required autoFocus />
          <Field name="password2" label="Confirmer" type="password" autoComplete="new-password" required />
        </Form>
      </AuthCard>);
    case "mfa": return (
      <AuthCard>
        <h1>Double authentification</h1><p className="sub">Saisissez le code à 6 chiffres de votre application, ou un code de secours.</p>
        <Form id="fMfa" submit="Valider" onSubmit={async v => { await api("POST", "/api/auth/mfa", v); await afterLogin(true); }}>
          <Field name="code" label="Code" inputMode="numeric" autoComplete="one-time-code" required className="inp code" autoFocus />
        </Form>
        <div className="alt"><Link onClick={async () => { await api("POST", "/api/auth/logout").catch(() => {}); go("login"); }}>Annuler</Link></div>
      </AuthCard>);
    case "invite": return <Invite token={s.token} go={go} onOpen={onOpen} />;
    case "households": return <Households msg={s.msg} onOpen={onOpen} />;
    default: return <AuthCard><p className="sub">Chargement…</p></AuthCard>;
  }
}

function Invite({ token, go, onOpen }){
  const [info, setInfo] = useState(null), [err, setErr] = useState("");
  useEffect(() => { api("GET", "/api/invites/" + encodeURIComponent(token)).catch(() => ({valid:false})).then(i => {
    if (!i.valid) { clearParams(); return SV.me ? go("households", {msg:"Cette invitation n'est plus valable."}) : go("login", {msg:"Cette invitation n'est plus valable."}); }
    if (!SV.me) return i.hasAccount ? go("login", {msg:`${i.inviter || "Quelqu'un"} vous invite dans « ${i.household} ». Connectez-vous avec ${i.email} pour rejoindre le foyer.`, ok:true}) : go("signup", {invite:token, email:i.email});
    setInfo(i);
  }); }, [token]);
  if (!info) return <AuthCard><p className="sub">Chargement…</p></AuthCard>;
  return (
    <AuthCard>
      <h1>Invitation</h1>
      <p className="sub"><b>{info.inviter || "Quelqu'un"}</b> vous invite à rejoindre <b>{info.household}</b> en tant que {info.role === "viewer" ? "lecteur" : "contributeur"}.</p>
      <p className="err" role="alert">{err}</p>
      <button className="btn" onClick={async () => { try { const r = await api("POST", `/api/invites/${encodeURIComponent(token)}/accept`); clearParams(); await refreshMe(); onOpen(r.hid); } catch (e) { setErr(e.message); } }}>Rejoindre le foyer</button>
      <div className="alt"><Link onClick={() => { clearParams(); go("households"); }}>Plus tard</Link></div>
    </AuthCard>
  );
}

const ROLE_FR = {owner:"Propriétaire", contributor:"Contributeur", viewer:"Lecteur"};
function Households({ msg, onOpen }){
  return (
    <AuthCard>
      <h1>Bonjour{SV.me && SV.me.name ? " " + SV.me.name : ""}</h1>
      <p className="sub">{SV.households.length ? "Choisissez un foyer." : "Créez votre premier foyer, ou attendez une invitation."}</p>
      <Msg text={msg} />
      {SV.households.map(x => (
        <button key={x.id} className="hh" onClick={() => onOpen(x.id)}>
          <span className="tile"><Icon name={x.role === "viewer" ? "eye" : "house"} /></span>
          <span style={{flex:1}}><b>{x.name}</b><span>{ROLE_FR[x.role] || x.role} · {x.members} membre{x.members > 1 ? "s" : ""}</span></span>
          <Icon name="chevron-right" />
        </button>
      ))}
      <Form id="fNewHh" style={{marginTop:14}} btnClass={SV.households.length ? "ghost" : ""} submit={<><Icon name="plus" />Créer le foyer</>} onSubmit={async v => {
        if (!String(v.name || "").trim()) throw {message:"Donnez un nom au foyer."};
        const r = await api("POST", "/api/households", {name:v.name}); await refreshMe(); onOpen(r.id);
      }}>
        <Field name="name" label="Nouveau foyer" placeholder="ex. Famille Martin" maxLength={40} />
      </Form>
      <div className="alt"><Link onClick={logout}>Se déconnecter</Link></div>
    </AuthCard>
  );
}
