/* Coquille de l'application : en-tête, onglets, carte de profil, bouton d'ajout, toast. */
import { useEffect, useRef } from "react";
import { Icon, Logo } from "./ui/icons.jsx";
import { useStore, levelInfo } from "./lib/hooks.js";
import { state, pref, bump, HIDE, setHide, todayStr, daysBetween, safeImg, MEMBER_COLORS, setCurrency, keyOf, curKey } from "./lib/core.js";
import { SV, toastState, toast, offq, handleWriteError, onLoaded, onChanged } from "./data/store.js";
import { VIEWS } from "./views/index.js";
import { DialogHost, openDialog, anyDialogOpen } from "./ui/Dialog.jsx";
import { Lock, isLocked } from "./ui/Lock.jsx";
import { openSettings, backup } from "./dialogs/Settings.jsx";
import { openProfile, loadProgress } from "./dialogs/Profile.jsx";
import { pdfYear } from "./dialogs/Exports.jsx";
import { openWrap } from "./dialogs/Guide.jsx";
import "./dialogs/Tools.jsx";
import "./dialogs/Import.jsx";
import { prevKey, nextKey } from "./lib/core.js";
import { flushQueue } from "./data/store.js";
import { generateRecurring } from "./lib/domain.js";
import { openKindChooser, openQuick } from "./dialogs/Money.jsx";
import { openGroup } from "./groups/GroupDialog.jsx";
import { checkNewBadges } from "./lib/badges.js";
import { subscribe } from "./lib/core.js";

/* Badges : vérifiés après chaque changement d'état (regroupés), comme render() → checkNewBadges() à l'origine */
{ let t = null; subscribe(() => { clearTimeout(t); t = setTimeout(checkNewBadges, 800); }); }

/* Après chaque chargement : devise, mois de départ (début de mois personnalisé), dépenses fixes à générer */
let curCurrency = "EUR";
function applyCurrency(){ const c = state.settings.currency || "EUR"; if (c !== curCurrency) { curCurrency = c; setCurrency(c); } }
onLoaded(() => {
  applyCurrency();
  if (!state._msInit) { state._msInit = true; if (state.month === keyOf(new Date())) state.month = curKey(); }
  generateRecurring();
});
onChanged(() => { applyCurrency(); generateRecurring(); });
onLoaded(() => { loadProgress(); });

/* Actions disponibles partout (boutons d'en-tête, raccourcis, panneaux) */
export const ACTIONS = {
  add:openKindChooser, quick:openQuick, addGroup:() => openGroup(null),
  search:() => openDialog("search"), keys:() => openDialog("keys"), export:() => openDialog("export"),
  settings:openSettings, profile:openProfile, leader:() => openDialog("leader"),
  backup:async () => { if (await backup()) toast("Sauvegarde téléchargée."); },
  wrap:y => openWrap(y), pdfYear:async () => { try { await pdfYear(); } catch { toast("L'export PDF a échoué."); } },
};

/* Raccourcis clavier (hors champs de saisie, fenêtres ouvertes et écran verrouillé) */
document.addEventListener("keydown", e => {
  if (e.ctrlKey || e.metaKey || e.altKey || !SV.hh || state.mode === "loading") return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (["input", "textarea", "select"].includes(tag) || e.target.isContentEditable || anyDialogOpen() || document.querySelector("dialog[open]") || isLocked()) return;
  const k = e.key, A = ACTIONS;
  if (k === "n" || k === "N") { e.preventDefault(); if (state.canWrite) A.add(); }
  else if (k === "e" || k === "E") { e.preventDefault(); if (state.canWrite) A.quick(); }
  else if (k === "/") { e.preventDefault(); A.search(); }
  else if (k === "ArrowLeft") { state.month = prevKey(state.month); bump(); }
  else if (k === "ArrowRight") { state.month = nextKey(state.month); bump(); }
  else if (/^[1-6]$/.test(k)) { const t = visibleTabs()[+k - 1]; if (t) setTab(t.id); }
  else if (k === "t" || k === "T") { state.month = keyOf(new Date()); bump(); }
  else if (k === "p" || k === "P") A.profile();
  else if (k === "l" || k === "L") A.leader();
  else if (k === "?") A.keys();
});

/* Tirer vers le bas pour actualiser (mobile) */
function usePullToRefresh(ref){
  useEffect(() => {
    const ind = ref.current; let y0 = null, dy = 0;
    const start = e => { y0 = window.scrollY <= 0 && !document.querySelector("dialog[open]") ? e.touches[0].clientY : null; dy = 0; };
    const move = e => { if (y0 == null) return; dy = e.touches[0].clientY - y0; if (dy > 0) { ind.style.transform = `translate(-50%, ${Math.min(dy, 110) - 60}px) rotate(${dy * 3}deg)`; ind.style.opacity = Math.min(1, dy / 80); } };
    const end = async () => {
      if (y0 == null) return; y0 = null;
      if (dy > 85) { ind.classList.add("spin"); try { navigator.vibrate && pref.get("pc.haptic", "1") === "1" && navigator.vibrate(12); } catch {} try { await flushQueue(); } catch {} bump();
        setTimeout(() => { ind.classList.remove("spin"); ind.style.opacity = 0; ind.style.transform = ""; toast("À jour"); }, 500); }
      else { ind.style.opacity = 0; ind.style.transform = ""; }
    };
    addEventListener("touchstart", start, {passive:true}); addEventListener("touchmove", move, {passive:true}); addEventListener("touchend", end);
    return () => { removeEventListener("touchstart", start); removeEventListener("touchmove", move); removeEventListener("touchend", end); };
  }, []);
}

export const TABS = [
  {id:"budget", label:"Budget", icon:"wallet"},
  {id:"analyse", label:"Analyse", icon:"chart-column"},
  {id:"courses", label:"Courses", icon:"shopping-basket"},
  {id:"projets", label:"Projets", icon:"target"},
  {id:"agenda", label:"Agenda", icon:"calendar"},
  {id:"patrimoine", label:"Patrimoine", icon:"landmark"},
];
/** Onglets visibles, dans l'ordre choisi (préférence pc.tabs2 partagée avec l'ancienne interface). */
export function tabCfg(){
  let c; try { c = JSON.parse(pref.get("pc.tabs2", "null")); } catch {}
  if (!Array.isArray(c)) c = TABS.map(t => ({id:t.id, on:true}));
  TABS.forEach(t => { if (!c.some(x => x.id === t.id)) c.push({id:t.id, on:true}); });
  return c.filter(x => TABS.some(t => t.id === x.id));
}
export const visibleTabs = () => tabCfg().filter(t => t.on || t.id === "budget").map(t => TABS.find(x => x.id === t.id));
export function setTab(id){ state.tab = id; pref.set("pc.tab", id); bump(); }

const idColor = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return MEMBER_COLORS[h % MEMBER_COLORS.length]; };
export function Avatar({ user }){
  const img = user && safeImg(user.avatar);
  if (img) return <img src={img} alt="" />;
  return <span style={{background:idColor(user ? user.id : ""), width:"100%", height:"100%", display:"grid", placeItems:"center", color:"#fff", fontWeight:700}}>{((user && (user.name || user.email)) || "?")[0].toUpperCase()}</span>;
}

function Toast(){
  useStore();
  return (
    <div className={"toast" + (toastState.msg ? " show" : "")} role="status" aria-live="polite">
      <span>{toastState.msg}</span>
      <button type="button" hidden={!toastState.act} onClick={async () => {
        const f = toastState.act; toastState.msg = ""; toastState.act = null; bump();
        if (f) { try { await f(); } catch (e) { handleWriteError(e); } }
      }}>{toastState.actLabel}</button>
    </div>
  );
}

export const houseName = () => state.settings.houseName || (SV.hh && SV.hh.name) || "DAFeuille";
export function statusText(){
  if (state.mode === "loading") return "Connexion…";
  const pend = offq.get().length;
  return (navigator.onLine ? "" : "Hors ligne · ") + (SV.role === "viewer" ? "Lecture seule" : SV.role === "owner" ? "Propriétaire" : "Contributeur")
    + " · " + (SV.me.name || SV.me.email) + (pend ? ` · ${pend} en attente` : "");
}

export function Shell({ actions }){
  useStore();
  const tabs = visibleTabs();
  if (!tabs.some(t => t.id === state.tab)) state.tab = "budget";
  const cur = tabs.find(t => t.id === state.tab), ready = state.mode !== "loading", canEdit = ready && state.canWrite;
  const li = levelInfo(SV.me && SV.me.xp);
  const nShop = state.shop.filter(x => !x.done).length;
  const t0 = todayStr(), nTodo = state.todos.filter(x => !x.done && x.due && daysBetween(t0, x.due) <= 3).length;
  const badge = {courses:nShop, agenda:nTodo};
  useEffect(() => { document.title = (cur ? cur.label + " · " : "") + "DAFeuille"; }, [cur && cur.id]);
  const navRef = useRef(null);
  const onNavKey = e => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const bs = [...navRef.current.querySelectorAll("button")], i = bs.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); const n = bs[(i + (e.key === "ArrowRight" ? 1 : -1) + bs.length) % bs.length]; n.focus(); n.click();
  };
  const View = VIEWS[state.tab];
  const a = {...ACTIONS, ...(actions || {})}, ptrRef = useRef(null);
  usePullToRefresh(ptrRef);
  return (
    <div className="wrap">
      <header className="top">
        <div className="brand"><Logo /><div><b>{houseName()}</b><small>{statusText()}</small></div></div>
        <button className="btn ghost quickdesk" disabled={!canEdit} onClick={a.quick}><Icon name="zap" />Éclair</button>
        <button className="btn addbtn-desk" disabled={!canEdit} onClick={a.add}><Icon name="plus" />Transaction</button>
        <button className="iconbtn" title="Rechercher partout (/)" aria-label="Rechercher partout" onClick={a.search}><Icon name="search" /></button>
        <button className="iconbtn desk-only" title="Raccourcis clavier (?)" aria-label="Raccourcis clavier" onClick={a.keys}><Icon name="keyboard" /></button>
        <button className="iconbtn" title="Masquer les montants" aria-label="Masquer les montants" aria-pressed={HIDE}
          onClick={() => { setHide(!HIDE); bump(); toast(HIDE ? "Montants masqués" : "Montants visibles"); }}><Icon name={HIDE ? "eye-off" : "eye"} /></button>
        <button className="iconbtn" title="Exporter" aria-label="Exporter" hidden={!ready} onClick={a.export}><Icon name="download" /></button>
        <button className="iconbtn" title="Réglages du foyer" aria-label="Réglages du foyer" disabled={!canEdit} onClick={a.settings}><Icon name="settings" /></button>
        <button className="iconbtn" id="acctBtnMobile" title="Mon profil" aria-label="Mon profil" onClick={a.profile}><span className="av" aria-hidden="true"><Avatar user={SV.me} /></span></button>
      </header>

      <div role="navigation" aria-label="Navigation principale">
        <nav className="tabs" role="tablist" aria-label="Sections" ref={navRef} onKeyDown={onNavKey}>
          {tabs.map(t => (
            <button key={t.id} role="tab" id={"tab-" + t.id} aria-controls={"view-" + t.id} aria-selected={t.id === state.tab}
              tabIndex={t.id === state.tab ? 0 : -1} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} />{t.label}{badge[t.id] ? <span className="badge">{badge[t.id]}</span> : null}
            </button>
          ))}
        </nav>
      </div>

      <aside aria-label="Mon compte">
        <button type="button" id="acctChip" aria-label="Mon profil" onClick={a.profile}>
          <span className="av" aria-hidden="true"><Avatar user={SV.me} /></span>
          <span className="who"><b>{SV.me.name || SV.me.email}</b><span>Niveau {li.level} · {li.title}</span></span>
          <Icon name="chevron-right" className="chev" />
        </button>
      </aside>

      <main id="main">
        <h1 className="sr-only">{(cur ? cur.label + " — " : "") + houseName()}</h1>
        <section id={"view-" + state.tab} role="tabpanel" aria-labelledby={"tab-" + state.tab} data-view={state.tab}>
          {View ? <View canEdit={canEdit} ready={ready} actions={a} /> : null}
        </section>
      </main>

      {canEdit && state.tab === "budget" && <>
        <button className="fab" aria-label="Ajouter une transaction" onClick={a.add}><Icon name="plus" /></button>
        <button className="fab2" aria-label="Saisie éclair" onClick={a.quick}><Icon name="zap" /></button>
      </>}
      <Toast />
      <DialogHost />
      <div id="ptr" ref={ptrRef} aria-hidden="true"><Icon name="refresh-cw" /></div>
      <Lock />
    </div>
  );
}
