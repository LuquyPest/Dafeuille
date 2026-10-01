// Tests API bout-en-bout, contre un vrai serveur + une vraie base (pas de mocks).
// Lancement : docker compose exec app npm test (DATABASE_URL et le serveur tournent déjà dans le conteneur).
// Chaque test crée ses propres comptes jetables (apitest-*@example.com) et les nettoie à la fin.
// Les signups sont soumis au même anti-abus que la prod (10/h/IP) : évitez de relancer la suite
// plus de quelques fois par heure depuis la même machine.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const createdEmails = [];

function client() {
  let cookie = "";
  return async (method, path, body) => {
    const headers = { "Content-Type": "application/json", "X-PC": "1" };
    if (cookie) headers.Cookie = cookie;
    const r = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  };
}

async function freshVerifiedUser(name) {
  const email = `apitest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  createdEmails.push(email);
  const c = client();
  const signup = await c("POST", "/api/auth/signup", { email, password: "TestPass123!", name });
  assert.equal(signup.status, 200);
  await pool.query("UPDATE users SET verified_at = now() WHERE email = $1", [email]);
  const login = await c("POST", "/api/auth/login", { email, password: "TestPass123!" });
  assert.equal(login.status, 200);
  return { c, email };
}

after(async () => {
  if (createdEmails.length) {
    await pool.query(
      `DELETE FROM docs WHERE household_id IN (SELECT id FROM households WHERE created_by IN (SELECT id FROM users WHERE email = ANY($1)))`, [createdEmails]);
    await pool.query(
      `DELETE FROM households WHERE created_by IN (SELECT id FROM users WHERE email = ANY($1))`, [createdEmails]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [createdEmails]);
  }
  await pool.end();
});

test("santé du serveur", async () => {
  const r = await fetch(BASE + "/api/health");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test("auth : /api/me sans session renvoie 401", async () => {
  const c = client();
  const r = await c("GET", "/api/me");
  assert.equal(r.status, 401);
});

test("auth : mauvais mot de passe rejeté", async () => {
  const { c, email } = await freshVerifiedUser("Test Auth");
  const c2 = client();
  const bad = await c2("POST", "/api/auth/login", { email, password: "mauvais-mot-de-passe" });
  assert.equal(bad.status, 401);
  const me = await c("GET", "/api/me");
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, email);
});

test("docs : écrire/lire/supprimer un document, isolé par foyer", async () => {
  const { c } = await freshVerifiedUser("Test Docs");
  const hh = await c("POST", "/api/households", { name: "Foyer Test Docs" });
  assert.equal(hh.status, 200);
  const hid = hh.data.id;

  const put = await c("PUT", `/api/h/${hid}/doc`, { coll: "expenses", id: "e1", data: { label: "Café", amount: 3.5 } });
  assert.equal(put.status, 200);

  const data = await c("GET", `/api/h/${hid}/data`);
  assert.equal(data.status, 200);
  const doc = data.data.docs.find(d => d.coll === "expenses" && d.id === "e1");
  assert.ok(doc, "le document écrit doit apparaître dans /data");
  assert.equal(doc.data.label, "Café");

  const del = await c("DELETE", `/api/h/${hid}/doc?coll=expenses&id=e1`);
  assert.equal(del.status, 200);
  const data2 = await c("GET", `/api/h/${hid}/data`);
  assert.ok(!data2.data.docs.find(d => d.coll === "expenses" && d.id === "e1"));
});

test("docs : un foyer est invisible à qui n'en est pas membre", async () => {
  const { c: owner } = await freshVerifiedUser("Owner");
  const { c: stranger } = await freshVerifiedUser("Stranger");
  const hh = await owner("POST", "/api/households", { name: "Foyer Privé" });
  const hid = hh.data.id;
  await owner("PUT", `/api/h/${hid}/doc`, { coll: "expenses", id: "e1", data: { label: "Secret", amount: 1 } });

  const asStranger = await stranger("GET", `/api/h/${hid}/data`);
  assert.equal(asStranger.status, 404);
});

test("sessions : la session en cours ne peut être révoquée via l'endpoint, une autre oui", async () => {
  const { c, email } = await freshVerifiedUser("Test Sessions");
  // deuxième connexion (même compte, autre « appareil »)
  const c2 = client();
  const login2 = await c2("POST", "/api/auth/login", { email, password: "TestPass123!" });
  assert.equal(login2.status, 200);

  const list1 = await c("GET", "/api/me/sessions");
  assert.equal(list1.status, 200);
  assert.equal(list1.data.sessions.length, 2);
  const mine = list1.data.sessions.find(s => s.current);
  const other = list1.data.sessions.find(s => !s.current);

  const blocked = await c("DELETE", `/api/me/sessions/${mine.id}`);
  assert.equal(blocked.status, 400);

  const revoked = await c("DELETE", `/api/me/sessions/${other.id}`);
  assert.equal(revoked.status, 200);

  const list2 = await c("GET", "/api/me/sessions");
  assert.equal(list2.data.sessions.length, 1);
});

test("export RGPD : contient le compte et les foyers", async () => {
  const { c } = await freshVerifiedUser("Test Export");
  const hh = await c("POST", "/api/households", { name: "Foyer Export" });
  const r = await c("GET", "/api/me/export");
  assert.equal(r.status, 200);
  assert.ok(r.data.account && r.data.account.email);
  assert.ok(r.data.households.some(h => h.id === hh.data.id));
});

test("suppression de compte : mauvais mot de passe rejeté, bon mot de passe réussit et nettoie", async () => {
  const { c, email } = await freshVerifiedUser("Test Delete");
  const bad = await c("DELETE", "/api/me", { password: "mauvais" });
  assert.equal(bad.status, 401);

  const ok = await c("DELETE", "/api/me", { password: "TestPass123!" });
  assert.equal(ok.status, 200);

  const row = await pool.query("SELECT 1 FROM users WHERE email = $1", [email]);
  assert.equal(row.rows.length, 0);
});

test("groupes publics : ajout anonyme avec jeton, modification sans le bon jeton refusée", async () => {
  const { c } = await freshVerifiedUser("Test Groupe");
  const hh = await c("POST", "/api/households", { name: "Foyer Groupe" });
  const hid = hh.data.id;
  const gid = "g1";
  await c("PUT", `/api/h/${hid}/doc`, { coll: "groupes", id: gid, data: { name: "Weekend", people: [{ id: "p1", name: "Moi" }], items: [] } });
  const link = await c("POST", `/api/h/${hid}/groups/${gid}/link/rotate`);
  assert.equal(link.status, 200);
  const token = link.data.token;
  assert.ok(token);

  // visiteur anonyme, sans cookie
  const getPublic = await fetch(`${BASE}/api/public/group/${token}`);
  assert.equal(getPublic.status, 200);
  const g = await getPublic.json();
  assert.equal(g.name, "Weekend");

  const addItem = await fetch(`${BASE}/api/public/group/${token}/item`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-PC": "1" },
    body: JSON.stringify({ payerName: "Ami", label: "Pizza", amount: 20 }),
  });
  assert.equal(addItem.status, 200);
  const added = await addItem.json();
  assert.ok(added.claimToken, "un jeton de possession doit être renvoyé à la création");
  assert.ok(added.itemId);

  // suppression SANS le bon jeton : refusée
  const delBadToken = await fetch(`${BASE}/api/public/group/${token}/item/${added.itemId}?claimToken=faux-jeton`, {
    method: "DELETE", headers: { "X-PC": "1" },
  });
  assert.equal(delBadToken.status, 403);

  // suppression AVEC le bon jeton : acceptée
  const delOk = await fetch(`${BASE}/api/public/group/${token}/item/${added.itemId}?claimToken=${encodeURIComponent(added.claimToken)}`, {
    method: "DELETE", headers: { "X-PC": "1" },
  });
  assert.equal(delOk.status, 200);
});

test("groupes publics : un code devise qui n'est pas 3 lettres ISO est refusé (régression XSS fmtCur)", async () => {
  const { c } = await freshVerifiedUser("Test Devise");
  const hh = await c("POST", "/api/households", { name: "Foyer Devise" });
  const hid = hh.data.id;
  const gid = "g1";
  await c("PUT", `/api/h/${hid}/doc`, { coll: "groupes", id: gid, data: { name: "Trip", people: [{ id: "p1", name: "Moi" }], items: [] } });
  const link = await c("POST", `/api/h/${hid}/groups/${gid}/link/rotate`);
  const token = link.data.token;

  const addItem = await fetch(`${BASE}/api/public/group/${token}/item`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-PC": "1" },
    body: JSON.stringify({ payerName: "Ami", label: "Resto", amount: 10, currency: "<img src=x onerror=alert(1)>", rate: 1, origAmount: 10 }),
  });
  assert.equal(addItem.status, 400);
});
