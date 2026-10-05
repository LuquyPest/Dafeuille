/* Démarrage : session, liens reçus par e-mail, ouverture du foyer (ou de son instantané hors ligne). */
import { useEffect, useState } from "react";
import { AuthFlow, AuthCard, clearParams } from "./views/Auth.jsx";
import { Shell, Toast } from "./Shell.jsx";
import { PublicGroup } from "./views/PublicGroup.jsx";
import { api, SV, openHousehold, loadSnapshot, loadMeSnapshot, toast } from "./data/store.js";
import { pref, state, bump } from "./lib/core.js";

const params = new URLSearchParams(location.search);

export default function App(){
  const [phase, setPhase] = useState({kind:"boot"});

  const open = async hid => {
    setPhase({kind:"loading"});
    try { await openHousehold(hid); clearParams(); setPhase({kind:"app"}); }
    catch (e) { setPhase({kind:"auth", initial:{view:"households", msg:e.message}}); }
  };

  useEffect(() => { (async () => {
    const e = params.get("e"), reset = params.get("reset"), inv = params.get("invite"), grp = params.get("groupe");
    if (grp) return setPhase({kind:"public", token:grp});
    if (params.get("ok") === "desabonne") setTimeout(() => toast("C'est noté : vous ne recevrez plus le résumé hebdomadaire."), 1200);
    if (reset) return setPhase({kind:"auth", initial:{view:"reset", token:reset}});
    try {
      const r = await api("GET", "/api/me");
      if (r.mfa) return setPhase({kind:"auth", initial:{view:"mfa"}});
      SV.me = r.user; SV.households = r.households;
      if (inv) return setPhase({kind:"auth", initial:{view:"invite", token:inv}});
      if (params.get("choisir")) { clearParams(); return setPhase({kind:"auth", initial:{view:"households"}}); }
      const fresh = params.get("ok") === "verifie" && !params.get("h");
      const want = params.get("h") || (!fresh && pref.get("pc.srv.hid", ""));
      if (want && SV.households.some(x => x.id === want)) return open(want);
      if (SV.households.length === 1 && !fresh) return open(SV.households[0].id);
      setPhase({kind:"auth", initial:{view:"households"}});
    } catch (err) {
      if (inv) return setPhase({kind:"auth", initial:{view:"invite", token:inv}});
      // Pas de réseau mais un instantané de ce foyer sur l'appareil : on ouvre en mode hors ligne.
      const lastHid = pref.get("pc.srv.hid", ""), meSnap = loadMeSnapshot();
      if (err && err.code === "unavailable" && lastHid && meSnap && loadSnapshot(lastHid)) { SV.me = meSnap.user; SV.households = meSnap.households; return open(lastHid); }
      setPhase({kind:"auth", initial:{view:"login", msg:e === "lien" ? "Ce lien n'est plus valable. Demandez-en un nouveau." : ""}});
    }
  })(); }, []);

  useEffect(() => { if (phase.kind !== "app") { state.mode = "loading"; bump(); } }, [phase.kind]);

  if (phase.kind === "public") return <><PublicGroup token={phase.token} /><Toast /></>;
  if (phase.kind === "auth") return <AuthFlow initial={phase.initial} onOpen={open} />;
  if (phase.kind === "app") return <Shell />;
  return <AuthCard><p className="sub" role="status">Chargement…</p></AuthCard>;
}
