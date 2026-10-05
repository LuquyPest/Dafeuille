/* Badges du foyer : conditions (identiques au serveur et à l'ancienne interface) et déblocage. */
import { state, pref, curKey, prevKey, inMonth, bud, totalOf, dstr } from "./core.js";
import { SV, api, toast } from "../data/store.js";
import { savedIn, chalEval } from "./domain.js";
import { groupBalances } from "../groups/Summary.jsx";
import { levelInfo } from "./hooks.js";

export function badgeList(){
  const nowK = curKey(), b = state.settings.budget || 0, E = state.expenses;
  const monthsUnder = (() => { let n = 0, best = 0, k = prevKey(nowK); for (let i = 0; i < 24; i++) { const l = inMonth(E, k).filter(bud); if (b && l.length && totalOf(l) <= b) { n++; best = Math.max(best, n); } else n = 0; k = prevKey(k); } return best; })();
  const saveStreak = (() => { let n = 0, best = 0, k = prevKey(nowK); for (let i = 0; i < 24; i++) { if (savedIn(k) > 0) { n++; best = Math.max(best, n); } else n = 0; k = prevKey(k); } return best; })();
  const noSpendWeek = (() => { const days = new Set(E.filter(e => !e.recurringId).map(e => e.date)); if (!days.size) return false; const d = new Date(); let run = 0; for (let i = 0; i < 365; i++) { if (days.has(dstr(d))) run = 0; else if (++run >= 7) return true; d.setDate(d.getDate() - 1); } return false; })();
  const chalDone = c => { const r = chalEval(c); return r.done && (c.kind === "max" ? r.ok : r.koN === 0); };
  const fillups = state.cars.reduce((s, c) => s + (c.entries || []).filter(e => e.kind === "plein").length, 0);
  return [
    {id:"premier_pas", icon:"sprout", name:"Premier pas", desc:"Enregistrer une dépense", xp:10, ok:E.length >= 1},
    {id:"centurion_100", icon:"list-checks", name:"Centurion", desc:"100 dépenses enregistrées", xp:60, ok:E.length >= 100},
    {id:"centurion_500", icon:"medal", name:"Vétéran du grand livre", desc:"500 dépenses enregistrées", xp:150, ok:E.length >= 500},
    {id:"centurion_1000", icon:"trophy", name:"Légende du budget", desc:"1000 dépenses enregistrées", xp:300, ok:E.length >= 1000},
    {id:"banquier", icon:"landmark", name:"Banquier", desc:"Importer un relevé bancaire", xp:20, ok:E.some(e => e.imported)},
    {id:"dans_les_clous", icon:"target", name:"Dans les clous", desc:"Un mois complet sous le budget", xp:30, ok:monthsUnder >= 1},
    {id:"regularite_3", icon:"award", name:"Régularité", desc:"3 mois d'affilée sous le budget", xp:80, ok:monthsUnder >= 3},
    {id:"regularite_6", icon:"trophy", name:"Discipline de fer", desc:"6 mois d'affilée sous le budget", xp:150, ok:monthsUnder >= 6},
    {id:"regularite_12", icon:"star", name:"Un an sans dérailler", desc:"12 mois d'affilée sous le budget", xp:300, ok:monthsUnder >= 12},
    {id:"fourmi_3", icon:"piggy-bank", name:"Fourmi", desc:"Épargner 3 mois d'affilée", xp:60, ok:saveStreak >= 3},
    {id:"fourmi_12", icon:"coins", name:"Petit trésor", desc:"Épargner 12 mois d'affilée", xp:200, ok:saveStreak >= 12},
    {id:"objectif_atteint", icon:"party-popper", name:"Objectif atteint", desc:"Atteindre un objectif d'épargne", xp:50, ok:state.goals.some(g => g.target && g.saved >= g.target)},
    {id:"objectif_x5", icon:"star", name:"Collectionneur d'objectifs", desc:"Atteindre 5 objectifs d'épargne", xp:150, ok:state.goals.filter(g => g.target && g.saved >= g.target).length >= 5},
    {id:"defi_releve", icon:"flame", name:"Défi relevé", desc:"Réussir un défi d'économie", xp:40, ok:state.challenges.some(chalDone)},
    {id:"semaine_zen", icon:"sun", name:"Semaine zen", desc:"7 jours d'affilée sans dépense (hors fixes)", xp:40, ok:noSpendWeek},
    {id:"prudent", icon:"save", name:"Prudent", desc:"Télécharger une sauvegarde", xp:15, ok:+pref.get("pc.lastBackup", "0") > 0},
    {id:"premiere_course", icon:"shopping-basket", name:"Première liste", desc:"Ajouter un article à la liste de courses", xp:10, ok:state.shop.length >= 1},
    {id:"course_50", icon:"store", name:"Habitué du magasin", desc:"50 articles de courses ajoutés", xp:30, ok:state.shop.length >= 50},
    {id:"anti_gaspi", icon:"apple", name:"Anti-gaspi", desc:"10 articles suivis dans l'inventaire", xp:20, ok:state.inventory.length >= 10},
    {id:"garde_manger", icon:"refrigerator", name:"Garde-manger plein", desc:"30 articles suivis dans l'inventaire", xp:50, ok:state.inventory.length >= 30},
    {id:"bien_range", icon:"folder-open", name:"Bien rangé", desc:"3 papiers importants notés", xp:20, ok:state.papers.length >= 3},
    {id:"menage_fait", icon:"spray-can", name:"Ménage à jour", desc:"5 tâches de ménage suivies", xp:20, ok:state.chores.length >= 5},
    {id:"chef", icon:"chef-hat", name:"Chef", desc:"Planifier 7 repas", xp:20, ok:state.meals.length >= 7},
    {id:"gourmet", icon:"utensils", name:"Gourmet", desc:"Planifier 30 repas", xp:60, ok:state.meals.length >= 30},
    {id:"planificateur", icon:"calendar-days", name:"Planificateur", desc:"5 événements à l'agenda", xp:20, ok:state.events.length >= 5},
    {id:"facture_suivie", icon:"clipboard-list", name:"Papiers en règle", desc:"5 factures ou tâches suivies", xp:20, ok:state.todos.length >= 5},
    {id:"projet_lance", icon:"compass", name:"Grand projet", desc:"Créer un projet", xp:15, ok:state.projects.length >= 1},
    {id:"multi_projets", icon:"layout-grid", name:"Multi-tâches", desc:"3 projets en cours", xp:40, ok:state.projects.length >= 3},
    {id:"equitable", icon:"handshake", name:"Équitable", desc:"Solder les comptes entre vous", xp:20, ok:state.reimbs.length >= 1},
    {id:"genereux", icon:"gift", name:"Généreux", desc:"Ajouter 3 souhaits à la liste", xp:15, ok:state.wishes.length >= 3},
    {id:"vue_ensemble", icon:"credit-card", name:"Vue d'ensemble", desc:"Ajouter un compte bancaire", xp:15, ok:state.accounts.length >= 1},
    {id:"sous_controle", icon:"shield-check", name:"Sous contrôle", desc:"Suivre une dette", xp:15, ok:state.debts.length >= 1},
    {id:"bricoleur", icon:"wrench", name:"Bricoleur", desc:"Suivre l'entretien d'un véhicule", xp:20, ok:state.cars.some(c => (c.entries || []).length >= 1)},
    {id:"grand_routier", icon:"fuel", name:"Grand routier", desc:"10 pleins enregistrés", xp:30, ok:fillups >= 10},
    {id:"garanties_ok", icon:"receipt", name:"Bien assuré", desc:"3 garanties suivies", xp:15, ok:state.warranties.length >= 3},
    {id:"argent_de_poche", icon:"hand-coins", name:"Éducation financière", desc:"Suivre l'argent de poche d'un enfant", xp:20, ok:state.kids.length >= 1},
    {id:"cagnotte_active", icon:"banknote", name:"Cagnotte commune", desc:"Faire un premier versement à la cagnotte", xp:15, ok:state.potmoves.length >= 1},
    {id:"journal_tenu", icon:"book-open", name:"Petites histoires", desc:"10 entrées au journal du foyer", xp:20, ok:state.journal.length >= 10},
    {id:"groupe_cree", icon:"users", name:"Esprit d'équipe", desc:"Créer un groupe entre amis", xp:15, ok:state.groups.length >= 1},
    {id:"groupe_solde", icon:"handshake", name:"Comptes réglés", desc:"Solder entièrement un groupe entre amis", xp:30, ok:state.groups.some(g => (g.items || []).length > 0 && Object.values(groupBalances(g)).every(v => Math.abs(v) < 1))},
    {id:"groupes_3", icon:"users", name:"Bande d'amis", desc:"Créer 3 groupes entre amis", xp:30, ok:state.groups.length >= 3},
    {id:"groupe_10", icon:"receipt", name:"Trésorier", desc:"10 dépenses dans des groupes entre amis", xp:25, ok:state.groups.reduce((n, g) => n + (g.items || []).filter(i => i.kind !== "settlement").length, 0) >= 10},
    {id:"groupe_xxl", icon:"party-popper", name:"Grande tablée", desc:"Un groupe d'au moins 5 personnes", xp:20, ok:state.groups.some(g => (g.people || []).length >= 5)},
    {id:"virement_1", icon:"repeat", name:"Premier virement", desc:"Enregistrer un virement entre comptes", xp:15, ok:state.transfers.length >= 1},
    {id:"virement_10", icon:"landmark", name:"Gestionnaire de comptes", desc:"10 virements entre comptes", xp:30, ok:state.transfers.length >= 10},
    {id:"serie_7", icon:"flame", name:"Sur sa lancée", desc:"Actif 7 jours d'affilée", xp:40, ok:(SV.progress ? SV.progress.best : 0) >= 7},
    {id:"serie_30", icon:"flame", name:"Inarrêtable", desc:"Actif 30 jours d'affilée", xp:150, ok:(SV.progress ? SV.progress.best : 0) >= 30},
  ];
}

let busy = false;
/** Envoie au serveur les badges nouvellement remplis (XP), avec un toast — appelé après chaque changement */
export async function checkNewBadges(){
  if (busy || state.mode === "loading" || !state.loaded.expenses || !SV.me) return;
  const list = badgeList(), got = list.filter(b => b.ok).map(b => b.id);
  const have = new Set((SV.me.badges || []).map(b => b.id)), fresh = got.filter(id => !have.has(id));
  if (!fresh.length) return;
  busy = true;
  const beforeLevel = levelInfo(SV.me.xp).level;
  try {
    const r = await api("POST", "/api/me/badges", {ids:fresh, labels:Object.fromEntries(list.filter(b => fresh.includes(b.id)).map(b => [b.id, b.name]))});
    SV.me.xp = r.xp; SV.me.badges = r.badges;
    const b = list.find(x => x.id === fresh[0]);
    toast(`Badge débloqué : ${b.name} (+${b.xp} XP)`);
    if (levelInfo(r.xp).level > beforeLevel) toast(`Niveau ${levelInfo(r.xp).level} atteint !`);
  } catch {}
  finally { busy = false; }
}
