/* Relevés bancaires : lecture CSV (banques et applis de dépenses), OFX/QFX et QIF. Montants en centimes, signés
   (négatif = dépense, positif = revenu). Portage tel quel de l'ancienne interface. */
import { pad, norm, members, allCats } from "./core.js";

export function splitCSV(text){
  const lines = text.replace(/^\ufeff/, "").split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const probe = lines.slice(0, 15).join("\n");
  const delim = [";", ",", "\t", "|"].map(d => [d, probe.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  for (const line of lines) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"') { if (line[i+1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    out.push(cur.trim()); rows.push(out);
  }
  return rows;
}
export function bankAmount(s){
  let t = String(s || "").replace(/[\s\u00a0\u202f€]|EUR/g, "");
  if (!t) return NaN;
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else t = t.replace(",", ".");
  const v = parseFloat(t); return Number.isFinite(v) ? Math.round(v * 100) : NaN;
}
export function bankDate(s){
  s = String(s || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${pad(+m[2])}-${pad(+m[1])}`; }
  return null;
}
export const htmlEnt = s => String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
/* OFX/QFX (SGML v1 sans balises fermantes, ou XML v2) : un <STMTTRN> par opération, montant signé. */
export function parseOFX(text){
  const out = [];
  for (const b of text.split(/<STMTTRN>/i).slice(1)) {
    const f = tag => { const m = b.match(new RegExp("<" + tag + ">([^<\\r\\n]*)", "i")); return m ? htmlEnt(m[1].trim()) : ""; };
    const d = f("DTPOSTED").match(/^(\d{4})(\d{2})(\d{2})/), amount = bankAmount(f("TRNAMT"));
    if (!d || !Number.isFinite(amount) || !amount) continue;
    const label = [f("NAME"), f("MEMO")].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(" · ").replace(/\s+/g, " ").slice(0, 80);
    out.push({date:`${d[1]}-${d[2]}-${d[3]}`, label:label || f("TRNTYPE") || "Opération", amount, fitid:f("FITID")});
  }
  if (!out.length) throw new Error("Aucune opération trouvée dans ce fichier OFX.");
  return out;
}
/* QIF : enregistrements séparés par ^ ; D date, T/U montant, P tiers, M mémo. L'ordre jour/mois des dates
   est déduit du fichier (un nombre > 12 tranche), français (JJ/MM) par défaut. */
export function parseQIF(text){
  const recs = [], dates = [];
  let cur = {};
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim(); if (!l || l.startsWith("!")) continue;
    const k = l[0], v = l.slice(1).trim();
    if (k === "^") { if (cur.D) recs.push(cur); cur = {}; continue; }
    if ("DTUPMN".includes(k) && !(k === "U" && cur.T)) cur[k === "U" ? "T" : k] = v;
  }
  if (cur.D) recs.push(cur);
  const parts = recs.map(r => r.D.replace(/'/g, "/").split(/[\/.\-]/).map(x => x.trim()));
  const dmy = !parts.some(p => p[0].length !== 4 && +p[1] > 12);   // un 2e nombre > 12 ⇒ format américain MM/JJ
  const out = [];
  recs.forEach((r, i) => {
    const p = parts[i]; let y, m, d;
    if (p[0].length === 4) [y, m, d] = p; else if (dmy) [d, m, y] = p; else [m, d, y] = p;
    y = +y; if (y < 100) y += 2000;
    const amount = bankAmount(r.T); if (!Number.isFinite(amount) || !amount || !(+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31)) return;
    const label = [r.P, r.M].filter(Boolean).join(" · ").replace(/\s+/g, " ").slice(0, 80);
    out.push({date:`${y}-${pad(+m)}-${pad(+d)}`, label:label || "Opération", amount, fitid:r.N || ""});
  });
  if (!out.length) throw new Error("Aucune opération trouvée dans ce fichier QIF.");
  return out;
}
/* CSV : relevés bancaires (débit/crédit ou montant signé) et exports d'autres applis de dépenses
   (Tricount, Splitwise… : montants positifs, colonnes « Payé par », « Catégorie »).
   Montant renvoyé signé : négatif = dépense, positif = revenu. */
export function parseBank(text){
  const rows = splitCSV(text);
  const hi = rows.findIndex(r => r.some(c => /date/i.test(c)) && r.some(c => /montant|d[ée]bit|amount|cr[ée]dit|valeur|prix/i.test(c)));
  if (hi < 0) throw new Error("Colonnes introuvables : il faut au moins une colonne « Date » et une colonne « Montant » (ou « Débit »).");
  const h = rows[hi].map(c => norm(c));
  const find = re => h.findIndex(c => re.test(c));
  const iDate = find(/date/), iLab = find(/libell|descr|intitul|operation|detail|label|nature|tiers|beneficiaire|titre|title|what|objet/);
  const iAmt = find(/montant|amount|prix/), iDeb = find(/debit/), iCred = find(/credit/);
  const iPay = find(/paye par|paid by|payeur|payer/), iCat = find(/categor/);
  const data = rows.slice(hi + 1);
  const anyNeg = iAmt >= 0 && data.some(r => bankAmount(r[iAmt]) < 0);   // aucun négatif = export d'appli : tout est dépense
  const out = [];
  for (const r of data) {
    const date = bankDate(r[iDate]); if (!date) continue;
    let amount = NaN;
    if (iDeb >= 0 && r[iDeb]) { const d = bankAmount(r[iDeb]); if (Number.isFinite(d) && d !== 0) amount = -Math.abs(d); }
    else if (iCred >= 0 && r[iCred]) { const c = bankAmount(r[iCred]); if (Number.isFinite(c) && c !== 0) amount = Math.abs(c); }
    else if (iAmt >= 0) { const a = bankAmount(r[iAmt]); if (Number.isFinite(a) && a !== 0) amount = anyNeg ? a : -Math.abs(a); }
    if (!Number.isFinite(amount) || !amount) continue;
    const label = (iLab >= 0 ? r[iLab] : r.filter((_, i) => ![iDate, iAmt, iDeb, iCred, iPay, iCat].includes(i)).join(" ")).replace(/\s+/g, " ").trim().slice(0, 80);
    const pn = iPay >= 0 ? norm(r[iPay]).trim() : "", payer = pn ? (members().find(m => norm(m.name).trim() === pn) || {}).id : null;
    const cn = iCat >= 0 ? norm(r[iCat]).trim() : "", cat = cn ? (allCats().find(c => norm(c.name).trim() === cn || cn.includes(norm(c.name).trim())) || {}).id : null;
    out.push({date, label, amount, payer:payer || null, cat:cat || null});
  }
  return out;
}
