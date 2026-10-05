/* Écran de verrouillage par code (propre à l'appareil) : au démarrage et après 2 minutes en arrière-plan. */
import { useEffect, useState } from "react";
import { Icon, Logo } from "./icons.jsx";
import { pref } from "../lib/core.js";
import { hashPin } from "../dialogs/Settings.jsx";
import { closeAllDialogs } from "./Dialog.jsx";

let setLockedExt = null, hiddenAt = 0;
export const isLocked = () => lockedNow;
let lockedNow = false;
function lock(){ if (!pref.get("pc.pin", "")) return; lockedNow = true; setLockedExt && setLockedExt(true); }
document.addEventListener("visibilitychange", () => { if (document.hidden) hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 120000) lock(); });

export function Lock(){
  const [locked, setLocked] = useState(() => (lockedNow = !!pref.get("pc.pin", ""))), [buf, setBuf] = useState(""), [err, setErr] = useState("");
  setLockedExt = setLocked;
  const len = +pref.get("pc.pinlen", "4");
  const tryPin = async p => {
    if ((await hashPin(p)) === pref.get("pc.pin", "")) { lockedNow = false; setLocked(false); setBuf(""); setErr(""); }
    else { setErr("Code incorrect."); setBuf(""); }
  };
  const press = k => {
    if (k === "✓") { tryPin(buf); return; }
    const next = k === "⌫" ? buf.slice(0, -1) : buf.length < 6 ? buf + k : buf;
    setBuf(next); setErr("");
    if (next.length === len && k !== "⌫") tryPin(next);
  };
  useEffect(() => {
    if (!locked) return;
    closeAllDialogs();
    const h = e => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === "Backspace") press("⌫"); else if (e.key === "Enter") press("✓"); };
    document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h);
  });
  if (!locked) return null;
  return <div id="lock"><div className="box">
    <Logo />
    <h2 className="lockh">DAFeuille</h2>
    <div className="pin" aria-live="polite">{"●".repeat(buf.length) + "·".repeat(Math.max(0, len - buf.length))}</div>
    <p className="err lockerr">{err}</p>
    <div className="keys">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"].map(k =>
      <button key={k} type="button" aria-label={k === "⌫" ? "Effacer" : k === "✓" ? "Valider" : k} onClick={() => press(k)}>{k === "⌫" ? <Icon name="delete" /> : k === "✓" ? <Icon name="check" /> : k}</button>)}</div>
  </div></div>;
}
