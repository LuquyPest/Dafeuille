/* Import d'un relevé bancaire (CSV, OFX/QFX, QIF) : détection des doublons et des virements internes,
   choix du compte, du payeur et des catégories, puis création des dépenses et revenus. */
import { useState } from "react";
import { Dialog, registerDialog } from "../ui/Dialog.jsx";
import { state, fmt, fmtDay, daysBetween, norm, allCats, members, me, currentWeights } from "../lib/core.js";
import { store, toast, handleWriteError } from "../data/store.js";
import { guessCat } from "../lib/domain.js";
import { parseOFX, parseQIF, parseBank } from "../lib/bank.js";
import { needsAccountFirst } from "./Money.jsx";

function ImportDialog({ onClose }){
  const [rows, setRows] = useState(null), [err, setErr] = useState(""), [info, setInfo] = useState(""), [busy, setBusy] = useState(false);
  const [account, setAccount] = useState(state.accounts[0]?.id || ""), [payer, setPayer] = useState(me() || members()[0]?.id || "");
  const onFile = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    setErr(""); setInfo("");
    try {
      const buf = await f.arrayBuffer();
      let text; try { text = new TextDecoder("utf-8", {fatal:true}).decode(buf); } catch { text = new TextDecoder("windows-1252").decode(buf); }
      const kind = /<OFX>|OFXHEADER|<STMTTRN>/i.test(text) ? "ofx" : /^\s*!Type:/im.test(text) || /^\^\s*$/m.test(text) && /^D/m.test(text) ? "qif" : "csv";
      const parsed = kind === "ofx" ? parseOFX(text) : kind === "qif" ? parseQIF(text) : parseBank(text);
      if (!parsed.length) throw new Error("Aucune opération trouvée dans ce fichier.");
      if (needsAccountFirst()) { onClose(); return; }
      // Doublons : (1) identifiant d'import déjà connu = sûr ; (2) même montant à ±2 jours = probable.
      const known = new Set(state.expenses.concat(state.incomes).map(x => x.importId).filter(Boolean));
      const near = (r, l) => l.some(x => x.amount === Math.abs(r.amount) && Math.abs(daysBetween(x.date, r.date)) <= 2);
      const names = members().map(m => m.name.toLowerCase()).filter(n => n.length > 2);
      const isTransfer = l => { const x = l.toLowerCase(); return /\bvir(ement)?\b|\bvrt\b|\bvir sepa\b/.test(x) && (names.some(n => x.includes(n)) || /livret|epargne|épargne|compte joint|interne|pel\b|ldd/.test(x)); };
      const seen = {};
      setRows(parsed.map(r => {
        const base = "imp:" + (r.fitid ? "f:" + r.fitid : `h:${r.date}|${r.amount}|${norm(r.label).replace(/\s+/g, " ").trim()}`);
        const importId = base + (seen[base] ? "#" + seen[base] : ""); seen[base] = (seen[base] || 0) + 1;   // deux cafés identiques le même jour restent deux lignes
        const inc = r.amount > 0, sure = known.has(importId), dup = !sure && near(r, inc ? state.incomes : state.expenses), tr = isTransfer(r.label);
        return {...r, amount:Math.abs(r.amount), inc, importId, cat:inc ? null : r.cat || guessCat(r.label), sure, dup, tr, sel:!sure && !dup && !tr};
      }));
      setAccount(state.accounts[0]?.id || "");
    } catch (x) { setErr(x.message || "Fichier illisible."); setRows(null); }
  };
  const upd = (i, p) => setRows(rs => rs.map((r, j) => j === i ? {...r, ...p} : r));
  const sel = (rows || []).filter(r => r.sel), ne = sel.filter(r => !r.inc).length, ni = sel.length - ne;
  const nt = (rows || []).filter(r => r.tr).length, nd = (rows || []).filter(r => r.sure || r.dup).length, s = n => n > 1 ? "s" : "";
  const go = async () => {
    if (!sel.length) return;
    const shares = currentWeights(); setBusy(true); let n = 0;
    try {
      for (const r of sel) {
        if (r.inc) await store.upsert("incomes", {amount:r.amount, label:r.label, who:payer || "", accountId:account || null, date:r.date, by:me() || null, imported:true, importId:r.importId, createdAt:Date.now()});
        else await store.upsert("expenses", {amount:r.amount, label:r.label, cat:r.cat, payer:r.payer || payer, split:"all", shares, accountId:account || null, date:r.date, by:me() || null, imported:true, importId:r.importId, createdAt:Date.now()});
        n++; if (n % 10 === 0) setInfo(`${n} / ${sel.length} importées…`);
      }
      onClose(); toast(`${n} opération${s(n)} importée${s(n)}`);
    } catch (e) { handleWriteError(e); setInfo(`${n} importées avant l'erreur.`); }
    finally { setBusy(false); }
  };
  return <Dialog title="Importer un relevé bancaire" wide onClose={onClose} closeLabel="Fermer" form={false}>
    <p className="muted small mt0">Téléchargez le relevé depuis votre banque (CSV, OFX/QFX ou QIF), puis choisissez le fichier. Les débits deviennent des dépenses, les crédits des revenus. Ce qui est déjà importé ou déjà saisi est repéré et décoché.</p>
    <div className="field"><input type="file" accept=".csv,.ofx,.qfx,.qif,text/csv,text/plain,application/x-ofx" className="inp" aria-label="Fichier du relevé" onChange={onFile} /></div>
    <p className="err" role="alert">{err}</p>
    {rows && <div>
      <div className="erow"><span className="cn">Compte</span><select aria-label="Compte du relevé" value={account} onChange={e => setAccount(e.target.value)}>{state.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
      <div className="erow"><span className="cn">Payé par</span><select aria-label="Payé par" value={payer} onChange={e => setPayer(e.target.value)}>{members().map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
      <p className="muted small impnote">Seules les opérations postérieures au dernier pointage du compte modifient son solde (les plus anciennes y sont déjà comptées).</p>
      <div className="actions m0 mb10"><span className="muted small">{info || `${rows.length} opérations trouvées` + (nd ? ` · ${nd} déjà présente${s(nd)} décochée${s(nd)}` : "") + (nt ? ` · ${nt} virement${s(nt)} interne${s(nt)} décoché${s(nt)}` : "")}</span></div>
      <div className="scroll" tabIndex={0} role="region" aria-label="Opérations du relevé"><table className="t"><thead><tr><th>Libellé</th><th>Date</th><th>Montant</th><th>Catégorie</th><th>Importer</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={r.importId}><td>{r.label}{r.sure ? <> <span className="up small">déjà importé</span></> : r.dup ? <> <span className="up small">doublon probable</span></> : null}{r.tr && <> <span className="up small">virement interne ?</span></>}</td>
          <td>{fmtDay(r.date)}</td><td className={(r.inc ? "down " : "") + "nowrap"}>{r.inc ? "+" : "−"}{fmt(r.amount)}</td>
          <td>{r.inc ? <span className="muted small">Revenu</span> : <select className="inp p6" aria-label={`Catégorie de ${r.label}`} value={r.cat} onChange={e => upd(i, {cat:e.target.value})}>{allCats().map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</td>
          <td className="tcenter"><input type="checkbox" className="cbx" checked={r.sel} aria-label={`Importer ${r.label}`} onChange={e => upd(i, {sel:e.target.checked})} /></td></tr>)}</tbody></table></div>
      <div className="actions"><button type="button" className="btn push" disabled={!sel.length || busy} onClick={go}>{sel.length ? `Importer ${[ne ? `${ne} dépense${s(ne)}` : "", ni ? `${ni} revenu${s(ni)}` : ""].filter(Boolean).join(" et ")}` : "Importer"}</button></div>
    </div>}
  </Dialog>;
}
registerDialog("import", ImportDialog);
