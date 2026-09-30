"use strict";
/* DAFeuille — serveur (Node.js + PostgreSQL) */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const { Pool, Client } = require("pg");
const nodemailer = require("nodemailer");
const QRCode = require("qrcode");

/* ============================ Configuration ============================ */
const env = process.env;
const CFG = {
  port: +env.PORT || 3000,
  appUrl: (env.APP_URL || "http://localhost:3000").replace(/\/+$/, ""),
  appName: env.APP_NAME || "DAFeuille",
  dbUrl: env.DATABASE_URL || "postgres://potcommun:potcommun@localhost:5432/potcommun",
  mailFrom: env.MAIL_FROM || "DAFeuille <no-reply@localhost>",
  smtp: env.SMTP_HOST ? {
    host: env.SMTP_HOST, port: +(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === "true",
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
  } : null,
  mailLog: env.MAIL_LOG_FILE || "",
  allowSignup: env.ALLOW_SIGNUP !== "false",
  publicDir: env.PUBLIC_DIR || path.join(__dirname, "..", "public"),
};
CFG.secure = CFG.appUrl.startsWith("https://");
const SESSION_DAYS = 30;

/* ============================ Base de données ============================ */
const pool = new Pool({ connectionString: CFG.dbUrl, max: +(env.DB_POOL || 10) });
const q = (text, params) => pool.query(text, params);

async function checkDbRole() {
  const r = (await q("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")).rows[0];
  if (r && (r.rolsuper || r.rolbypassrls)) {
    const msg = "Le compte PostgreSQL de l'app est administrateur (SUPERUSER ou BYPASSRLS) : le cloisonnement des foyers par la base serait contourné. Utilisez un compte dédié sans ces droits (voir LISEZMOI).";
    if (env.ALLOW_INSECURE_DB_ROLE === "true") console.warn("ATTENTION : " + msg); else throw Object.assign(new Error(msg), { fatal: true });
  }
}
async function applySchema() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "sql", "schema.sql"), "utf8");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(424242)");
    await c.query(sql);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
}

/* Transaction au nom d'un utilisateur : active le cloisonnement (RLS) */
async function asUser(uid, fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id', $1, true)", [uid]);
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
}

/* ============================ Outils ============================ */
const uuid = () => crypto.randomUUID();
const newToken = () => crypto.randomBytes(32).toString("base64url");
const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const normEmail = e => String(e || "").trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

class HttpError extends Error { constructor(status, code, message) { super(message || code); this.status = status; this.code = code; } }
const bad = (code, msg) => new HttpError(400, code, msg);
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* Mots de passe : scrypt (intégré à Node, sans dépendance native) */
function hashPassword(pw) {
  return new Promise((ok, ko) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(pw, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => e ? ko(e) : ok(`scrypt$32768$${salt.toString("base64")}$${k.toString("base64")}`));
  });
}
function verifyPassword(pw, stored) {
  return new Promise(ok => {
    const [alg, n, salt, hash] = String(stored).split("$");
    if (alg !== "scrypt") return ok(false);
    const exp = Buffer.from(hash, "base64");
    crypto.scrypt(pw, Buffer.from(salt, "base64"), exp.length, { N: +n, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => ok(!e && crypto.timingSafeEqual(k, exp)));
  });
}
const DUMMY_HASH = "scrypt$32768$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");
function checkPassword(pw) {
  if (typeof pw !== "string" || pw.length < 10) throw bad("weak_password", "Le mot de passe doit contenir au moins 10 caractères.");
  if (pw.length > 200) throw bad("weak_password", "Mot de passe trop long.");
}

/* TOTP (RFC 6238), compatible Google Authenticator, Authy, 1Password… */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32enc(buf) { let bits = 0, val = 0, out = ""; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += B32[(val << (5 - bits)) & 31]; return out; }
function b32dec(s) { let bits = 0, val = 0; const out = []; for (const ch of s.replace(/=+$/, "").toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function totpAt(secret, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const hm = crypto.createHmac("sha1", b32dec(secret)).update(msg).digest();
  const o = hm[hm.length - 1] & 15;
  return String(((hm.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}
function totpCheck(secret, code, lastStep) {
  const c = String(code || "").replace(/\s/g, ""); if (!/^\d{6}$/.test(c)) return 0;
  const now = Math.floor(Date.now() / 30000);
  for (const d of [0, -1, 1]) { const st = now + d; if (st > lastStep && crypto.timingSafeEqual(Buffer.from(totpAt(secret, st)), Buffer.from(c))) return st; }
  return 0;
}

/* Limitation de débit (en mémoire) */
const hits = new Map();
function limit(key, max, windowMs) {
  const t = Date.now(), e = hits.get(key);
  if (!e || e.reset < t) { hits.set(key, { n: 1, reset: t + windowMs }); return; }
  if (++e.n > max) throw new HttpError(429, "rate_limited", "Trop de tentatives. Réessayez dans quelques minutes.");
}
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (v.reset < t) hits.delete(k); }, 60000).unref();

/* ============================ E-mails ============================ */
const transport = CFG.smtp ? nodemailer.createTransport(CFG.smtp) : null;
function mailHtml(title, text, btn, url) {
  return `<!doctype html><html><body style="margin:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;color:#0B1220">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:18px;padding:32px">
<tr><td style="font-size:20px;font-weight:bold;padding-bottom:6px">${esc(CFG.appName)}</td></tr>
<tr><td style="font-size:17px;font-weight:bold;padding:14px 0 8px">${esc(title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.55;color:#374151">${text}</td></tr>
${btn ? `<tr><td style="padding:24px 0"><a href="${esc(url)}" style="background:#0F766E;color:#fff;text-decoration:none;padding:13px 22px;border-radius:12px;font-weight:bold;display:inline-block">${esc(btn)}</a></td></tr>
<tr><td style="font-size:12px;color:#6B7280;word-break:break-all">Si le bouton ne fonctionne pas : ${esc(url)}</td></tr>` : ""}
<tr><td style="font-size:12px;color:#9CA3AF;padding-top:22px">Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</td></tr>
</table></td></tr></table></body></html>`;
}
async function sendMail(to, subject, title, textHtml, btn, url) {
  const text = `${title}\n\n${textHtml.replace(/<[^>]+>/g, "")}\n\n${btn ? btn + " : " + url : ""}`;
  if (CFG.mailLog) fs.appendFileSync(CFG.mailLog, JSON.stringify({ to, subject, url }) + "\n");
  if (!transport) { console.log(`[e-mail] à ${to} — ${subject}${url ? " — " + url : ""}`); return; }
  await transport.sendMail({ from: CFG.mailFrom, to, subject, text, html: mailHtml(title, textHtml, btn, url) });
}

/* ============================ Jetons e-mail ============================ */
async function makeEmailToken(kind, userId, data, ttlMs) {
  const t = newToken();
  await q("INSERT INTO email_tokens (id, kind, user_id, data, expires_at) VALUES ($1,$2,$3,$4, now() + ($5 || ' milliseconds')::interval)", [sha(t), kind, userId, data || {}, String(ttlMs)]);
  return t;
}
async function useEmailToken(kind, t) {
  const r = await q("UPDATE email_tokens SET used_at = now() WHERE id = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now() RETURNING *", [sha(t || ""), kind]);
  return r.rows[0] || null;
}
async function sendVerification(user, invite) {
  const t = await makeEmailToken("verify", user.id, invite ? { invite } : {}, 48 * 3600e3);
  await sendMail(user.email, "Confirmez votre adresse e-mail", "Bienvenue !", "Confirmez votre adresse pour activer votre compte.", "Confirmer mon adresse", `${CFG.appUrl}/api/auth/verify?token=${t}`);
}

/* ============================ Sessions ============================ */
function parseCookies(req) {
  const out = {}; (req.headers.cookie || "").split(";").forEach(p => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function setCookie(res, value, maxAge) {
  res.append("Set-Cookie", `pc_sid=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${CFG.secure ? "; Secure" : ""}`);
}
async function openSession(req, res, userId, mfaPending) {
  const t = newToken();
  await q("INSERT INTO sessions (id, user_id, mfa_pending, user_agent, expires_at) VALUES ($1,$2,$3,$4, now() + interval '30 days')", [sha(t), userId, !!mfaPending, String(req.get("user-agent") || "").slice(0, 200)]);
  setCookie(res, t, SESSION_DAYS * 86400);
}
async function loadSession(req, res, next) {
  const t = parseCookies(req).pc_sid;
  if (t) {
    const r = await q(`SELECT s.id AS sid, s.mfa_pending, s.last_seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > now()`, [sha(t)]);
    if (r.rows[0]) {
      const row = r.rows[0];
      req.sess = { id: row.sid, mfaPending: row.mfa_pending };
      req.user = row;
      if (Date.now() - new Date(row.last_seen).getTime() > 86400e3) {
        q("UPDATE sessions SET last_seen = now(), expires_at = now() + interval '30 days' WHERE id = $1", [row.sid]).catch(() => {});
        setCookie(res, t, SESSION_DAYS * 86400);
      }
    }
  }
  next();
}
const requireUser = (req, res, next) => (req.user && !req.sess.mfaPending) ? next() : next(new HttpError(401, "unauthenticated", "Connexion requise."));

/* ============================ Application ============================ */
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(self), geolocation=(), microphone=()",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  });
  if (CFG.secure) res.set("Strict-Transport-Security", "max-age=31536000");
  next();
});
app.use(express.json({ limit: "400kb" }));
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "HEAD" && req.get("X-PC") !== "1") return next(new HttpError(403, "csrf", "Requête refusée."));
  next();
});
app.use("/api", h(loadSession));

app.get("/api/health", h(async (req, res) => { await q("SELECT 1"); res.json({ ok: true }); }));

/* ---------------------------- Authentification ---------------------------- */
const GENERIC_SENT = { ok: true, message: "Si l'adresse est valide, un e-mail vient d'être envoyé." };

app.post("/api/auth/signup", h(async (req, res) => {
  const email = normEmail(req.body.email), name = String(req.body.name || "").trim().slice(0, 60), password = req.body.password, invite = req.body.invite ? String(req.body.invite) : null;
  limit("signup:" + req.ip, 10, 3600e3);
  if (!EMAIL_RE.test(email) || email.length > 200) throw bad("bad_email", "Adresse e-mail invalide.");
  checkPassword(password);
  let inv = null;
  if (invite) { inv = (await q("SELECT * FROM invites WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()", [sha(invite)])).rows[0] || null; }
  if (!CFG.allowSignup && !inv) throw new HttpError(403, "signup_closed", "Les inscriptions se font uniquement sur invitation.");
  const existing = (await q("SELECT * FROM users WHERE lower(email) = $1", [email])).rows[0];
  if (existing) {
    if (!existing.verified_at) await sendVerification(existing, inv ? invite : null);
    else await sendMail(email, "Vous avez déjà un compte", "Vous avez déjà un compte", "Quelqu'un a essayé de créer un compte avec votre adresse. Si c'était vous, connectez-vous simplement.", "Me connecter", CFG.appUrl + (inv ? `/?invite=${invite}` : "/"));
    return res.json(GENERIC_SENT);
  }
  const user = { id: uuid(), email, name: name || email.split("@")[0] };
  await q("INSERT INTO users (id, email, name, pass) VALUES ($1,$2,$3,$4)", [user.id, email, user.name, await hashPassword(password)]);
  await sendVerification(user, inv ? invite : null);
  res.json(GENERIC_SENT);
}));

async function acceptInvite(inviteToken, user) {
  const inv = (await q("SELECT * FROM invites WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()", [sha(inviteToken)])).rows[0];
  if (!inv) throw bad("invite_invalid", "Cette invitation n'est plus valable.");
  if (normEmail(inv.email) !== normEmail(user.email)) throw new HttpError(403, "invite_email", `Cette invitation est destinée à ${inv.email}. Connectez-vous avec ce compte.`);
  await q("INSERT INTO memberships (household_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (household_id, user_id) DO NOTHING", [inv.household_id, user.id, inv.role]);
  await q("UPDATE invites SET accepted_at = now() WHERE id = $1", [inv.id]);
  notifyAccess(inv.household_id);
  return inv.household_id;
}

app.get("/api/auth/verify", h(async (req, res) => {
  const tok = await useEmailToken("verify", req.query.token);
  if (!tok) return res.redirect("/?e=lien");
  await q("UPDATE users SET verified_at = coalesce(verified_at, now()) WHERE id = $1", [tok.user_id]);
  const user = (await q("SELECT * FROM users WHERE id = $1", [tok.user_id])).rows[0];
  let hid = "";
  if (tok.data && tok.data.invite) { try { hid = await acceptInvite(tok.data.invite, user); } catch {} }
  await openSession(req, res, user.id, user.totp_on);
  res.redirect("/?ok=verifie" + (hid ? "&h=" + hid : ""));
}));

app.post("/api/auth/login", h(async (req, res) => {
  const email = normEmail(req.body.email), password = String(req.body.password || "");
  limit("login:" + req.ip, 20, 15 * 60e3); limit("login:" + email, 8, 15 * 60e3);
  const user = (await q("SELECT * FROM users WHERE lower(email) = $1", [email])).rows[0];
  const ok = await verifyPassword(password, user ? user.pass : DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, "bad_credentials", "E-mail ou mot de passe incorrect.");
  if (!user.verified_at) {
    try { limit("resend:" + user.id, 3, 3600e3); await sendVerification(user); } catch {}
    throw new HttpError(403, "unverified", "Adresse non confirmée : un nouvel e-mail de confirmation vient d'être envoyé.");
  }
  await openSession(req, res, user.id, user.totp_on);
  res.json({ ok: true, mfa: user.totp_on });
}));

app.post("/api/auth/mfa", h(async (req, res) => {
  if (!req.user || !req.sess.mfaPending) throw new HttpError(401, "unauthenticated", "Session expirée, reconnectez-vous.");
  limit("mfa:" + req.user.id, 8, 15 * 60e3);
  const code = String(req.body.code || "").trim();
  const u = req.user;
  let ok = false;
  const st = totpCheck(u.totp_secret, code, Number(u.totp_last_step));
  if (st) { ok = true; await q("UPDATE users SET totp_last_step = $2 WHERE id = $1", [u.id, st]); }
  else {
    const hc = sha(code.toUpperCase().replace(/[^A-Z0-9]/g, "")), codes = u.backup_codes || [];
    if (codes.includes(hc)) { ok = true; await q("UPDATE users SET backup_codes = $2 WHERE id = $1", [u.id, JSON.stringify(codes.filter(c => c !== hc))]); }
  }
  if (!ok) throw new HttpError(401, "bad_code", "Code incorrect.");
  await q("UPDATE sessions SET mfa_pending = false WHERE id = $1", [req.sess.id]);
  res.json({ ok: true });
}));

app.post("/api/auth/magic", h(async (req, res) => {
  const email = normEmail(req.body.email);
  limit("magic:" + req.ip, 10, 3600e3); limit("magic:" + email, 4, 3600e3);
  const user = (await q("SELECT * FROM users WHERE lower(email) = $1 AND verified_at IS NOT NULL", [email])).rows[0];
  if (user) {
    const t = await makeEmailToken("magic", user.id, {}, 15 * 60e3);
    await sendMail(user.email, "Votre lien de connexion", "Connexion", "Voici votre lien de connexion. Il est valable 15 minutes et ne fonctionne qu'une fois.", "Me connecter", `${CFG.appUrl}/api/auth/magic?token=${t}`);
  }
  res.json(GENERIC_SENT);
}));

app.get("/api/auth/magic", h(async (req, res) => {
  const tok = await useEmailToken("magic", req.query.token);
  if (!tok) return res.redirect("/?e=lien");
  const user = (await q("SELECT * FROM users WHERE id = $1", [tok.user_id])).rows[0];
  if (!user) return res.redirect("/?e=lien");
  await openSession(req, res, user.id, user.totp_on);
  res.redirect("/");
}));

app.post("/api/auth/forgot", h(async (req, res) => {
  const email = normEmail(req.body.email);
  limit("forgot:" + req.ip, 10, 3600e3); limit("forgot:" + email, 3, 3600e3);
  const user = (await q("SELECT * FROM users WHERE lower(email) = $1", [email])).rows[0];
  if (user) {
    const t = await makeEmailToken("reset", user.id, {}, 3600e3);
    await sendMail(user.email, "Réinitialiser votre mot de passe", "Mot de passe oublié", "Choisissez un nouveau mot de passe. Ce lien est valable 1 heure.", "Choisir un mot de passe", `${CFG.appUrl}/?reset=${t}`);
  }
  res.json(GENERIC_SENT);
}));

app.post("/api/auth/reset", h(async (req, res) => {
  checkPassword(req.body.password);
  const tok = await useEmailToken("reset", req.body.token);
  if (!tok) throw bad("token_invalid", "Ce lien n'est plus valable.");
  await q("UPDATE users SET pass = $2, verified_at = coalesce(verified_at, now()) WHERE id = $1", [tok.user_id, await hashPassword(req.body.password)]);
  await q("DELETE FROM sessions WHERE user_id = $1", [tok.user_id]);
  res.json({ ok: true });
}));

app.post("/api/auth/logout", h(async (req, res) => {
  if (req.sess) await q("DELETE FROM sessions WHERE id = $1", [req.sess.id]);
  setCookie(res, "", 0); res.json({ ok: true });
}));
app.post("/api/auth/logout-all", requireUser, h(async (req, res) => {
  await q("DELETE FROM sessions WHERE user_id = $1", [req.user.id]);
  setCookie(res, "", 0); res.json({ ok: true });
}));

/* ---------------------------- Compte ---------------------------- */
app.get("/api/me", h(async (req, res) => {
  if (!req.user) throw new HttpError(401, "unauthenticated", "Connexion requise.");
  if (req.sess.mfaPending) return res.json({ mfa: true, email: req.user.email });
  const hs = (await q(`SELECT h.id, h.name, m.role, (SELECT count(*) FROM memberships x WHERE x.household_id = h.id)::int AS members
    FROM memberships m JOIN households h ON h.id = m.household_id WHERE m.user_id = $1 ORDER BY h.created_at`, [req.user.id])).rows;
  const u = req.user;
  res.json({ user: { id: u.id, email: u.email, name: u.name, avatar: u.avatar, banner: u.banner, bio: u.bio || "", xp: u.xp, badges: u.badges, totp: u.totp_on, backupLeft: (u.backup_codes || []).length }, households: hs });
}));
app.patch("/api/me", requireUser, h(async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 60); if (!name) throw bad("bad_name", "Nom requis.");
  const bio = req.body.bio == null ? undefined : String(req.body.bio).trim().slice(0, 280);
  if (bio === undefined) await q("UPDATE users SET name = $2 WHERE id = $1", [req.user.id, name]);
  else await q("UPDATE users SET name = $2, bio = $3 WHERE id = $1", [req.user.id, name, bio]);
  res.json({ ok: true });
}));
function checkImageDataUrl(image, maxLen) {
  if (typeof image !== "string" || !/^data:image\/(png|jpe?g|webp);base64,/.test(image)) throw bad("bad_image", "Image invalide.");
  if (image.length > maxLen) throw new HttpError(413, "quota_exceeded", "Image trop volumineuse.");
}
app.post("/api/me/avatar", requireUser, h(async (req, res) => {
  const image = req.body.image === null ? null : req.body.image;
  if (image !== null) checkImageDataUrl(image, 180000);
  await q("UPDATE users SET avatar = $2 WHERE id = $1", [req.user.id, image]);
  res.json({ ok: true });
}));
app.post("/api/me/banner", requireUser, h(async (req, res) => {
  const image = req.body.image === null ? null : req.body.image;
  if (image !== null) checkImageDataUrl(image, 260000);
  await q("UPDATE users SET banner = $2 WHERE id = $1", [req.user.id, image]);
  res.json({ ok: true });
}));
app.post("/api/me/password", requireUser, h(async (req, res) => {
  limit("pw:" + req.user.id, 6, 3600e3);
  if (!await verifyPassword(String(req.body.current || ""), req.user.pass)) throw new HttpError(401, "bad_password", "Mot de passe actuel incorrect.");
  checkPassword(req.body.password);
  await q("UPDATE users SET pass = $2 WHERE id = $1", [req.user.id, await hashPassword(req.body.password)]);
  await q("DELETE FROM sessions WHERE user_id = $1 AND id <> $2", [req.user.id, req.sess.id]);
  res.json({ ok: true });
}));
app.post("/api/me/totp/setup", requireUser, h(async (req, res) => {
  const secret = b32enc(crypto.randomBytes(20));
  await q("UPDATE users SET totp_pending = $2 WHERE id = $1", [req.user.id, secret]);
  const label = encodeURIComponent(`${CFG.appName}:${req.user.email}`);
  const url = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(CFG.appName)}&digits=6&period=30`;
  res.json({ secret, url, qr: await QRCode.toDataURL(url, { margin: 1, width: 240 }) });
}));
app.post("/api/me/totp/enable", requireUser, h(async (req, res) => {
  const u = (await q("SELECT * FROM users WHERE id = $1", [req.user.id])).rows[0];
  if (!u.totp_pending) throw bad("no_setup", "Relancez l'activation.");
  const st = totpCheck(u.totp_pending, req.body.code, 0);
  if (!st) throw bad("bad_code", "Code incorrect. Vérifiez l'heure de votre téléphone.");
  const codes = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString("hex").toUpperCase());
  await q("UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_on = true, totp_last_step = $2, backup_codes = $3 WHERE id = $1", [u.id, st, JSON.stringify(codes.map(c => sha(c)))]);
  await q("DELETE FROM sessions WHERE user_id = $1 AND id <> $2", [u.id, req.sess.id]);
  res.json({ ok: true, backupCodes: codes.map(c => c.slice(0, 5) + "-" + c.slice(5)) });
}));
app.post("/api/me/totp/disable", requireUser, h(async (req, res) => {
  if (!await verifyPassword(String(req.body.password || ""), req.user.pass)) throw new HttpError(401, "bad_password", "Mot de passe incorrect.");
  await q("UPDATE users SET totp_on = false, totp_secret = NULL, totp_pending = NULL, backup_codes = '[]' WHERE id = $1", [req.user.id]);
  res.json({ ok: true });
}));

/* ---------------------------- Foyers ---------------------------- */
app.post("/api/households", requireUser, h(async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 40); if (!name) throw bad("bad_name", "Donnez un nom au foyer.");
  const n = (await q("SELECT count(*)::int AS n FROM memberships WHERE user_id = $1 AND role = 'owner'", [req.user.id])).rows[0].n;
  if (n >= 20) throw bad("too_many", "Limite de 20 foyers atteinte.");
  const id = uuid();
  await q("INSERT INTO households (id, name, created_by) VALUES ($1,$2,$3)", [id, name, req.user.id]);
  await q("INSERT INTO memberships (household_id, user_id, role) VALUES ($1,$2,'owner')", [id, req.user.id]);
  res.json({ id, name, role: "owner" });
}));

const member = h(async (req, res, next) => {
  const r = (await q("SELECT m.role, h.name FROM memberships m JOIN households h ON h.id = m.household_id WHERE m.household_id = $1 AND m.user_id = $2", [req.params.hid, req.user.id])).rows[0];
  if (!r) throw new HttpError(404, "not_found", "Foyer introuvable.");
  req.role = r.role; req.hname = r.name; next();
});
const ownerOnly = (req, res, next) => req.role === "owner" ? next() : next(new HttpError(403, "not_granted", "Réservé au propriétaire du foyer."));

app.patch("/api/h/:hid", requireUser, member, ownerOnly, h(async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 40); if (!name) throw bad("bad_name", "Nom requis.");
  await q("UPDATE households SET name = $2 WHERE id = $1", [req.params.hid, name]); notifyAccess(req.params.hid); res.json({ ok: true });
}));
app.delete("/api/h/:hid", requireUser, member, ownerOnly, h(async (req, res) => {
  if (String(req.body.confirm || "") !== req.hname) throw bad("confirm", "Tapez exactement le nom du foyer pour confirmer.");
  await q("DELETE FROM households WHERE id = $1", [req.params.hid]); notifyAccess(req.params.hid); res.json({ ok: true });
}));

/* ---------------------------- Membres et invitations ---------------------------- */
const ROLE_FR = { owner: "propriétaire", contributor: "contributeur", viewer: "lecteur" };
app.get("/api/h/:hid/members", requireUser, member, h(async (req, res) => {
  const members = (await q(`SELECT u.id, u.email, u.name, u.avatar, u.bio, u.xp, u.badges, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.household_id = $1 ORDER BY m.created_at`, [req.params.hid])).rows;
  const invites = req.role === "owner" ? (await q("SELECT id, email, role, created_at, expires_at FROM invites WHERE household_id = $1 AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC", [req.params.hid])).rows : [];
  res.json({ role: req.role, members: members.map(m => ({ ...m, me: m.id === req.user.id })), invites });
}));
app.post("/api/h/:hid/invites", requireUser, member, ownerOnly, h(async (req, res) => {
  const email = normEmail(req.body.email), role = req.body.role === "viewer" ? "viewer" : "contributor";
  limit("invite:" + req.user.id, 30, 3600e3);
  if (!EMAIL_RE.test(email)) throw bad("bad_email", "Adresse e-mail invalide.");
  const already = (await q("SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.household_id = $1 AND lower(u.email) = $2", [req.params.hid, email])).rows[0];
  if (already) throw new HttpError(409, "already_member", "Cette personne fait déjà partie du foyer.");
  await q("DELETE FROM invites WHERE household_id = $1 AND lower(email) = $2 AND accepted_at IS NULL", [req.params.hid, email]);
  const t = newToken(), id = uuid();
  await q("INSERT INTO invites (id, token_hash, household_id, email, role, invited_by, expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + interval '7 days')", [id, sha(t), req.params.hid, email, role, req.user.id]);
  const hasAccount = !!(await q("SELECT 1 FROM users WHERE lower(email) = $1 AND verified_at IS NOT NULL", [email])).rows[0];
  await sendMail(email, `${req.user.name} vous invite dans « ${req.hname} »`, "Invitation",
    `<b>${esc(req.user.name)}</b> vous invite à rejoindre le foyer <b>${esc(req.hname)}</b> sur ${esc(CFG.appName)} en tant que <b>${ROLE_FR[role]}</b>.${hasAccount ? "" : " Vous pourrez créer votre compte en suivant le lien."} L'invitation est valable 7 jours.`,
    hasAccount ? "Rejoindre le foyer" : "Créer mon compte", `${CFG.appUrl}/?invite=${t}`);
  res.json({ ok: true, id });
}));
app.delete("/api/h/:hid/invites/:iid", requireUser, member, ownerOnly, h(async (req, res) => {
  await q("DELETE FROM invites WHERE id = $1 AND household_id = $2", [req.params.iid, req.params.hid]); res.json({ ok: true });
}));
async function ownersCount(hid) { return (await q("SELECT count(*)::int AS n FROM memberships WHERE household_id = $1 AND role = 'owner'", [hid])).rows[0].n; }
app.patch("/api/h/:hid/members/:uid", requireUser, member, ownerOnly, h(async (req, res) => {
  const role = req.body.role; if (!ROLE_FR[role]) throw bad("bad_role", "Rôle inconnu.");
  const cur = (await q("SELECT role FROM memberships WHERE household_id = $1 AND user_id = $2", [req.params.hid, req.params.uid])).rows[0];
  if (!cur) throw new HttpError(404, "not_found", "Membre introuvable.");
  if (cur.role === "owner" && role !== "owner" && await ownersCount(req.params.hid) <= 1) throw bad("last_owner", "Le foyer doit garder au moins un propriétaire.");
  await q("UPDATE memberships SET role = $3 WHERE household_id = $1 AND user_id = $2", [req.params.hid, req.params.uid, role]);
  notifyAccess(req.params.hid, req.params.uid); res.json({ ok: true });
}));
app.delete("/api/h/:hid/members/:uid", requireUser, member, h(async (req, res) => {
  const self = req.params.uid === req.user.id;
  if (!self && req.role !== "owner") throw new HttpError(403, "not_granted", "Réservé au propriétaire du foyer.");
  const cur = (await q("SELECT role FROM memberships WHERE household_id = $1 AND user_id = $2", [req.params.hid, req.params.uid])).rows[0];
  if (!cur) throw new HttpError(404, "not_found", "Membre introuvable.");
  if (cur.role === "owner" && await ownersCount(req.params.hid) <= 1) throw bad("last_owner", "Le foyer doit garder au moins un propriétaire.");
  await q("DELETE FROM memberships WHERE household_id = $1 AND user_id = $2", [req.params.hid, req.params.uid]);
  notifyAccess(req.params.hid, req.params.uid); res.json({ ok: true });
}));
app.get("/api/invites/:token", h(async (req, res) => {
  const r = (await q(`SELECT i.email, i.role, i.expires_at, i.accepted_at, h.name AS household, u.name AS inviter
    FROM invites i JOIN households h ON h.id = i.household_id LEFT JOIN users u ON u.id = i.invited_by WHERE i.token_hash = $1`, [sha(req.params.token)])).rows[0];
  if (!r || r.accepted_at || new Date(r.expires_at) < new Date()) return res.json({ valid: false });
  const hasAccount = !!(await q("SELECT 1 FROM users WHERE lower(email) = $1", [normEmail(r.email)])).rows[0];
  res.json({ valid: true, email: r.email, role: r.role, household: r.household, inviter: r.inviter, hasAccount });
}));
app.post("/api/invites/:token/accept", requireUser, h(async (req, res) => { res.json({ ok: true, hid: await acceptInvite(req.params.token, req.user) }); }));

/* ---------------------------- Gamification (XP, badges) ---------------------------- */
// XP accordé automatiquement à la création (pas à la modification) d'un document dans ces collections.
const ACTION_XP = {
  expenses: 2, revenus: 2, remboursements: 3, epargne: 3, defis: 5, projets: 3, comptes: 3, dettes: 3,
  cagnotte: 2, argentdepoche: 2, garanties: 2, groupes: 2, courses: 1, factures: 1, repas: 1, papiers: 2,
  vehicules: 2, placards: 1, menage: 1, souhaits: 1, evenements: 1, compteurs: 1, bilans: 3, journal: 1, sante: 1, virements: 2,
};
// Catalogue serveur des badges : id -> xp accordé au déblocage (le client détermine QUAND un badge est débloqué,
// le serveur ne fait confiance qu'à cette table pour la VALEUR en xp, et n'accorde jamais deux fois le même id).
const BADGE_CATALOG = {
  premier_pas: 10, centurion_100: 60, centurion_500: 150, centurion_1000: 300, banquier: 20,
  dans_les_clous: 30, regularite_3: 80, regularite_6: 150, regularite_12: 300,
  fourmi_3: 60, fourmi_12: 200, objectif_atteint: 50, objectif_x5: 150, defi_releve: 40, semaine_zen: 40, prudent: 15,
  premiere_course: 10, course_50: 30, anti_gaspi: 20, garde_manger: 50, bien_range: 20, menage_fait: 20, chef: 20, gourmet: 60,
  planificateur: 20, facture_suivie: 20, projet_lance: 15, multi_projets: 40, equitable: 20, genereux: 15,
  vue_ensemble: 15, sous_controle: 15, bricoleur: 20, grand_routier: 30, garanties_ok: 15,
  argent_de_poche: 20, cagnotte_active: 15, journal_tenu: 20,
};

/* ---------------------------- Données du foyer ---------------------------- */
const COLL_RE = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+){0,6}$/, ID_RE = /^[A-Za-z0-9_\-.:@+~]{1,200}$/;
function docOwner(coll, uid) {
  if (!COLL_RE.test(coll) || coll.length > 160) throw bad("bad_path", "Chemin invalide.");
  if (coll.startsWith("data/users/")) { if (coll.split("/")[2] !== uid) throw new HttpError(403, "not_granted", "Accès refusé."); return uid; }
  if (coll === "data" || coll === "data/users") throw bad("bad_path", "Chemin invalide.");
  return "";
}
const isTickets = c => c === "tickets" || c.includes("/_tickets/");

app.get("/api/h/:hid/data", requireUser, member, h(async (req, res) => {
  const docs = await asUser(req.user.id, c => c.query("SELECT coll, id, data FROM docs WHERE household_id = $1 AND (owner = '' OR owner = $2) AND coll <> 'tickets' AND coll NOT LIKE '%/\\_tickets/%'", [req.params.hid, req.user.id]));
  res.json({ household: { id: req.params.hid, name: req.hname, role: req.role }, me: { id: req.user.id, email: req.user.email, name: req.user.name, avatar: req.user.avatar, bio: req.user.bio || "", xp: req.user.xp, badges: req.user.badges }, docs: docs.rows });
}));
app.post("/api/me/badges", requireUser, h(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(id => typeof id === "string" && BADGE_CATALOG[id]).slice(0, 50) : [];
  const have = new Set((req.user.badges || []).map(b => b.id));
  const fresh = ids.filter(id => !have.has(id));
  let xp = req.user.xp, badges = req.user.badges || [];
  if (fresh.length) {
    const gained = fresh.reduce((s, id) => s + BADGE_CATALOG[id], 0);
    badges = badges.concat(fresh.map(id => ({ id, unlockedAt: new Date().toISOString() })));
    await q("UPDATE users SET xp = xp + $2, badges = $3 WHERE id = $1", [req.user.id, gained, JSON.stringify(badges)]);
    xp += gained;
  }
  res.json({ xp, badges });
}));
app.get("/api/h/:hid/doc", requireUser, member, h(async (req, res) => {
  const coll = String(req.query.coll || ""), id = String(req.query.id || ""); docOwner(coll, req.user.id);
  if (!ID_RE.test(id)) throw bad("bad_id", "Identifiant invalide.");
  const r = await asUser(req.user.id, c => c.query("SELECT data FROM docs WHERE household_id = $1 AND coll = $2 AND id = $3 AND (owner = '' OR owner = $4)", [req.params.hid, coll, id, req.user.id]));
  res.json(r.rows[0] ? { exists: true, data: r.rows[0].data } : { exists: false });
}));
app.put("/api/h/:hid/doc", requireUser, member, h(async (req, res) => {
  if (req.role === "viewer") throw new HttpError(403, "not_granted", "Vous avez un accès en lecture seule.");
  const coll = String(req.body.coll || ""), id = String(req.body.id || ""), data = req.body.data;
  const owner = docOwner(coll, req.user.id);
  if (!ID_RE.test(id)) throw bad("bad_id", "Identifiant invalide.");
  if (!data || typeof data !== "object" || Array.isArray(data)) throw bad("bad_data", "Document invalide.");
  const json = JSON.stringify(data);
  if (json.length > 300000) throw new HttpError(413, "quota_exceeded", "Document trop volumineux.");
  const xpGain = ACTION_XP[coll] || 0;
  await asUser(req.user.id, async c => {
    const ins = await c.query(`INSERT INTO docs (household_id, coll, id, owner, data, updated_by) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (household_id, coll, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by WHERE docs.owner = EXCLUDED.owner
      RETURNING (xmax = 0) AS inserted`, [req.params.hid, coll, id, owner, json, req.user.id]);
    if (xpGain && ins.rows[0] && ins.rows[0].inserted) await c.query("UPDATE users SET xp = xp + $2 WHERE id = $1", [req.user.id, xpGain]);
    const payload = { t: "doc", hid: req.params.hid, coll, id, owner, by: req.user.id };
    if (json.length < 7000 && !isTickets(coll)) payload.data = data; else payload.big = true;
    await c.query("SELECT pg_notify('pc_docs', $1)", [JSON.stringify(payload)]);
  });
  res.json({ ok: true });
}));
app.delete("/api/h/:hid/doc", requireUser, member, h(async (req, res) => {
  if (req.role === "viewer") throw new HttpError(403, "not_granted", "Vous avez un accès en lecture seule.");
  const coll = String(req.query.coll || ""), id = String(req.query.id || ""), owner = docOwner(coll, req.user.id);
  if (!ID_RE.test(id)) throw bad("bad_id", "Identifiant invalide.");
  await asUser(req.user.id, async c => {
    await c.query("DELETE FROM docs WHERE household_id = $1 AND coll = $2 AND id = $3 AND owner = $4", [req.params.hid, coll, id, owner]);
    await c.query("SELECT pg_notify('pc_docs', $1)", [JSON.stringify({ t: "doc", hid: req.params.hid, coll, id, owner, deleted: true, by: req.user.id })]);
  });
  res.json({ ok: true });
}));

/* ---------------------------- Agenda : flux ICS ---------------------------- */
function icsEscape(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/[,;]/g, m => "\\" + m).replace(/\r?\n/g, "\\n"); }
function icsDate(d) { return String(d || "").replace(/-/g, ""); }
function buildIcs(householdName, events, todos) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DAFeuille//Agenda//FR", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsEscape(householdName + " · DAFeuille")}`];
  for (const e of events) {
    if (!e.date) continue;
    lines.push("BEGIN:VEVENT", `UID:evt-${e.id}@dafeuille`, `DTSTART;VALUE=DATE:${icsDate(e.date)}`, `SUMMARY:${icsEscape(e.title || "Événement")}`);
    if (e.yearly) lines.push("RRULE:FREQ=YEARLY");
    lines.push("END:VEVENT");
  }
  for (const t of todos) {
    if (!t.due || t.done) continue;
    lines.push("BEGIN:VEVENT", `UID:todo-${t.id}@dafeuille`, `DTSTART;VALUE=DATE:${icsDate(t.due)}`, `SUMMARY:${icsEscape("Facture : " + (t.title || ""))}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
app.post("/api/h/:hid/ics-token", requireUser, member, h(async (req, res) => {
  const token = newToken();
  await q("UPDATE households SET ics_token = $2 WHERE id = $1", [req.params.hid, token]);
  res.json({ url: `${CFG.appUrl}/api/ics/${token}` });
}));
app.delete("/api/h/:hid/ics-token", requireUser, member, h(async (req, res) => {
  await q("UPDATE households SET ics_token = NULL WHERE id = $1", [req.params.hid]);
  res.json({ ok: true });
}));
app.get("/api/ics/:token", h(async (req, res) => {
  limit("ics:" + req.ip, 120, 3600e3);
  const hh = (await q("SELECT id, name, created_by FROM households WHERE ics_token = $1", [req.params.token])).rows[0];
  if (!hh) throw new HttpError(404, "not_found", "Lien invalide.");
  const docs = (await asUser(hh.created_by, c => c.query("SELECT coll, id, data FROM docs WHERE household_id = $1 AND coll IN ('evenements','factures')", [hh.id]))).rows;
  const events = docs.filter(d => d.coll === "evenements").map(d => ({ ...d.data, id: d.id }));
  const todos = docs.filter(d => d.coll === "factures").map(d => ({ ...d.data, id: d.id }));
  res.set("Content-Type", "text/calendar; charset=utf-8");
  res.send(buildIcs(hh.name, events, todos));
}));

/* ---------------------------- Groupes : lien public "entre amis" ---------------------------- */
app.post("/api/h/:hid/groups/:gid/link/rotate", requireUser, member, h(async (req, res) => {
  if (req.role === "viewer") throw new HttpError(403, "not_granted", "Vous avez un accès en lecture seule.");
  const exists = await asUser(req.user.id, c => c.query("SELECT 1 FROM docs WHERE household_id = $1 AND coll = 'groupes' AND id = $2", [req.params.hid, req.params.gid]));
  if (!exists.rows[0]) throw new HttpError(404, "not_found", "Groupe introuvable.");
  await q("UPDATE group_links SET revoked_at = now() WHERE household_id = $1 AND group_id = $2 AND revoked_at IS NULL", [req.params.hid, req.params.gid]);
  const token = newToken();
  await q("INSERT INTO group_links (id, token, household_id, group_id, created_by) VALUES ($1,$2,$3,$4,$5)", [uuid(), token, req.params.hid, req.params.gid, req.user.id]);
  res.json({ token, url: `${CFG.appUrl}/?groupe=${token}` });
}));
app.get("/api/h/:hid/groups/:gid/link", requireUser, member, h(async (req, res) => {
  const r = (await q("SELECT token, created_at FROM group_links WHERE household_id = $1 AND group_id = $2 AND revoked_at IS NULL", [req.params.hid, req.params.gid])).rows[0];
  res.json(r ? { token: r.token, url: `${CFG.appUrl}/?groupe=${r.token}`, createdAt: r.created_at } : { token: null });
}));
app.delete("/api/h/:hid/groups/:gid/link", requireUser, member, h(async (req, res) => {
  if (req.role === "viewer") throw new HttpError(403, "not_granted", "Vous avez un accès en lecture seule.");
  await q("UPDATE group_links SET revoked_at = now() WHERE household_id = $1 AND group_id = $2 AND revoked_at IS NULL", [req.params.hid, req.params.gid]);
  res.json({ ok: true });
}));
async function groupLink(token) {
  const r = (await q("SELECT * FROM group_links WHERE token = $1 AND revoked_at IS NULL", [token])).rows[0];
  if (!r) throw new HttpError(404, "not_found", "Lien invalide ou révoqué.");
  return r;
}
app.get("/api/public/group/:token", h(async (req, res) => {
  limit("pub-group-ip:" + req.ip, 120, 3600e3);
  const gl = await groupLink(req.params.token);
  const r = (await asUser(gl.created_by, c => c.query("SELECT data FROM docs WHERE household_id = $1 AND coll = 'groupes' AND id = $2", [gl.household_id, gl.group_id]))).rows[0];
  if (!r) throw new HttpError(404, "not_found", "Groupe introuvable.");
  const g = r.data;
  res.json({ name: g.name, people: g.people || [], items: g.items || [] });
}));
app.post("/api/public/group/:token/item", h(async (req, res) => {
  limit("pub-group:" + req.params.token, 40, 3600e3);
  limit("pub-group-ip:" + req.ip, 40, 3600e3);
  const gl = await groupLink(req.params.token);
  const label = String(req.body.label || "").trim().slice(0, 80);
  const amount = +req.body.amount;
  const payerName = String(req.body.payerName || "").trim().slice(0, 30);
  const payerId = String(req.body.payerId || "").trim();
  const parts = Array.isArray(req.body.parts) ? req.body.parts.filter(p => typeof p === "string").slice(0, 50) : null;
  if (!label || !(amount > 0) || amount > 1000000) throw bad("bad_data", "Dépense invalide.");
  if (!payerId && !payerName) throw bad("bad_data", "Indiquez qui a payé.");
  await asUser(gl.created_by, async c => {
    const r = await c.query("SELECT data FROM docs WHERE household_id = $1 AND coll = 'groupes' AND id = $2 FOR UPDATE", [gl.household_id, gl.group_id]);
    if (!r.rows[0]) throw new HttpError(404, "not_found", "Groupe introuvable.");
    const g = r.rows[0].data;
    g.people = g.people || []; g.items = g.items || [];
    let pid = payerId && g.people.some(p => p.id === payerId) ? payerId : null;
    if (!pid) { pid = uuid().slice(0, 8); g.people.push({ id: pid, name: payerName || "Ami" }); }
    g.items.push({ id: uuid().slice(0, 8), label, amount, payer: pid, parts: parts && parts.length ? parts : g.people.map(p => p.id), date: new Date().toISOString().slice(0, 10), createdAt: Date.now() });
    await c.query("UPDATE docs SET data = $3, updated_at = now() WHERE household_id = $1 AND coll = 'groupes' AND id = $2", [gl.household_id, gl.group_id, JSON.stringify(g)]);
    await c.query("SELECT pg_notify('pc_docs', $1)", [JSON.stringify({ t: "doc", hid: gl.household_id, coll: "groupes", id: gl.group_id, owner: "", data: g })]);
  });
  res.json({ ok: true });
}));

/* ---------------------------- Temps réel (SSE + LISTEN/NOTIFY) ---------------------------- */
const streams = new Set();
app.get("/api/h/:hid/events", requireUser, member, (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write("retry: 4000\n\n");
  const s = { hid: req.params.hid, uid: req.user.id, res };
  streams.add(s);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(ping); streams.delete(s); });
});
function dispatch(msg) {
  for (const s of streams) {
    if (s.hid !== msg.hid) continue;
    if (msg.t === "doc" && msg.owner && msg.owner !== s.uid) continue;
    if (msg.t === "access" && msg.uid && msg.uid !== s.uid) { continue; }
    s.res.write(`data: ${JSON.stringify(msg)}\n\n`);
  }
}
function notifyAccess(hid, uid) { q("SELECT pg_notify('pc_docs', $1)", [JSON.stringify({ t: "access", hid, uid: uid || null })]).catch(() => {}); }
async function startListener() {
  const c = new Client({ connectionString: CFG.dbUrl });
  c.on("notification", n => { try { dispatch(JSON.parse(n.payload)); } catch {} });
  c.on("error", () => { setTimeout(() => startListener().catch(() => {}), 3000); });
  await c.connect(); await c.query("LISTEN pc_docs");
}

/* ---------------------------- Fichiers de l'app ---------------------------- */
app.use(express.static(CFG.publicDir, {
  index: "index.html",
  setHeaders: (res, p) => { if (/index\.html$|sw\.js$|manifest\.json$/.test(p)) res.set("Cache-Control", "no-cache"); else res.set("Cache-Control", "public, max-age=86400"); }
}));

/* ---------------------------- Erreurs ---------------------------- */
app.use("/api", (req, res) => res.status(404).json({ error: "not_found", message: "Introuvable." }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "quota_exceeded", message: "Données trop volumineuses." });
  if (err && err.code === "42501") return res.status(403).json({ error: "not_granted", message: "Accès refusé." });
  console.error(err);
  res.status(500).json({ error: "server", message: "Erreur du serveur." });
});

/* ---------------------------- Nettoyage périodique ---------------------------- */
setInterval(() => {
  q("DELETE FROM sessions WHERE expires_at < now()").catch(() => {});
  q("DELETE FROM email_tokens WHERE expires_at < now() - interval '1 day'").catch(() => {});
  q("DELETE FROM invites WHERE accepted_at IS NULL AND expires_at < now() - interval '30 days'").catch(() => {});
  q("DELETE FROM users WHERE verified_at IS NULL AND created_at < now() - interval '14 days'").catch(() => {});
}, 3600e3).unref();

/* ---------------------------- Démarrage ---------------------------- */
(async () => {
  for (let i = 0; ; i++) {
    try { await checkDbRole(); await applySchema(); break; }
    catch (e) { if (e.fatal || i > 20) throw e; console.log("En attente de PostgreSQL…"); await new Promise(r => setTimeout(r, 2000)); }
  }
  await startListener();
  app.listen(CFG.port, () => console.log(`${CFG.appName} prêt sur le port ${CFG.port} (${CFG.appUrl})${transport ? "" : " — e-mails affichés dans la console (SMTP non configuré)"}`));
})().catch(e => { console.error(e); process.exit(1); });
