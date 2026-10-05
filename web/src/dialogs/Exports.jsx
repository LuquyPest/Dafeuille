/* Exports : CSV du mois, PDF du mois / de l'année, dossier revenus et charges, classeur Excel 12 mois,
   récap du mois en image, notes de frais. Tout est généré dans le navigateur. */
import { useState } from "react";
import { Dialog, registerDialog } from "../ui/Dialog.jsx";
import { Icon } from "../ui/icons.jsx";
import { state, fmt, fmt0, fmtDay, monthLabel, todayStr, prevKey, pad, catOf, allCats, members, memberName, bud, eff, inMonth, totalOf, sumBy, incTotal, curKey } from "../lib/core.js";
import { savedIn, settlements, balancesAll } from "../lib/domain.js";
import { saveFile, savePdf } from "../lib/files.js";
import { buildXlsx } from "../lib/xlsx.js";

const n2 = c => (c / 100).toFixed(2).replace(".", ",");
export function csvMonth(){
  const rows = [["Date", "Libellé", "Catégorie", "Payé par", "Pour", "Fixe", "Commentaire", "Devise", "Montant d'origine", "Remboursement attendu", "Remboursé", "Montant (€)"]].concat(
    inMonth(state.expenses, state.month).sort((a, b) => a.date.localeCompare(b.date)).map(e => [e.date, e.label || "", catOf(e.cat).name, memberName(e.payer), e.split && e.split !== "all" ? memberName(e.split) : "Foyer",
      e.recurringId ? "oui" : "", e.note || "", e.currency || "EUR", e.currency ? n2(e.origAmount) : "", e.refund ? n2(e.refund.amount) : "", e.refund?.received ? "oui" : "", n2(e.amount)]));
  const csv = "﻿" + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  return saveFile(`depenses-${state.month}.csv`, csv, "text/csv;charset=utf-8");
}
export function pdfMonth(){
  const k = state.month, list = inMonth(state.expenses, k).sort((a, b) => a.date.localeCompare(b.date));
  const total = totalOf(list), inc = incTotal(inMonth(state.incomes, k)), saved = savedIn(k), budget = state.settings.budget || 0;
  const byCat = Object.entries(sumBy(list, e => catOf(e.cat).id)).sort((a, b) => b[1] - a[1]), cb = state.settings.catBudgets || {}, tr = settlements(balancesAll());
  const blocks = [
    {h:"Résumé", kv:[["Dépenses communes", fmt(total)], ...(budget ? [["Budget", fmt(budget)], ["Écart", fmt(budget - total)]] : []), ["Revenus", fmt(inc)], ["Épargné", fmt(saved)], ...(inc ? [["Reste à vivre", fmt(inc - total - saved)]] : [])]},
    {h:"Par catégorie", table:{head:["Catégorie", "Montant", "Budget", "%"], widths:[.46, .2, .2, .14], align:["l", "r", "r", "r"],
      rows:byCat.map(([id, v]) => [catOf(id).name, fmt(v), cb[id] ? fmt(cb[id]) : "-", Math.round(v / total * 100) + " %"]).concat([Object.assign(["Total", fmt(total), budget ? fmt(budget) : "-", ""], {bold:true})])}},
    {h:"Détail des dépenses", table:{head:["Date", "Libellé", "Catégorie", "Payé par", "Montant"], widths:[.12, .38, .18, .16, .16], align:["l", "l", "l", "l", "r"],
      rows:list.map(e => [fmtDay(e.date, {day:"2-digit", month:"2-digit"}), (e.label || catOf(e.cat).name) + (e.split && e.split !== "all" ? " (pour " + memberName(e.split) + ")" : "") + (e.note ? " - " + e.note : ""), catOf(e.cat).name, memberName(e.payer), fmt(eff(e))])}},
  ];
  if (members().length > 1) blocks.push({h:"Qui doit quoi (solde à ce jour)", p:tr.length ? tr.map(t => `${memberName(t.from)} doit ${fmt(t.amount)} à ${memberName(t.to)}`).join(". ") + "." : "Tout le monde est à l'équilibre."});
  return savePdf(`budget-${k}.pdf`, "Budget " + monthLabel(k), blocks);
}
export function pdfYear(){
  const y = String(state.year), yl = state.expenses.filter(e => String(e.date).startsWith(y)), ye = totalOf(yl);
  const byCat = Object.entries(sumBy(yl, e => catOf(e.cat).id)).sort((a, b) => b[1] - a[1]), months = []; for (let m = 1; m <= 12; m++) months.push(`${y}-${pad(m)}`);
  const dl = state.expenses.concat(state.privates).filter(e => e.deductible && String(e.date).startsWith(y)).sort((a, b) => a.date.localeCompare(b.date));
  const yinc = incTotal(state.incomes.filter(e => String(e.date).startsWith(y)));
  const blocks = [
    {h:"Résumé", kv:[["Dépenses communes", fmt(ye)], ["Revenus", fmt(yinc)], ["Solde", fmt(yinc - ye)]]},
    {h:"Par catégorie", table:{head:["Catégorie", "Total", "%"], widths:[.6, .25, .15], align:["l", "r", "r"], rows:byCat.map(([id, v]) => [catOf(id).name, fmt(v), Math.round(v / ye * 100) + " %"])}},
    {h:"Mois par mois", table:{head:["Mois", "Dépenses", "Revenus", "Solde"], widths:[.34, .22, .22, .22], align:["l", "r", "r", "r"],
      rows:months.map(k => { const d = totalOf(inMonth(state.expenses, k)), i = incTotal(inMonth(state.incomes, k)); return [monthLabel(k), fmt(d), fmt(i), fmt(i - d)]; })}},
  ];
  if (dl.length) blocks.push({h:"Dépenses déductibles des impôts", table:{head:["Date", "Libellé", "Catégorie", "Montant"], widths:[.16, .46, .2, .18], align:["l", "l", "l", "r"],
    rows:dl.map(e => [fmtDay(e.date, {day:"2-digit", month:"2-digit"}), e.label || "", catOf(e.cat).name, fmt(eff(e))]).concat([Object.assign(["Total", "", "", fmt(totalOf(dl))], {bold:true})])}});
  return savePdf(`bilan-${y}.pdf`, "Bilan " + y, blocks);
}
function pdfDossier(){
  const now = curKey(), ks = [prevKey(now), prevKey(prevKey(now)), prevKey(prevKey(prevKey(now)))].reverse();
  const incByLabel = {}; ks.forEach(k => inMonth(state.incomes, k).forEach(i => { const l = (i.label || "Revenu") + (i.who ? " (" + memberName(i.who) + ")" : ""); incByLabel[l] = (incByLabel[l] || 0) + i.amount / 3; }));
  const incAvg = Object.values(incByLabel).reduce((a, b) => a + b, 0), fixed = state.recurring.filter(r => r.kind !== "income"), fixedT = incTotal(fixed);
  const credits = state.debts.filter(d => d.remaining > 0), creditT = credits.reduce((s, d) => s + (d.monthly || 0), 0);
  const varByCat = {}; ks.forEach(k => inMonth(state.expenses, k).filter(e => bud(e) && !e.recurringId).forEach(e => { const c = catOf(e.cat).name; varByCat[c] = (varByCat[c] || 0) + eff(e) / 3; }));
  const varT = Object.values(varByCat).reduce((a, b) => a + b, 0), savings = state.accounts.filter(a => a.type !== "courant").reduce((s, a) => s + (a.balance || 0), 0);
  const blocks = [
    {p:`Foyer : ${members().map(m => m.name).join(", ")}. Moyennes calculées sur ${monthLabel(ks[0])} – ${monthLabel(ks[2])}.`},
    {h:"Synthèse mensuelle", kv:[["Revenus moyens", fmt(incAvg)], ["Charges fixes", fmt(fixedT)], ["Mensualités de crédit", fmt(creditT)], ["Dépenses courantes (moyenne)", fmt(varT)],
      ["Reste à vivre", fmt(incAvg - fixedT - creditT - varT)], ["Taux d'endettement", incAvg ? Math.round(creditT / incAvg * 1000) / 10 + " %" : "-"], ["Épargne disponible", fmt(savings)]]},
    {h:"Revenus (moyenne mensuelle)", table:{head:["Source", "Montant"], widths:[.7, .3], align:["l", "r"], rows:Object.entries(incByLabel).map(([l, v]) => [l, fmt(v)])}},
    {h:"Charges fixes", table:{head:["Charge", "Catégorie", "Montant"], widths:[.5, .25, .25], align:["l", "l", "r"], rows:fixed.map(r => [r.label || catOf(r.cat).name, catOf(r.cat).name, fmt(r.amount)])}},
  ];
  if (credits.length) blocks.push({h:"Crédits en cours", table:{head:["Crédit", "Mensualité", "Restant dû", "Taux"], widths:[.4, .2, .22, .18], align:["l", "r", "r", "r"], rows:credits.map(d => [d.name, fmt(d.monthly), fmt(d.remaining), (d.rate || 0) + " %"])}});
  blocks.push({h:"Dépenses courantes par catégorie (moyenne mensuelle)", table:{head:["Catégorie", "Montant"], widths:[.7, .3], align:["l", "r"], rows:Object.entries(varByCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, fmt(v)])}});
  return savePdf(`dossier-revenus-charges-${todayStr()}.pdf`, "Dossier revenus et charges", blocks);
}
function exportXlsx(){
  const ks = []; let k = curKey(); for (let i = 0; i < 12; i++) { ks.unshift(k); k = prevKey(k); }
  const sheets = [{name:"Résumé", rows:[["Mois", "Dépenses", "Revenus", "Solde"]].concat(ks.map(m => { const d = totalOf(inMonth(state.expenses, m).filter(bud)) / 100, r = incTotal(inMonth(state.incomes, m)) / 100; return [monthLabel(m), d, r, r - d]; }))},
    {name:"Par catégorie", rows:[["Catégorie"].concat(ks.map(monthLabel))].concat(allCats().map(c => [c.name].concat(ks.map(m => totalOf(inMonth(state.expenses, m).filter(e => bud(e) && catOf(e.cat).id === c.id)) / 100))))}];
  ks.slice(-6).forEach(m => sheets.push({name:m, rows:[["Date", "Libellé", "Catégorie", "Sous-catégorie", "Payé par", "Pour", "Étiquettes", "Montant"]].concat(inMonth(state.expenses, m).sort((a, b) => a.date.localeCompare(b.date)).map(e =>
    [e.date, e.label || "", catOf(e.cat).name, e.sub || "", memberName(e.payer), e.split && e.split !== "all" ? memberName(e.split) : "Foyer", (e.tags || []).join(" "), eff(e) / 100]))}));
  return saveFile(`dafeuille-${curKey()}.xlsx`, buildXlsx(sheets));
}
async function exportImage(){
  const k = state.month, l = inMonth(state.expenses, k).filter(bud), t = totalOf(l), b = state.settings.budget || 0, inc = incTotal(inMonth(state.incomes, k));
  const cs = getComputedStyle(document.documentElement), acc = cs.getPropertyValue("--accent").trim() || "#0F766E", acc2 = cs.getPropertyValue("--accent-2").trim() || "#115E59";
  const W = 1080, H = 1350, c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d");
  const F = (w, s) => `${w} ${s}px Geist, system-ui, sans-serif`, sp = s => s.replace(/ | /g, " ");
  x.fillStyle = "#F3F4F6"; x.fillRect(0, 0, W, H);
  const g = x.createLinearGradient(0, 0, W, 560); g.addColorStop(0, acc); g.addColorStop(1, acc2);
  x.fillStyle = g; x.beginPath(); x.roundRect(60, 60, W - 120, 520, 48); x.fill();
  x.fillStyle = "#fff"; x.font = F(600, 40); x.fillText((state.settings.houseName || "DAFeuille") + " · " + monthLabel(k), 120, 150);
  x.font = F(800, 150); x.fillText(sp(fmt(t)), 110, 330);
  x.font = F(500, 40); x.globalAlpha = .85; x.fillText(sp(b ? (t <= b ? `Reste ${fmt(b - t)} sur ${fmt0(b)}` : `Budget dépassé de ${fmt(t - b)}`) : `${l.length} dépenses`), 120, 410); x.globalAlpha = 1;
  if (inc) { x.font = F(600, 38); x.fillText(sp(`Revenus ${fmt0(inc)}  ·  Reste à vivre ${fmt0(inc - t - savedIn(k))}`), 120, 500); }
  const byC = Object.entries(sumBy(l, e => catOf(e.cat).id)).sort((p, q) => q[1] - p[1]).slice(0, 6), max = byC[0]?.[1] || 1;
  x.fillStyle = "#0B1220"; x.font = F(700, 44); x.fillText("Par catégorie", 80, 690);
  byC.forEach(([id, v], i) => { const y = 770 + i * 90, cc = catOf(id);
    x.fillStyle = "#0B1220"; x.font = F(500, 36); x.fillText(cc.name, 80, y);
    x.textAlign = "right"; x.font = F(700, 36); x.fillText(sp(fmt(v)), W - 80, y); x.textAlign = "left";
    x.fillStyle = "#E3E6EB"; x.beginPath(); x.roundRect(80, y + 18, W - 160, 16, 8); x.fill();
    x.fillStyle = cc.color; x.beginPath(); x.roundRect(80, y + 18, Math.max(16, (W - 160) * v / max), 16, 8); x.fill(); });
  x.fillStyle = "#5B6474"; x.font = F(500, 28); x.fillText("DAFeuille", 80, H - 60);
  return saveFile(`recap-${k}.png`, await new Promise(r => c.toBlob(r, "image/png")), "image/png");
}
function pdfNotes(){
  const l = state.expenses.concat(state.privates).filter(e => e.refund && e.refund.source === "Employeur").sort((a, b) => a.date.localeCompare(b.date));
  if (!l.length) throw new Error("vide");
  return savePdf(`notes-de-frais-${todayStr()}.pdf`, "Notes de frais", [
    {kv:[["À rembourser", fmt(l.filter(e => !e.refund.received).reduce((s, e) => s + e.refund.amount, 0))], ["Déjà remboursé", fmt(l.filter(e => e.refund.received).reduce((s, e) => s + e.refund.amount, 0))]]},
    {h:"Détail", table:{head:["Date", "Libellé", "Catégorie", "Statut", "Montant"], widths:[.14, .4, .18, .12, .16], align:["l", "l", "l", "l", "r"],
      rows:l.map(e => [fmtDay(e.date, {day:"2-digit", month:"2-digit", year:"2-digit"}), e.label || "", catOf(e.cat).name, e.refund.received ? "Payé" : "En attente", fmt(e.refund.amount)])}}]);
}

function ExportDialog({ onClose }){
  const [msg, setMsg] = useState("");
  const run = fn => async () => {
    setMsg("Préparation…");
    try { await fn(); setMsg(""); onClose(); }
    catch (e) { setMsg(e && e.message === "vide" ? "Aucune note de frais : cochez « Note de frais » sur une dépense." : "L'export a échoué. Vérifiez votre connexion et réessayez."); }
  };
  const items = [["file-spreadsheet", "Le mois en CSV (Excel)", csvMonth], ["file-text", "Le mois en PDF", pdfMonth], ["book-open", "L'année en PDF", pdfYear], ["folder-open", "Dossier revenus et charges", pdfDossier],
    ["file-spreadsheet", "Classeur Excel (12 mois)", exportXlsx], ["image", "Récap du mois en image", exportImage], ["briefcase", "Notes de frais (PDF)", pdfNotes]];
  return <Dialog title="Exporter" onClose={onClose} closeLabel="Fermer" form={false}>
    <div className="menu">{items.map(([ic, l, fn]) => <button key={l} type="button" className="btn ghost" onClick={run(fn)}><Icon name={ic} />{l}</button>)}</div>
    <p className="ai-msg mt12" aria-live="polite">{msg}</p>
  </Dialog>;
}
registerDialog("export", ExportDialog);
