/* Calculs métier partagés entre les vues : soldes, prévisions, enveloppes, récurrences, corbeille, journal.
   Portage fidèle de l'ancienne interface (mêmes formats de données). */
import { state, pref, bump, KEYWORDS, allCats, catOf, members, memberName, bud, me, sharesOf, eff, todayStr, dstr, keyOf, nextKey, prevKey, parseD,
  pad, daysBetween, norm, inMonth, totalOf, sumBy, periodOf, curKey, bKey, fmt } from "./core.js";
import { store, toast, onWrite } from "../data/store.js";

export const WEEKDAYS = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];

export function savedIn(k){
  let s = 0;
  state.goals.forEach(g => (g.history || []).forEach(h => { if (String(h.date).startsWith(k)) s += h.amount || 0; }));
  return s;
}
export function balancesAll(){
  const bal = {}; members().forEach(m => bal[m.id] = 0);
  state.expenses.forEach(e => {
    if (e.payer === "pot") return;
    const a = eff(e);
    if (e.payer in bal) bal[e.payer] += a;
    Object.entries(sharesOf(e)).forEach(([id, f]) => { if (id in bal) bal[id] -= a * f; });
  });
  state.reimbs.forEach(r => {
    if (r.from in bal) bal[r.from] += r.amount || 0;
    if (r.to in bal) bal[r.to] -= r.amount || 0;
  });
  return bal;
}
export function settlements(bal){
  const cred = [], debt = [];
  Object.entries(bal).forEach(([id, v]) => { const r = Math.round(v); if (r > 0) cred.push({id, v:r}); else if (r < 0) debt.push({id, v:-r}); });
  cred.sort((a, b) => b.v - a.v); debt.sort((a, b) => b.v - a.v);
  const out = []; let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const x = Math.min(debt[i].v, cred[j].v);
    if (x >= 1) out.push({from:debt[i].id, to:cred[j].id, amount:x});
    debt[i].v -= x; cred[j].v -= x;
    if (debt[i].v < 1) i++;
    if (cred[j].v < 1) j++;
  }
  return out;
}
export function forecast(k){
  if (k !== curKey()) return null;
  const p = periodOf(k), t = todayStr();
  const list = inMonth(state.expenses, k).filter(bud);
  const fixed = totalOf(list.filter(e => e.recurringId));
  const variable = totalOf(list.filter(e => !e.recurringId && e.date <= t));
  const day = daysBetween(p.from, t) + 1, days = daysBetween(p.from, p.to) + 1;
  if (day < 3) return null;
  const future = totalOf(list.filter(e => !e.recurringId && e.date > t));
  return Math.round(fixed + variable / day * days + future);
}
export function merchantKey(label){
  const s = String(label || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(cb|carte|paiement|prlv|prelevement|sepa|achat|facture|du|le|la|les|des|de)\b/g, " ")
    .replace(/[0-9*/#.:-]+/g, " ").replace(/\s+/g, " ").trim();
  return s.split(" ").slice(0, 2).join(" ");
}
export function guessCat(label){
  const mk = merchantKey(label), mem = state.settings.merchantCats || {};
  if (mk && mem[mk] && allCats().some(c => c.id === mem[mk])) return mem[mk];
  const s = " " + String(label || "").toLowerCase() + " ";
  for (const [cat, words] of Object.entries(KEYWORDS)) if (words.some(w => s.includes(w))) return cat;
  if (mk) { const hit = state.expenses.find(e => merchantKey(e.label) === mk); if (hit) return catOf(hit.cat).id; }
  return "autre";
}
export function looksDuplicate(amount, date, label){
  const mk = merchantKey(label);
  return state.expenses.find(e => e.date === date && e.amount === amount && (!mk || merchantKey(e.label) === mk));
}
/** Enveloppes : budget disponible d'une catégorie pour un mois, avec report */
export function catAvail(id, k){
  const b = (state.settings.catBudgets || {})[id] || 0, S = state.settings;
  if (!S.envelopes || !S.envStart || !(b > 0) || k <= S.envStart) return {budget:b, carry:0, avail:b};
  let carry = 0, m = S.envStart, guard = 0;
  while (m < k && guard++ < 60) {
    carry += b - totalOf(inMonth(state.expenses, m).filter(e => bud(e) && catOf(e.cat).id === id));
    m = nextKey(m);
  }
  return {budget:b, carry, avail:b + carry};
}
export const subsOf = id => (state.settings.subCats || {})[id] || [];

export function weekStart(d = new Date()){ const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
export function weekStatus(){
  const wb = state.settings.weekBudgets || {}, a = dstr(weekStart()), b = (() => { const x = weekStart(); x.setDate(x.getDate() + 6); return dstr(x); })();
  return Object.entries(wb).filter(([, v]) => v > 0).map(([id, budget]) => ({id, budget,
    spent:totalOf(state.expenses.filter(e => bud(e) && catOf(e.cat).id === id && e.date >= a && e.date <= b))}));
}
export const potBalance = () => state.potmoves.reduce((s, m) => s + (m.kind === "out" ? -1 : 1) * (m.amount || 0), 0) - totalOf(state.expenses.filter(e => e.payer === "pot"));

export function recDesc(r){
  if (r.freq === "week") return "chaque " + WEEKDAYS[parseD(r.startDate || todayStr()).getDay()];
  const e = r.every || 1, d = Math.min(r.day || 1, 28);
  if (e === 1) return `le ${d} du mois`;
  if (e === 12) return `chaque année, le ${d} ${parseD(r.start + "-01").toLocaleDateString("fr-FR", {month:"long"})}`;
  return `tous les ${e} mois, le ${d}`;
}
export const monthlyEq = r => r.freq === "week" ? Math.round(r.amount * 52 / 12) : Math.round(r.amount / (r.every || 1));

export function nextOcc(e){
  if (!e.yearly) return e.date;
  const t = todayStr(), y = new Date().getFullYear(), md = e.date.slice(5);
  let n = `${y}-${md}`; if (n < t) n = `${y + 1}-${md}`; return n;
}
export const upcomingEvents = n => { const t = todayStr(); return state.events.map(e => ({...e, next:nextOcc(e)})).filter(e => e.next >= t).sort((a, b) => a.next.localeCompare(b.next)).slice(0, n); };
export const eventsOn = ds => state.events.filter(e => e.yearly ? e.date.slice(5) === ds.slice(5) && ds >= e.date : e.date === ds);
export function warrantyEnd(w){ const d = parseD(w.date || todayStr()); d.setMonth(d.getMonth() + (w.months || 24)); return dstr(d); }
export function choreDue(c){ if (!c.lastDone) return c.createdDate || todayStr(); const d = parseD(c.lastDone); d.setDate(d.getDate() + (c.freq || 7)); return dstr(d); }
export function choreWho(c){ const w = (c.who || []).filter(id => members().some(m => m.id === id)); return w.length ? w[(c.turn || 0) % w.length] : ""; }
export function chalEval(c){
  const start = c.start, endD = parseD(start); endD.setDate(endD.getDate() + (c.days || 7) - 1);
  const end = dstr(endD), t = todayStr();
  const match = e => bud(e) && e.date >= start && e.date <= end && (!c.cat ? !e.recurringId : catOf(e.cat).id === c.cat) && (!c.word || norm(e.label).includes(norm(c.word)));
  const hits = state.expenses.filter(match);
  if (c.kind === "max") { const spent = totalOf(hits); return {end, spent, done:t > end, ok:spent <= (c.max || 0)}; }
  const bad = new Set(hits.map(e => e.date)), days = [];
  const d = parseD(start);
  for (let i = 0; i < (c.days || 7); i++) { const ds = dstr(d); days.push(ds > t ? "fut" : bad.has(ds) ? "ko" : "ok"); d.setDate(d.getDate() + 1); }
  let streak = 0; for (let i = days.length - 1; i >= 0; i--) { if (days[i] === "fut") continue; if (days[i] === "ok") streak++; else break; }
  return {end, days, streak, okN:days.filter(x => x === "ok").length, koN:days.filter(x => x === "ko").length, done:t > end};
}
export function since(ts){
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "à l'instant"; if (s < 3600) return `il y a ${Math.round(s / 60)} min`; if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  if (s < 7 * 86400) return `il y a ${Math.round(s / 86400)} j`; return new Date(ts).toLocaleDateString("fr-FR", {day:"numeric", month:"short"});
}

/* ---------- Étiquettes ---------- */
export function parseTags(str){
  const out = []; for (const m of String(str || "").matchAll(/#?([\p{L}\p{N}_-]{2,24})/gu)) { const t = m[1].toLowerCase(); if (!out.includes(t)) out.push(t); }
  return out.slice(0, 8);
}
export function allTags(){
  const c = {}; state.expenses.concat(state.privates).forEach(e => (e.tags || []).forEach(t => c[t] = (c[t] || 0) + 1));
  return Object.keys(c).sort((a, b) => c[b] - c[a]);
}

/* ---------- Corbeille, annulation, journal ---------- */
export const LIST_NAMES = {expenses:"Dépense", privates:"Dépense perso", incomes:"Revenu", recurring:"Dépense fixe", goals:"Objectif", shop:"Article de courses", todos:"Facture / tâche",
  projects:"Projet", kids:"Argent de poche", accounts:"Compte", debts:"Crédit", challenges:"Défi", potmoves:"Mouvement de cagnotte", groups:"Groupe d'amis", warranties:"Garantie",
  meters:"Compteur", wishes:"Idée cadeau", meals:"Repas", events:"Événement", papers:"Papier", reimbs:"Remboursement", chores:"Tâche ménagère", inventory:"Placard", health:"Santé", cars:"Véhicule"};
export function itemLabel(list, it){ return it.label || it.name || it.title || it.dish || it.text || (list === "expenses" || list === "privates" ? catOf(it.cat).name : "Élément"); }
export async function toTrash(list, item){
  if (list === "trash" || list === "journal") return;
  const copy = JSON.parse(JSON.stringify(item)); delete copy._l;
  try { await store.upsert("trash", {list, item:copy, label:itemLabel(list, item), amount:item.amount || null, at:Date.now(), by:me() || null}); } catch {}
}
export async function removeWithUndo(list, item, label = "Supprimé", extraUndo){
  await store.remove(list, item.id);
  toTrash(list, item);
  const copy = JSON.parse(JSON.stringify(item)); delete copy._l;
  toast(label, "Annuler", async () => { await store.upsert(list, copy); if (extraUndo) await extraUndo(); toast("Restauré"); });
}
export function logAct(text){
  if (!state.canWrite) return;
  store.upsert("journal", {text:String(text).slice(0, 140), by:me() || null, at:Date.now()}).catch(() => {});
  if (state.journal.length > 250) {
    const old = state.journal.slice().sort((a, b) => a.at - b.at).slice(0, state.journal.length - 200);
    old.forEach(o => store.remove("journal", o.id).catch(() => {}));
  }
}

/* ---------- Dépenses / revenus fixes, cagnotte, argent de poche ---------- */
export const recId = (rid, k) => `rec-${rid}-${k}`;
/** Identifiants déjà écrits pendant cette session (évite les doublons pendant la propagation) */
export const written = new Set();
let genBusy = false, kidBusy = false;
export async function generateRecurring(){
  const L = state.loaded;
  if (!(L.expenses && L.recurring && L.incomes && L.settings) || !state.canWrite || genBusy) return;
  genBusy = true;
  try {
    const now = keyOf(new Date());
    const have = new Set(state.expenses.map(e => e.id).concat(state.incomes.map(e => e.id)));
    const todo = [];
    for (const r of state.recurring) {
      if (!r.start) continue;
      const isInc = r.kind === "income";
      if (r.freq === "week" && !isInc) {
        const d = parseD(r.startDate || r.start + "-01"); let g = 0;
        while (dstr(d) <= todayStr() && g++ < 160) { const ds = dstr(d), id = `rec-${r.id}-${ds}`;
          if (!have.has(id) && !written.has(id) && !(r.skip || []).includes(ds)) todo.push(["expenses", {id, amount:r.amount, label:r.label, cat:r.cat, payer:r.payer, split:r.split || "all", shares:r.shares || null, accountId:r.accountId || null, date:ds, recurringId:r.id, by:r.by || "", createdAt:Date.now()}]);
          d.setDate(d.getDate() + 7); }
        continue;
      }
      let k = r.start, guard = 0;
      while (k <= now && guard++ < 36) {
        const every = r.every || 1;
        if (every > 1 && ((+k.slice(0, 4) - +r.start.slice(0, 4)) * 12 + (+k.slice(5) - +r.start.slice(5))) % every) { k = nextKey(k); continue; }
        const id = recId(r.id, k);
        if (!have.has(id) && !written.has(id) && !(r.skip || []).includes(k)) {
          const date = `${k}-${pad(Math.min(r.day || 1, 28))}`;
          todo.push(isInc
            ? ["incomes", {id, amount:r.amount, label:r.label, who:r.who || "", accountId:r.accountId || null, date, recurringId:r.id, createdAt:Date.now()}]
            : ["expenses", {id, amount:r.amount, label:r.label, cat:r.cat, payer:r.payer, split:r.split || "all", shares:r.shares || null, accountId:r.accountId || null,
                            date, recurringId:r.id, by:r.by || "", createdAt:Date.now()}]);
        }
        k = nextKey(k);
      }
    }
    const pot = state.settings.pot;
    if (pot && pot.enabled && pot.start && state.loaded.potmoves) {
      const haveP = new Set(state.potmoves.map(x => x.id));
      for (const [mid, amt] of Object.entries(pot.monthly || {})) {
        if (!(amt > 0) || !members().some(m => m.id === mid)) continue;
        let k = pot.start, g = 0;
        while (k <= now && g++ < 36) { const id = `pot-${mid}-${k}`; if (!haveP.has(id) && !written.has(id)) todo.push(["potmoves", {id, member:mid, amount:amt, kind:"in", date:`${k}-01`, auto:true, createdAt:Date.now()}]); k = nextKey(k); }
      }
    }
    for (const [list, item] of todo) { written.add(item.id); await store.upsert(list, item); }
  } catch {}
  finally { genBusy = false; }
  generatePocketMoney();
}
async function generatePocketMoney(){
  if (!state.loaded.kids || !state.canWrite || kidBusy) return;
  kidBusy = true;
  try {
    const t = todayStr();
    for (const k of state.kids) {
      if (!(k.weekly > 0) || !k.lastAuto || k.lastAuto >= t) continue;
      const d = parseD(k.lastAuto); d.setDate(d.getDate() + 1);
      const adds = []; let guard = 0;
      while (dstr(d) <= t && guard++ < 400) { if (d.getDay() === (k.day ?? 3)) adds.push({amount:k.weekly, date:dstr(d), label:"Argent de poche"}); d.setDate(d.getDate() + 1); }
      const upd = {...k, lastAuto:t};
      if (adds.length) { upd.balance = (k.balance || 0) + adds.length * k.weekly; upd.history = (k.history || []).concat(adds).slice(-60); }
      await store.upsert("kids", upd);
    }
  } catch {}
  finally { kidBusy = false; }
}

/* ---------- Seuils de budget franchis par une écriture ---------- */
export function budgetLevels(){
  const k = curKey(), list = inMonth(state.expenses, k).filter(bud), out = {}, budget = state.settings.budget || 0;
  if (budget > 0) out._total = {name:"Budget du mois", v:totalOf(list), b:budget};
  const byCat = sumBy(list, e => catOf(e.cat).id);
  Object.entries(state.settings.catBudgets || {}).forEach(([id, b0]) => { if (b0 > 0) out[id] = {name:catOf(id).name, v:byCat[id] || 0, b:catAvail(id, k).avail}; });
  return out;
}
/** Ouvre la fenêtre des budgets (branchée par la vue Budget) */
export const ui = {openBudgets:() => {}};
export function budgetNudge(before){
  const pct = (state.settings.alertPct || 80) / 100, after = budgetLevels(); let best = null;
  for (const [id, a] of Object.entries(after)) {
    const b = before[id] || {v:0, b:a.b}, r0 = b.b > 0 ? b.v / b.b : 0, r1 = a.b > 0 ? a.v / a.b : 1;
    const lvl = r1 >= 1 && r0 < 1 ? 2 : r1 >= pct && r0 < pct ? 1 : 0;
    if (lvl && (!best || lvl > best.lvl)) best = {lvl, a, r1};
  }
  if (!best) return;
  const {a, r1} = best;
  toast(best.lvl === 2 ? `⚠ ${a.name} : budget dépassé de ${fmt(a.v - a.b)}` : `${a.name} : ${Math.round(r1 * 100)} % du budget utilisé · reste ${fmt(a.b - a.v)}`, "Budgets", () => ui.openBudgets());
}

/** Alertes du mois en cours : tableau de {strong, text, backup?} */
export function alertsList(){
  const out = [], k = curKey(), A = (strong, text, extra) => out.push({strong, text, ...extra});
  const pct = (state.settings.alertPct || 80) / 100;
  const list = inMonth(state.expenses, k).filter(bud), total = totalOf(list), budget = state.settings.budget || 0;
  if (budget > 0 && total >= budget) A("Budget du mois dépassé", ` : ${fmt(total)} dépensés sur ${fmt(budget)}.`);
  else if (budget > 0 && total >= budget * pct) A(`${Math.round(total / budget * 100)} % du budget`, ` du mois déjà utilisés (${fmt(budget - total)} restants).`);
  const byCat = sumBy(list, e => catOf(e.cat).id);
  Object.entries(state.settings.catBudgets || {}).forEach(([id, b0]) => {
    const v = byCat[id] || 0; if (!(b0 > 0)) return;
    const b = catAvail(id, k).avail, n = catOf(id).name;
    if (b <= 0) { A(n, " : enveloppe vide ce mois-ci."); return; }
    if (v >= b) A(n, ` : budget dépassé de ${fmt(v - b)}.`);
    else if (v >= b * pct) A(n, ` : ${Math.round(v / b * 100)} % du budget utilisé.`);
  });
  const t = todayStr(), s = n => n > 1 ? "s" : "";
  const late = state.todos.filter(x => !x.done && x.due && x.due < t);
  if (late.length) A(`${late.length} échéance${s(late.length)} dépassée${s(late.length)}`, " dans « À payer ».");
  const soon = state.todos.filter(x => !x.done && x.due && x.due >= t && daysBetween(t, x.due) <= 3);
  if (soon.length) A(`${soon.length} échéance${s(soon.length)}`, " dans les 3 prochains jours.");
  const soonW = state.warranties.filter(w => { const end = warrantyEnd(w); return end >= t && daysBetween(t, end) <= 60; });
  if (soonW.length) A("Garantie", ` bientôt terminée : ${soonW.map(w => w.name).join(", ")}.`);
  const soonP = state.papers.filter(p => p.expiry && daysBetween(t, p.expiry) <= 60);
  if (soonP.length) A("Papiers", ` à renouveler : ${soonP.map(p => p.name + (p.expiry < t ? " (expiré)" : "")).join(", ")}.`);
  const soonE = upcomingEvents(10).filter(e => daysBetween(t, e.next) <= 7);
  if (soonE.length) A("Bientôt", ` : ${soonE.map(e => e.title + " " + (e.next === t ? "aujourd'hui" : parseD(e.next).toLocaleDateString("fr-FR", {weekday:"long", day:"numeric"}))).join(", ")}.`);
  weekStatus().filter(w => w.spent > w.budget).forEach(w => A(catOf(w.id).name, ` : budget de la semaine dépassé (${fmt(w.spent)} / ${fmt(w.budget)}).`));
  const expInv = state.inventory.filter(i => i.expiry && daysBetween(t, i.expiry) <= 3);
  if (expInv.length) A("À consommer vite", ` : ${expInv.slice(0, 4).map(i => i.name + (i.expiry < t ? " (périmé)" : "")).join(", ")}${expInv.length > 4 ? "…" : ""}.`);
  const lateCh = state.chores.filter(c => choreDue(c) < t);
  if (lateCh.length) A("Ménage en retard", ` : ${lateCh.map(c => c.name + " (" + memberName(choreWho(c)) + ")").join(", ")}.`);
  const lastB = +pref.get("pc.lastBackup", "0");
  if (state.expenses.length >= 20 && Date.now() - lastB > 30 * 86400000) A("Sauvegarde", ` : ${lastB ? "la dernière date de plus d'un mois" : "aucune sauvegarde téléchargée sur cet appareil"}. `, {backup:true});
  const oldRef = state.expenses.concat(state.privates).filter(e => e.refund && !e.refund.received && daysBetween(e.date, t) > 30);
  if (oldRef.length) A(`${oldRef.length} remboursement${s(oldRef.length)}`, ` attendu${s(oldRef.length)} depuis plus de 30 jours.`);
  return out;
}

/* ---------- Mise en page de l'onglet Budget (préférence pc.panels partagée) ---------- */
export const PANELS = [["today","Aujourd'hui"],["week","Cette semaine"],["zero","Budget à zéro"],["pot","Cagnotte"],["incomes","Revenus"],["balances","Qui doit quoi"],["refunds","Remboursements attendus"],["fixed","Fixes chaque mois"],["journal","Activité récente"]];
export function panelCfg(){
  let c; try { c = JSON.parse(pref.get("pc.panels", "null")); } catch {}
  if (!Array.isArray(c)) c = PANELS.map(([id]) => ({id, on:true}));
  PANELS.forEach(([id]) => { if (!c.some(x => x.id === id)) c.push({id, on:true}); });
  return c.filter(x => PANELS.some(([id]) => id === x.id));
}
export const panelOn = id => panelCfg().find(p => p.id === id)?.on !== false;

/** Passe sur le mois de la date donnée si besoin (après un ajout) */
export function goToDateMonth(date){ const k = bKey(parseD(date)); if (k !== state.month) { state.month = k; bump(); } }

/* Alerte immédiate quand une rafale d'écritures (d'où qu'elle vienne) fait franchir un seuil de budget */
{
  let before = null, t = null;
  onWrite({
    before:list => { if ((list === "expenses" || list === "privates") && !before) before = budgetLevels(); },
    after:list => { if (list !== "expenses" && list !== "privates") return; clearTimeout(t); t = setTimeout(() => { const b = before; before = null; if (b) budgetNudge(b); }, 400); },
  });
}
