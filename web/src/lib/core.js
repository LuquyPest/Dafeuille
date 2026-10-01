/* Référentiels, utilitaires et état partagé — portage de l'app d'origine (public/index.html).
   L'état reste un objet mutable unique comme avant ; chaque modification appelle bump(), qui
   redessine l'interface React (voir useApp). */

export const BASE_CATS = [
  {id:"courses",     name:"Courses",     ico:"shopping-cart", color:"#10B981"},
  {id:"logement",    name:"Logement",    ico:"house", color:"#3B82F6"},
  {id:"energie",     name:"Énergie",     ico:"zap", color:"#F59E0B"},
  {id:"transport",   name:"Transport",   ico:"car", color:"#8B5CF6"},
  {id:"sante",       name:"Santé",       ico:"stethoscope", color:"#EF4444"},
  {id:"enfants",     name:"Enfants",     ico:"baby", color:"#F97316"},
  {id:"loisirs",     name:"Loisirs",     ico:"ticket", color:"#06B6D4"},
  {id:"abonnements", name:"Abonnements", ico:"repeat", color:"#EC4899"},
  {id:"autre",       name:"Autre",       ico:"package", color:"#64748B"},
];
export const EXTRA_COLORS = ["#14B8A6","#6366F1","#D946EF","#84CC16","#EAB308","#0EA5E9","#F43F5E","#A855F7"];
export const GROUP_CATS = [
  {id:"restaurant", name:"Resto", ico:"utensils", color:"#F59E0B"},
  {id:"transport",  name:"Transport", ico:"car", color:"#8B5CF6"},
  {id:"hebergement",name:"Hébergement", ico:"tent", color:"#3B82F6"},
  {id:"activite",   name:"Activité", ico:"ticket", color:"#06B6D4"},
  {id:"courses",    name:"Courses", ico:"shopping-cart", color:"#10B981"},
  {id:"autre",      name:"Autre", ico:"package", color:"#64748B"},
];
export const groupCatOf = id => GROUP_CATS.find(c => c.id === id) || GROUP_CATS[GROUP_CATS.length - 1];
export const CURRENCIES = ["EUR","USD","GBP","CHF","CAD","JPY","MAD","XOF"];
export const MAIN_CURRENCIES = ["EUR","CHF","USD","CAD","GBP","MAD","XOF","TND","DZD","JPY"];
export const REFUND_SOURCES = ["Sécu","Mutuelle","Employeur","Assurance","Autre"];
export const DEFAULT_SETTINGS = { members:[{id:"m1", name:"Moi", weight:100}], budget:0, catBudgets:{}, customCats:[], favorites:[], rates:{}, alertPct:80, envelopes:false, envStart:null, merchantCats:{} };
export const MEMBER_COLORS = ["#0F766E","#DB2777","#2563EB","#EA580C","#7C3AED","#0891B2","#DC2626","#65A30D","#CA8A04","#4F46E5"];
export const CAT_ICONS = ["tag","shopping-cart","house","zap","car","stethoscope","baby","ticket","repeat","package","utensils","coffee","shirt","dog","cat","dumbbell","gamepad-2","graduation-cap","plane","gift","heart-pulse","briefcase","music","tv","bus","bike","hammer","scissors","book-open","wine","fuel","plug","smartphone","credit-card","landmark","piggy-bank"];
export const KEYWORDS = {
  courses:["leclerc","carrefour","auchan","lidl","intermarche","intermarché","super u","hyper u","monoprix","franprix","aldi","casino","picard","biocoop","grand frais","netto","match","cora","boulangerie","marché"],
  energie:["edf","engie","totalenergies","eau","veolia","suez","gaz","électricité","electricite","ekwateur"],
  transport:["sncf","ratp","esso","shell","bp ","avia","péage","peage","vinci","uber","blablacar","essence","carburant","parking","tcl","tbm","navigo","station"],
  abonnements:["netflix","spotify","free","orange","sfr","bouygues","sosh","prime","disney","deezer","canal","youtube","apple.com","icloud","google"],
  sante:["pharmacie","docteur","médecin","medecin","dentiste","mutuelle","doctolib","kiné","kine","opticien","laboratoire","hopital","hôpital"],
  logement:["loyer","ikea","leroy","castorama","brico","assurance hab","syndic","foncière","fonciere","but ","conforama"],
  loisirs:["cinema","cinéma","fnac","restaurant","resto","mcdo","mcdonald","burger","bar ","pathé","pathe","decathlon","steam","playstation","théâtre","musée"],
  enfants:["creche","crèche","cantine","nounou","jouet","école","ecole","cantine","vertbaudet","cyrillus"]
};
export const LISTS = ["expenses","recurring","reimbs","incomes","goals","shop","todos","projects","kids","accounts","debts","bilans",
  "journal","challenges","potmoves","groups","warranties","meters","wishes","meals","events","papers",
  "trash","chores","inventory","health","cars","privates","transfers"];
export const COLL = {expenses:"expenses", recurring:"recurrents", reimbs:"remboursements", incomes:"revenus", goals:"epargne", shop:"courses", todos:"factures",
  projects:"projets", kids:"argentdepoche", accounts:"comptes", debts:"dettes", bilans:"bilans",
  journal:"journal", challenges:"defis", potmoves:"cagnotte", groups:"groupes", warranties:"garanties", meters:"compteurs",
  wishes:"souhaits", meals:"repas", events:"evenements", papers:"papiers",
  trash:"corbeille", chores:"menage", inventory:"placards", health:"sante", cars:"vehicules", transfers:"virements"};

/* ---------- Préférences de l'appareil ---------- */
export const pref = {
  get(k, d){ try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v){ try { localStorage.setItem(k, v); } catch {} },
  del(k){ try { localStorage.removeItem(k); } catch {} },
};

/* ---------- Format ---------- */
let eur = new Intl.NumberFormat("fr-FR", {style:"currency", currency:"EUR"});
let eur0 = new Intl.NumberFormat("fr-FR", {style:"currency", currency:"EUR", maximumFractionDigits:0});
export let HIDE = pref.get("pc.hide", "0") === "1";
export function setHide(v){ HIDE = !!v; pref.set("pc.hide", HIDE ? "1" : "0"); }
export function setCurrency(c){ try { eur = new Intl.NumberFormat("fr-FR", {style:"currency", currency:c}); eur0 = new Intl.NumberFormat("fr-FR", {style:"currency", currency:c, maximumFractionDigits:0}); } catch {} }
export const fmt = c => HIDE ? "••• €" : eur.format(Math.round(c || 0) / 100);
export const fmt0 = c => HIDE ? "••• €" : eur0.format(Math.round(c || 0) / 100);
export const fmtCur = (c, cur) => { if (HIDE) return "•••"; try { return new Intl.NumberFormat("fr-FR", {style:"currency", currency:cur}).format((c||0)/100); } catch { return ((c||0)/100).toFixed(2) + " " + cur; } };
export const parseAmount = s => { const v = parseFloat(String(s ?? "").replace(/[\s  €]/g,"").replace(",", ".")); return Number.isFinite(v) ? Math.round(v*100) : NaN; };
export const parseNum = s => { const v = parseFloat(String(s ?? "").replace(/\s/g,"").replace(",", ".")); return Number.isFinite(v) ? v : NaN; };
export const toInput = c => c ? (c/100).toFixed(2).replace(".", ",").replace(/,00$/, "") : "";
export const pad = n => String(n).padStart(2, "0");
export const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
export const dstr = d => `${keyOf(d)}-${pad(d.getDate())}`;
export const todayStr = () => dstr(new Date());
export const nextKey = k => { let [y,m] = k.split("-").map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${pad(m)}`; };
export const prevKey = k => { let [y,m] = k.split("-").map(Number); m--; if (m < 1) { m = 12; y--; } return `${y}-${pad(m)}`; };
export const parseD = s => { const [y,m,d] = String(s).split("-").map(Number); return new Date(y, (m||1)-1, d||1); };
export const fmtDay = (s, o = {day:"numeric", month:"short"}) => s ? parseD(s).toLocaleDateString("fr-FR", o) : "";
export const monthLabel = k => parseD(k + "-01").toLocaleDateString("fr-FR", {month:"long", year:"numeric"});
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
export const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, " ");
export const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 86400000);
// Valeurs écrites par n'importe quel contributeur via l'API puis utilisées en style/src :
// on n'accepte qu'une couleur hexa ou une image de nos propres formats.
export const safeColor = (c, d = null) => typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : d;
export const safeImg = u => typeof u === "string" && (/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(u) || /^\/uploads\/[A-Za-z0-9-]+\.[a-z]{3,4}$/.test(u) || /^\/api\/h\/[A-Za-z0-9-]+\/tickets\/t[0-9a-f]{16}(\?priv=1)?$/.test(u)) ? u : "";

/* ---------- État ---------- */
export const state = {
  mode:"loading", canWrite:true, uid:null,
  settings:{...DEFAULT_SETTINGS}, settingsExists:false,
  loaded:{},
  month:keyOf(new Date()), year:new Date().getFullYear(),
  tab:pref.get("pc.tab", "budget"),
  query:"", flt:{who:"", cat:"", type:"", tag:""}, searchYear:false,
  stats:{shop:{}}, calDay:null,
  sel:false, selIds:new Set(), mealWeek:0, listMode:"expenses", listLimit:80,
};
LISTS.forEach(l => state[l] = []);

let version = 0;
const subs = new Set();
let scheduled = false;
/** Signale un changement d'état : l'interface se redessine au prochain microtâche (regroupé). */
export function bump(){
  if (scheduled) return; scheduled = true;
  queueMicrotask(() => { scheduled = false; version++; subs.forEach(f => f()); });
}
export const subscribe = f => { subs.add(f); return () => subs.delete(f); };
export const getVersion = () => version;

/* ---------- Membres, catégories ---------- */
export const allCats = () => BASE_CATS.concat((state.settings.customCats || []).map(c => ({...c, color:safeColor(c.color, "#94A3B8")})));
export const catOf = id => allCats().find(c => c.id === id) || BASE_CATS[BASE_CATS.length-1];
export const members = () => (state.settings.members || []).map(m => ({...m, color:safeColor(m.color), photo:safeImg(m.photo) || null}));
export const memberName = id => id === "pot" ? "Cagnotte" : (members().find(m => m.id === id) || {}).name || (id ? "Ancien membre" : "—");
export const memberColor = id => { if (id === "pot") return "#8C7A5B"; const ms = members(), i = ms.findIndex(m => m.id === id); return i < 0 ? "#7D8A86" : (ms[i].color || MEMBER_COLORS[i % MEMBER_COLORS.length]); };
export const projectOf = id => state.projects.find(p => p.id === id);
/** Compte dans le budget mensuel ? (les projets « hors budget » en sont exclus) */
export const bud = e => !(e.project && projectOf(e.project)?.exclude);
export const me = () => { const id = pref.get("pc.me", ""); return members().some(m => m.id === id) ? id : ""; };
export function currentWeights(){
  const w = {}, ms = members();
  ms.forEach(m => { w[m.id] = m.weight > 0 ? m.weight : 100 / ms.length; });
  return w;
}
export function sharesOf(e){
  if (e.split && e.split !== "all") return {[e.split]:1};
  const w = e.shares && Object.keys(e.shares).length ? e.shares : currentWeights();
  const sum = Object.values(w).reduce((a, b) => a + (b > 0 ? b : 0), 0);
  const out = {};
  if (sum > 0) Object.entries(w).forEach(([id, v]) => { if (v > 0) out[id] = v / sum; });
  return out;
}
/** Montant réel d'une dépense : moins le remboursement déjà reçu */
export const eff = e => Math.max(0, (e.amount || 0) - (e.refund && e.refund.received ? (e.refund.amount || 0) : 0));
export const BASE = () => state.settings.currency || "EUR";

/* ---------- Périodes (le mois peut commencer un autre jour que le 1er) ---------- */
export const MS = () => Math.min(28, Math.max(1, state.settings.monthStart || 1));
export function periodOf(k){ const ms = MS(); if (ms === 1) { const [y, m] = k.split("-").map(Number); return {from:`${k}-01`, to:dstr(new Date(y, m, 0))}; } return {from:`${k}-${pad(ms)}`, to:`${nextKey(k)}-${pad(ms - 1)}`}; }
export const bKey = d => { const ms = MS(); return ms > 1 && d.getDate() < ms ? prevKey(keyOf(d)) : keyOf(d); };
export const curKey = () => bKey(new Date());
export const inMonth = (list, k) => { if (MS() === 1) return list.filter(e => typeof e.date === "string" && e.date.startsWith(k)); const p = periodOf(k); return list.filter(e => typeof e.date === "string" && e.date >= p.from && e.date <= p.to); };
export const sumBy = (list, keyFn, valFn = eff) => { const o = {}; list.forEach(e => { const k = keyFn(e); o[k] = (o[k] || 0) + valFn(e); }); return o; };
export const totalOf = (list, valFn = eff) => list.reduce((s, e) => s + valFn(e), 0);
export const incTotal = list => list.reduce((s, e) => s + (e.amount || 0), 0);
export const defDate = () => { const p = periodOf(state.month), t = todayStr(); return t >= p.from && t <= p.to ? t : p.from; };
