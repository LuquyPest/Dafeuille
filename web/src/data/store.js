/* Couche de données : API REST du serveur, temps réel (SSE), file d'attente hors ligne et instantané local.
   Formats de stockage local identiques à l'ancienne interface (pc.queue.<foyer>, pc.snap.<foyer>) :
   on peut passer de l'une à l'autre sans perdre une modification hors ligne. */
import { state, COLL, LISTS, DEFAULT_SETTINGS, uid, pref, bump } from "../lib/core.js";

export const SV = {me:null, households:[], hh:null, role:null, progress:null, offlineSince:null};

export async function api(method, url, body){
  let r;
  try { r = await fetch(url, {method, credentials:"same-origin", headers:{"Content-Type":"application/json", "X-PC":"1"}, body:body !== undefined ? JSON.stringify(body) : undefined}); }
  catch { throw {code:"unavailable", message:"Pas de connexion au serveur."}; }
  let d = null; try { d = await r.json(); } catch {}
  if (!r.ok) {
    const code = r.status === 403 ? (d && d.error === "unverified" ? "unverified" : "not_granted") : r.status === 413 ? "quota_exceeded" : r.status >= 500 ? "unavailable" : (d && d.error) || "error";
    throw {code, status:r.status, error:d && d.error, message:(d && d.message) || "Erreur."};
  }
  return d;
}

/* ---------- Toast (notification en bas d'écran) ---------- */
export const toastState = {msg:"", act:null, actLabel:"", n:0};
let toastTimer = null;
export function toast(msg, actLabel, actFn){
  if (navigator.vibrate && pref.get("pc.haptic", "1") === "1") try { navigator.vibrate(8); } catch {}
  Object.assign(toastState, {msg, actLabel:actLabel || "", act:actFn || null, n:toastState.n + 1});
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastState.msg = ""; toastState.act = null; bump(); }, actFn ? 6000 : 3000);
  bump();
}
export function handleWriteError(e){
  if (e && (e.code === "invalid_argument" || e.code === "not_granted")) { state.canWrite = false; bump(); toast("Vous pouvez consulter ce foyer, mais pas le modifier."); }
  else if (e && e.code === "quota_exceeded") toast("Stockage plein : supprimez d'anciens éléments.");
  else toast((e && e.message) || "Enregistrement impossible pour le moment. Réessayez.");
}

/* ---------- Correspondance collections ↔ listes de l'état ---------- */
const LIST_OF = Object.fromEntries(Object.entries(COLL).map(([l, c]) => [c, l]));
export const collPath = list => list === "privates" ? "data/users/" + state.uid : COLL[list];
function listOf(coll){ if (state.uid && coll === "data/users/" + state.uid) return "privates"; return LIST_OF[coll]; }
const base = () => `/api/h/${encodeURIComponent(SV.hh.id)}`;
const clean = o => { const b = JSON.parse(JSON.stringify(o)); delete b.id; delete b._l; return b; };

function applyDoc(coll, id, data){
  if (coll === "foyer") {
    if (id === "reglages") { state.settings = data ? {...DEFAULT_SETTINGS, ...data} : {...DEFAULT_SETTINGS}; state.settingsExists = !!data; }
    if (id === "stats") state.stats = data ? {shop:{}, ...data} : {shop:{}};
    return;
  }
  const l = listOf(coll); if (!l || String(id).startsWith("_")) return;
  state[l] = state[l].filter(x => x.id !== id);
  if (data !== null && data !== undefined) state[l].push({id, ...data});
}
function loadDocs(docs){
  LISTS.forEach(l => state[l] = []);
  state.settings = {...DEFAULT_SETTINGS}; state.settingsExists = false; state.stats = {shop:{}};
  docs.forEach(d => applyDoc(d.coll, d.id, d.data));
  offq.get().forEach(applyOp);
  LISTS.concat("settings").forEach(l => state.loaded[l] = true);
}
/** Tous les documents connus (pour l'instantané hors ligne) */
function dumpDocs(){
  const out = [];
  for (const l of LISTS) { const c = collPath(l); state[l].forEach(x => { const {id, _l, ...data} = x; out.push({coll:c, id, data}); }); }
  if (state.settingsExists) out.push({coll:"foyer", id:"reglages", data:state.settings});
  out.push({coll:"foyer", id:"stats", data:state.stats});
  return out;
}

/* ---------- File d'attente hors ligne ---------- */
const qKey = () => "pc.queue" + (SV.hh ? "." + SV.hh.id : "");
export const offq = {
  get(){ try { return JSON.parse(localStorage.getItem(qKey()) || "[]"); } catch { return []; } },
  set(q){ try { localStorage.setItem(qKey(), JSON.stringify(q)); } catch {} }
};
export const isNetErr = e => !navigator.onLine || (e && (e.code === "unavailable" || e.code === "resource_exhausted"));
let warned = false;
function applyOp(op){
  if (op.doc) { const [c, id] = op.doc.split("/"); applyDoc(c, id, op.data); return; }
  applyDoc(op.path, op.id, op.op === "set" ? op.data : null);
}
function enqueue(op){
  const q = offq.get().filter(o => !(o.doc ? o.doc === op.doc : o.path === op.path && o.id === op.id)); q.push(op); offq.set(q);
  applyOp(op); bump();
  if (!warned) { warned = true; toast("Hors ligne : enregistré sur l'appareil, envoi au retour du réseau"); }
}
async function sendOp(op){
  if (op.doc) { const [c, id] = op.doc.split("/"); return api("PUT", base() + "/doc", {coll:c, id, data:op.data}); }
  if (op.op === "set") return api("PUT", base() + "/doc", {coll:op.path, id:op.id, data:op.data});
  return api("DELETE", `${base()}/doc?coll=${encodeURIComponent(op.path)}&id=${encodeURIComponent(op.id)}`);
}
let flushing = false;
export async function flushQueue(){
  if (flushing || !SV.hh || !navigator.onLine) return;
  let q = offq.get(); if (!q.length) return;
  flushing = true; let sent = 0, refused = 0;
  try {
    while (q.length) {
      try { await sendOp(q[0]); sent++; }
      catch (e) { if (isNetErr(e) || (e && e.status === 429)) throw e; refused++; }   // refus définitif : écarté pour ne pas bloquer la suite
      q.shift(); offq.set(q);
    }
    warned = false;
    toast(refused ? `${sent} modification${sent > 1 ? "s" : ""} hors ligne envoyée${sent > 1 ? "s" : ""}, ${refused} refusée${refused > 1 ? "s" : ""} par le serveur` : "Modifications hors ligne envoyées");
  } catch {}
  finally { flushing = false; bump(); }
}
window.addEventListener("online", () => { flushQueue(); bump(); });
window.addEventListener("offline", () => bump());
setInterval(() => { if (offq.get().length) flushQueue(); }, 20000);

/* ---------- Écritures ---------- */
const writeHooks = [];
/** Permet d'observer les écritures (alertes de budget, etc.) */
export const onWrite = f => writeHooks.push(f);
async function withRetry(fn){
  try { return await fn(); }
  catch (e) { if (e && e.code === "unavailable" && navigator.onLine) { await new Promise(r => setTimeout(r, 400 + Math.random() * 600)); return fn(); } throw e; }
}
export const store = {
  async upsert(list, item){
    const before = writeHooks.map(h => h.before && h.before(list));
    const path = collPath(list), id = item.id || uid(), data = clean(item), op = {op:"set", path, id, data};
    if (!navigator.onLine) enqueue(op);
    else {
      try { await withRetry(() => sendOp(op)); applyOp(op); bump(); }
      catch (e) { if (isNetErr(e)) enqueue(op); else throw e; }
    }
    writeHooks.forEach((h, i) => h.after && h.after(list, before[i]));
    return id;
  },
  async remove(list, id){
    const op = {op:"del", path:collPath(list), id};
    if (!navigator.onLine) return enqueue(op);
    try { await withRetry(() => sendOp(op)); applyOp(op); bump(); }
    catch (e) { if (isNetErr(e)) enqueue(op); else throw e; }
  },
  async saveStats(st){ await this._doc("foyer/stats", JSON.parse(JSON.stringify(st))); },
  async saveSettings(s){ const data = JSON.parse(JSON.stringify(s)); delete data.__exists; await this._doc("foyer/reglages", data); },
  async _doc(doc, data){
    const op = {doc, data};
    if (!navigator.onLine) return enqueue(op);
    try { await withRetry(() => sendOp(op)); applyOp(op); bump(); }
    catch (e) { if (isNetErr(e)) enqueue(op); else throw e; }
  },
};

/* ---------- Photos de tickets (fichiers privés côté serveur) ---------- */
const ticketApi = (id, priv) => `${base()}/tickets${id ? "/" + encodeURIComponent(id) + (priv ? "?priv=1" : "") : ""}`;
export const tickets = {
  async put(dataUrl, priv){ return (await api("POST", ticketApi(), {image:dataUrl, priv:!!priv})).id; },
  url(id, priv){ return ticketApi(id, priv); },
  async del(id, priv){ try { await api("DELETE", ticketApi(id, priv)); } catch {} },
};
export async function uploadImage(dataUrl){ return (await api("POST", `${base()}/uploads`, {image:dataUrl})).url; }

/* ---------- Instantané hors ligne ---------- */
const SNAP = hid => "pc.snap." + hid;
export function saveSnapshot(){
  if (!SV.hh || state.mode !== "shared") return;
  try {
    localStorage.setItem(SNAP(SV.hh.id), JSON.stringify({at:Date.now(), household:SV.hh, docs:dumpDocs()}));
    localStorage.setItem("pc.snap.me", JSON.stringify({user:SV.me, households:SV.households}));
  } catch {}
}
export function loadSnapshot(hid){ try { return JSON.parse(localStorage.getItem(SNAP(hid)) || "null"); } catch { return null; } }
export function loadMeSnapshot(){ try { return JSON.parse(localStorage.getItem("pc.snap.me") || "null"); } catch { return null; } }
export function clearSnapshots(){ try { Object.keys(localStorage).filter(k => k.startsWith("pc.snap.")).forEach(k => localStorage.removeItem(k)); } catch {} }
document.addEventListener("visibilitychange", () => { if (document.hidden) saveSnapshot(); });
setInterval(saveSnapshot, 5 * 60e3);

/* ---------- Ouverture d'un foyer + temps réel ---------- */
let es = null;
const openHooks = [];
/** Appelé après chaque chargement complet des données (récurrences, premiers lancements…) */
export const onLoaded = f => openHooks.push(f);
const changeHooks = [];
/** Appelé après chaque modification reçue en temps réel (un autre appareil a écrit). */
export const onChanged = f => changeHooks.push(f);
export async function openHousehold(hid){
  let r;
  try { r = await api("GET", `/api/h/${encodeURIComponent(hid)}/data`); }
  catch (e) {
    const snap = e.code === "unavailable" && loadSnapshot(hid); if (!snap) throw e;
    r = {household:snap.household, docs:snap.docs, me:SV.me}; SV.offlineSince = snap.at;
    toast(`Hors ligne : données du ${new Date(snap.at).toLocaleString("fr-FR", {day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"})}, vos modifications seront envoyées au retour du réseau`);
  }
  SV.hh = r.household; SV.role = r.household.role; pref.set("pc.srv.hid", hid);
  state.uid = SV.me.id; state.mode = "shared"; state.canWrite = SV.role !== "viewer";
  loadDocs(r.docs);
  connect(hid);
  bump(); openHooks.forEach(f => f());
  setTimeout(saveSnapshot, 1500); setTimeout(flushQueue, 3000);
}
function connect(hid){
  if (es) es.close();
  let wasDown = false;
  es = new EventSource(`/api/h/${encodeURIComponent(hid)}/events`);
  es.onopen = async () => {
    if (!wasDown) return; wasDown = false;
    try { const r = await api("GET", base() + "/data"); loadDocs(r.docs); bump(); openHooks.forEach(f => f()); flushQueue(); } catch {}
  };
  es.onerror = () => { wasDown = true; };
  es.onmessage = async ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === "access") {
      if (m.uid && m.uid !== SV.me.id) return;
      const meR = await api("GET", "/api/me").catch(() => null), h = meR && meR.households.find(x => x.id === hid);
      if (!h) { toast("Votre accès à ce foyer a été retiré."); setTimeout(() => location.reload(), 1500); }
      else if (h.role !== SV.role) location.reload();
      else { SV.hh.name = h.name; bump(); }
      return;
    }
    if (m.t !== "doc") return;
    if (m.deleted) applyDoc(m.coll, m.id, null);
    else if (m.data) applyDoc(m.coll, m.id, m.data);
    else if (!m.coll.includes("_tickets") && m.coll !== "tickets") {
      try { const d = await api("GET", `${base()}/doc?coll=${encodeURIComponent(m.coll)}&id=${encodeURIComponent(m.id)}`); if (d.exists) applyDoc(m.coll, m.id, d.data); } catch {}
    }
    bump(); changeHooks.forEach(f => f());
  };
}
export async function refreshMe(){ const r = await api("GET", "/api/me"); SV.me = r.user; SV.households = r.households; bump(); return r; }
export async function logout(){ await api("POST", "/api/auth/logout").catch(() => {}); clearSnapshots(); pref.del("pc.srv.hid"); location.href = "/beta/"; }
