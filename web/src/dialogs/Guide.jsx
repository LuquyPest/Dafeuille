/* Premier lancement (4 étapes), visite guidée des onglets et récap de l'année (« wrapped »). */
import { useEffect, useRef, useState } from "react";
import { openDialog, registerDialog, useModal } from "../ui/Dialog.jsx";
import { Icon } from "../ui/icons.jsx";
import { Chips, Field } from "../ui/bits.jsx";
import { state, pref, bump, MEMBER_COLORS, DEFAULT_SETTINGS, uid, parseAmount, parseNum, todayStr, fmt, fmtDay, monthLabel, daysBetween, catOf, bud, eff, totalOf, sumBy } from "../lib/core.js";
import { store, toast, handleWriteError, onLoaded } from "../data/store.js";
import { merchantKey } from "../lib/domain.js";
import { badgeList } from "../lib/badges.js";

/** <dialog> natif sans en-tête standard */
function Bare({ onClose, label, children, className = "" }){
  const [ref, open] = useModal();
  return <dialog ref={ref} className={className} aria-labelledby={label} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) onClose(); }}>{open && children}</dialog>;
}
const Steps = ({ n, cur }) => <div className="steps">{Array.from({length:n}, (_, i) => <i key={i} className={i < cur ? "on" : ""} />)}</div>;

const OnbArt = () => <svg viewBox="0 0 320 150" className="onb-art" aria-hidden="true"><defs><linearGradient id="oa" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style={{stopColor:"var(--accent)"}} /><stop offset="1" style={{stopColor:"var(--accent-2)"}} /></linearGradient></defs>
  <rect x="20" y="20" width="280" height="120" rx="28" fill="var(--accent-soft)" />
  <circle cx="80" cy="70" r="20" fill="url(#oa)" opacity=".9" /><path d="M52 124a28 24 0 0 1 56 0z" fill="url(#oa)" opacity=".9" />
  <circle cx="240" cy="70" r="20" fill="url(#oa)" opacity=".55" /><path d="M212 124a28 24 0 0 1 56 0z" fill="url(#oa)" opacity=".55" />
  <g transform="translate(130 28) scale(1.5)"><path d="M10.5 29.5C8.8 17.8 17.2 8.4 31 8.9c.5 13.8-8.8 22.3-20.5 20.6z" fill="url(#oa)" /><path d="M11.5 28.5 16.4 21.2 19.6 23.4 26 14.6" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M10.5 29.5l-2.6 2.6" stroke="url(#oa)" strokeWidth="2.2" strokeLinecap="round" /></g>
  <circle cx="120" cy="40" r="7" fill="url(#oa)" opacity=".5" /><circle cx="204" cy="32" r="5" fill="url(#oa)" opacity=".4" /></svg>;

/* ---------- Premier lancement ---------- */
function OnboardingDialog({ onClose }){
  const [o, setO] = useState({step:1, members:[{id:uid(), name:""}, {id:uid(), name:""}], budget:"", courses:"", split:"eq", weights:{}, me:"", accName:"Compte courant", accBal:"", err:""});
  const set = p => setO(x => ({...x, ...(typeof p === "function" ? p(x) : p)}));
  const ms = o.members.map(m => ({...m, name:m.name.trim().slice(0, 30)})).filter(m => m.name);
  const finish = async weights => {
    const accBal = o.accBal.trim() ? parseAmount(o.accBal) : 0;
    if (!state.accounts.length && !Number.isFinite(accBal)) return set({err:"Le solde doit être un montant, par exemple 1250."});
    const members = ms.map((m, i) => ({id:m.id, name:m.name, weight:weights[m.id], color:MEMBER_COLORS[i % MEMBER_COLORS.length]}));
    const budget = parseAmount(o.budget) || 0, courses = parseAmount(o.courses) || 0;
    try {
      await store.saveSettings({...DEFAULT_SETTINGS, ...state.settings, members, budget, catBudgets:courses ? {courses} : {}, onboarded:true});
      if (!state.accounts.length) await store.upsert("accounts", {name:(o.accName.trim() || "Compte courant").slice(0, 40), type:"courant", balance:accBal, createdAt:Date.now(), updatedAt:Date.now(), history:[{balance:accBal, date:todayStr()}]});
      const meId = o.me || ms[0]?.id; if (meId) pref.set("pc.me", meId);
      pref.set("pc.onb", "done"); onClose(); toast("Foyer prêt !"); setTimeout(() => openDialog("tour"), 500);
    } catch (e) { handleWriteError(e); }
  };
  const next = () => {
    set({err:""});
    if (o.step === 1) { if (!ms.length) return set({err:"Indiquez au moins un prénom."}); return set(x => ({step:2, me:x.me || ms[0].id, weights:Object.fromEntries(ms.map(m => [m.id, String(Math.round(100 / ms.length))]))})); }
    if (o.step === 2) {
      const b = o.budget.trim(), c = o.courses.trim();
      if ((b && !(parseAmount(b) >= 0)) || (c && !(parseAmount(c) >= 0))) return set({err:"Les budgets doivent être des montants, par exemple 1800."});
      return set({step:3});
    }
    let weights = {};
    if (o.split === "custom" && ms.length > 1) {
      ms.forEach(m => weights[m.id] = parseNum(o.weights[m.id]) || 0);
      const s = Object.values(weights).reduce((a, x) => a + x, 0);
      if (s <= 0) return set({err:"Indiquez la part de chacun."});
      Object.keys(weights).forEach(k => weights[k] = Math.round(weights[k] / s * 1000) / 10);
    } else ms.forEach(m => weights[m.id] = Math.round(1000 / ms.length) / 10);
    if (o.step === 3) { if (state.accounts.length) return finish(weights); return set({step:4, finalWeights:weights}); }
    finish(o.finalWeights || weights);
  };
  const skip = () => { pref.set("pc.onb", "done"); onClose(); };
  return <Bare onClose={skip} label="onbTitle">
    <form className="sheet" noValidate onSubmit={e => { e.preventDefault(); next(); }}>
      <Steps n={4} cur={o.step} />
      {o.step === 1 && <div><OnbArt /><h2 id="onbTitle">Qui compose le foyer ?</h2>
        <div>{o.members.map((m, i) => <div className="erow" key={m.id}><input className="inp" value={m.name} maxLength={30} placeholder={`Prénom ${i + 1}`} aria-label={`Prénom ${i + 1}`} autoFocus={i === 0}
          onChange={e => set(x => ({members:x.members.map((y, j) => j === i ? {...y, name:e.target.value} : y)}))} /></div>)}</div>
        <button type="button" className="linkbtn" onClick={() => { if (o.members.length < 8) set(x => ({members:x.members.concat({id:uid(), name:""})})); }}>+ Ajouter une personne</button></div>}
      {o.step === 2 && <div><h2 id="onbTitle">Quel budget par mois ?</h2>
        <Field label="Budget total du foyer (€)" htmlFor="onbBudget"><input className="inp" id="onbBudget" inputMode="decimal" placeholder="ex. 1800 — facultatif" autoFocus value={o.budget} onChange={e => set({budget:e.target.value})} /></Field>
        <Field label="Dont courses (€)" htmlFor="onbCourses"><input className="inp" id="onbCourses" inputMode="decimal" placeholder="facultatif" value={o.courses} onChange={e => set({courses:e.target.value})} /></Field></div>}
      {o.step === 3 && <div><h2 id="onbTitle">Comment partagez-vous ?</h2>
        {ms.length >= 2 && <Chips className="chips mb12" value={o.split} onChange={v => set({split:v})} items={[{id:"eq", label:"À parts égales"}, {id:"custom", label:"Selon nos revenus"}]} label="Partage" />}
        {o.split === "custom" && ms.length >= 2 && <div>{ms.map(m => <div className="erow" key={m.id}><span className="cn">{m.name}</span>
          <input className="inp r w" inputMode="decimal" aria-label={`Part de ${m.name} en %`} value={o.weights[m.id] ?? ""} onChange={e => set(x => ({weights:{...x.weights, [m.id]:e.target.value}}))} /><span>%</span></div>)}</div>}
        <Field label="Et vous, sur cet appareil, vous êtes…"><Chips value={o.me} onChange={v => set({me:v})} items={ms.map(m => ({id:m.id, label:m.name}))} label="Vous êtes" /></Field></div>}
      {o.step === 4 && <div><h2 id="onbTitle">Votre compte principal</h2>
        <p className="small muted mb12">Chaque dépense est rattachée à un compte : on en crée un tout de suite pour pouvoir commencer. Vous pourrez en ajouter d'autres dans Patrimoine.</p>
        <Field label="Nom du compte" htmlFor="onbAccName"><input className="inp" id="onbAccName" maxLength={40} value={o.accName} onChange={e => set({accName:e.target.value})} /></Field>
        <Field label="Solde actuel (€)" htmlFor="onbAccBal"><input className="inp" id="onbAccBal" inputMode="decimal" placeholder="ex. 1250 — facultatif" autoFocus value={o.accBal} onChange={e => set({accBal:e.target.value})} /></Field></div>}
      <p className="err" role="alert">{o.err}</p>
      <div className="actions"><button type="button" className="btn sm ghost" onClick={skip}>Passer</button>
        {o.step > 1 && <button type="button" className="btn sm ghost" onClick={() => set(x => ({step:x.step - 1, err:""}))}>Retour</button>}
        <button type="submit" className="btn push">{o.step === 4 ? "C'est parti" : "Suivant"}</button></div>
    </form>
  </Bare>;
}
let onbShown = false;
onLoaded(() => {
  if (onbShown || !state.canWrite) return;
  if (state.settingsExists || state.expenses.length || pref.get("pc.onb", "") === "done") return;
  onbShown = true; setTimeout(() => openDialog("onboarding"), 300);
});

/* ---------- Visite guidée ---------- */
const TOUR = [
  {tab:"budget", t:"Budget", x:"Votre mois en un coup d'œil. Ajoutez une dépense avec +, ou en trois secondes avec la saisie éclair."},
  {tab:"budget", t:"Qui doit quoi", x:"L'équilibre entre vous, calculé selon les parts de chacun. Glissez une dépense vers la gauche pour la supprimer."},
  {tab:"analyse", t:"Analyse", x:"Évolution, répartition, comparaisons et simulations."},
  {tab:"courses", t:"Courses", x:"Liste partagée, menus de la semaine et placards."},
  {tab:"projets", t:"Projets", x:"Épargne, défis, voyages, argent de poche et comptes entre amis."},
  {tab:"agenda", t:"Agenda", x:"Factures, ménage, santé, anniversaires et papiers."},
  {tab:"patrimoine", t:"Patrimoine", x:"Comptes, crédits, garanties, voiture et énergie."},
  {tab:"projets", t:"Comptes entre amis", x:"Un week-end, une colocation ? Créez un groupe et partagez son lien : vos amis ajoutent leurs dépenses sans compte, l'appli calcule qui doit quoi."},
  {tab:"budget", t:"Badges, XP et classement", x:"Chaque action vous rapporte de l'expérience. Retrouvez vos badges et le classement depuis votre profil (en bas de la barre latérale, ou l'avatar en haut sur mobile)."},
  {tab:"budget", desk:true, t:"Astuce", x:"Sur ordinateur, appuyez sur ? pour voir tous les raccourcis clavier : N pour une transaction, / pour rechercher partout."},
];
function TourDialog({ onClose }){
  // l'astuce « raccourcis clavier » n'a de sens qu'avec un vrai clavier et une souris
  const [tour] = useState(() => TOUR.filter(s => !s.desk || matchMedia("(hover: hover) and (pointer: fine)").matches)), [i, setI] = useState(0);
  const s = tour[i], last = i === tour.length - 1;
  useEffect(() => { state.tab = s.tab; bump(); }, [i]);
  const end = tab => { onClose(); state.tab = tab; pref.set("pc.tab", tab); bump(); };
  return <Bare onClose={() => end("budget")} label="tourTitle"><div className="sheet">
    <div className="steps">{tour.map((_, j) => <i key={j} className={j <= i ? "on" : ""} />)}</div>
    <h2 id="tourTitle">{s.t}</h2><p className="tour-step">{s.x}</p>
    <div className="actions">{!last && <button type="button" className="btn sm ghost" onClick={() => end("budget")}>Terminer</button>}
      {i > 0 && <button type="button" className="btn sm ghost" onClick={() => setI(i - 1)}>Précédent</button>}
      <button type="button" className="btn push" autoFocus onClick={() => last ? end("budget") : setI(i + 1)}>{last ? "Terminer" : "Suivant"}</button></div>
  </div></Bare>;
}

/* ---------- Récap de l'année ---------- */
function buildWrap(y){
  const l = state.expenses.filter(e => String(e.date).startsWith(String(y)) && bud(e)); if (!l.length) return [];
  const t = totalOf(l), byC = Object.entries(sumBy(l, e => catOf(e.cat).id)).sort((a, b) => b[1] - a[1]);
  const byMk = {}; l.forEach(e => { const k = merchantKey(e.label); if (k) (byMk[k] = byMk[k] || []).push(e); });
  const topM = Object.values(byMk).sort((a, b) => b.length - a.length)[0], big = l.slice().sort((a, b) => eff(b) - eff(a))[0];
  const byMo = sumBy(l, e => e.date.slice(0, 7)), mos = Object.entries(byMo).sort((a, b) => a[1] - b[1]);
  const days = new Set(l.filter(e => !e.recurringId).map(e => e.date)), last = String(y) === String(new Date().getFullYear()) ? todayStr() : `${y}-12-31`;
  const nDays = daysBetween(`${y}-01-01`, last) + 1, free = nDays - days.size;
  let saved = 0; state.goals.forEach(g => (g.history || []).forEach(h => { if (String(h.date).startsWith(String(y))) saved += h.amount || 0; }));
  const s = [
    ["calendar", `Votre année ${y}`, `${l.length} dépenses enregistrées`, "Prêts pour le récap ?"],
    ["wallet", fmt(t), "dépensés au total", `soit ${fmt(t / Math.max(1, Object.keys(byMo).length))} par mois en moyenne`],
    [catOf(byC[0][0]).ico || "tag", catOf(byC[0][0]).name, `premier poste : ${fmt(byC[0][1])}`, `${Math.round(byC[0][1] / t * 100)} % de votre budget`],
  ];
  if (topM) s.push(["store", topM[0].label, `votre adresse préférée : ${topM.length} passages`, `pour ${fmt(totalOf(topM))} au total`]);
  s.push(["flame", fmt(eff(big)), "votre plus grosse dépense", `${big.label || catOf(big.cat).name}, le ${fmtDay(big.date, {day:"numeric", month:"long"})}`]);
  if (mos.length > 1) s.push(["trending-down", monthLabel(mos[0][0]).split(" ")[0], `votre mois le plus sobre (${fmt(mos[0][1])})`, `et le plus chargé : ${monthLabel(mos[mos.length - 1][0]).split(" ")[0]} (${fmt(mos[mos.length - 1][1])})`]);
  s.push(["sun", String(free), "jours sans aucune dépense", free > nDays / 3 ? "Belle maîtrise !" : "Chaque jour sans dépense compte."]);
  if (saved > 0) s.push(["piggy-bank", fmt(saved), "mis de côté cette année", "Bravo pour cet effort."]);
  const gotB = badgeList().filter(b => b.ok).length;
  s.push(["medal", `${gotB} badge${gotB > 1 ? "s" : ""}`, "débloqués", "Rendez-vous l'an prochain pour faire encore mieux !"]);
  return s;
}
export function openWrap(y){ const slides = buildWrap(y); if (!slides.length) { toast(`Aucune dépense en ${y}.`); return; } openDialog("wrap", {slides}); }
function WrapDialog({ slides, onClose }){
  const [i, setI] = useState(0), [e, big, a, b] = slides[i], last = i === slides.length - 1;
  return <Bare onClose={onClose} label="wrapTitle"><div className="sheet">
    <div className="sheet-head"><h2 id="wrapTitle">Votre année</h2><button type="button" className="linkbtn" onClick={onClose}>Fermer</button></div>
    <div className="steps">{slides.map((_, j) => <i key={j} className={j <= i ? "on" : ""} />)}</div>
    <div className="wrap-slide" aria-live="polite"><div className="tile"><Icon name={e} /></div><div className="big">{big}</div><div className="wrap-a">{a}</div><div className="muted">{b}</div></div>
    <div className="actions">{i > 0 && <button type="button" className="btn sm ghost" onClick={() => setI(i - 1)}>Précédent</button>}
      <button type="button" className="btn push" autoFocus onClick={() => last ? onClose() : setI(i + 1)}>{last ? "Fermer" : "Suivant"}</button></div>
  </div></Bare>;
}

registerDialog("onboarding", OnboardingDialog);
registerDialog("tour", TourDialog);
registerDialog("wrap", WrapDialog);
