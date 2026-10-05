/* Comptes entre amis : calculs et récapitulatif (anneau « qui a payé », catégories, soldes, qui doit quoi, dépenses).
   Partagé entre la fenêtre du groupe (membres du foyer) et la page publique (amis sans compte). */
import { Icon } from "../ui/icons.jsx";
import { fmt, fmtCur, fmtDay, GROUP_CATS, groupCatOf, MEMBER_COLORS } from "../lib/core.js";
import { settlements } from "../lib/domain.js";

export { GROUP_CATS, settlements };
export const idColor = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return MEMBER_COLORS[h % MEMBER_COLORS.length]; };

export function groupBalances(g){
  const bal = {}; (g.people || []).forEach(p => bal[p.id] = 0);
  (g.items || []).forEach(it => {
    if (it.payer in bal) bal[it.payer] += it.amount;
    if (it.splits) { Object.entries(it.splits).forEach(([id, amt]) => { if (id in bal) bal[id] -= amt; }); return; }
    const parts = (it.parts || []).filter(id => id in bal); if (!parts.length) return;
    parts.forEach(id => bal[id] -= it.amount / parts.length);
  });
  return bal;
}
export function groupPaidByPerson(g){
  const paid = {}; (g.people || []).forEach(p => paid[p.id] = 0);
  (g.items || []).forEach(it => { if (it.kind !== "settlement" && it.payer in paid) paid[it.payer] += it.amount; });
  return paid;
}
export function groupByCategory(g){
  const out = {};
  (g.items || []).forEach(it => { if (it.kind === "settlement") return; const c = it.cat || "autre"; out[c] = (out[c] || 0) + it.amount; });
  return out;
}
export const personName = (g, id) => (g.people.find(p => p.id === id) || {}).name || "?";

export function DonutSvg({ parts, total, centerLabel = "Total" }){
  if (!total) return <div className="empty"><Icon name="chart-pie" />Aucune dépense</div>;
  const R = 80, r = 50, cx = 85, cy = 85; let a0 = -Math.PI / 2;
  const p = (ang, rad) => `${(cx + rad * Math.cos(ang)).toFixed(2)} ${(cy + rad * Math.sin(ang)).toFixed(2)}`;
  return <svg viewBox="0 0 170 170" role="img" aria-label="Répartition">
    {parts.map(([id, v, color, name]) => {
      const a1 = a0 + v / total * Math.PI * 2 - (parts.length > 1 ? 0.01 : 0), large = a1 - a0 > Math.PI ? 1 : 0;
      const d = parts.length === 1 ? `M ${cx} ${cy - R} A ${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R} L ${cx - 0.01} ${cy - r} A ${r} ${r} 0 1 0 ${cx} ${cy - r} Z`
        : `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z`;
      a0 += v / total * Math.PI * 2;
      return <path key={id} d={d} fill={color}><title>{name} : {fmt(v)}</title></path>;
    })}
    <text x="85" y="82" textAnchor="middle" fontSize="11" fill="currentColor" opacity=".6">{centerLabel}</text>
    <text x="85" y="99" textAnchor="middle" fontSize="14" fontWeight="700" fill="currentColor">{fmt(total)}</text>
  </svg>;
}

/** ctx : {canDeleteAny, editableItemIds:Set, editablePersonIds:Set, canConvert, onEdit(it), onDelete(it), onSettle(t), onRename(p), onConvert(p)} */
export function useGroupSummary(g, ctx){
  const pn = id => personName(g, id);
  const bal = groupBalances(g), tr = settlements(bal), paidBy = groupPaidByPerson(g), byCat = groupByCategory(g);
  const totalPaid = Object.values(paidBy).reduce((a, b) => a + b, 0);
  const items = (g.items || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));
  const peopleParts = Object.entries(paidBy).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([id, v]) => [id, v, idColor(id), pn(id)]);
  const catParts = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  const charts = totalPaid ? <div className="grid even mb16">
    <div><h3>Qui a payé</h3><div className="donut"><DonutSvg parts={peopleParts} total={totalPaid} centerLabel="Payé" />
      <ul className="legend">{peopleParts.map(([id, v]) => <li key={id}><span className="dot" style={{background:idColor(id)}} /><span className="nm">{pn(id)}</span><span>{Math.round(v / totalPaid * 100)} %</span></li>)}</ul></div></div>
    <div><h3>Par catégorie</h3><ul className="legend mt8">{catParts.map(([id, v]) => { const c = groupCatOf(id);
      return <li key={id}><span className="dot" style={{background:c.color}} /><span className="nm"><Icon name={c.ico} /> {c.name}</span><span>{fmt(v)}</span></li>; })}</ul></div>
  </div> : null;

  const balCards = <div className="people">{g.people.map(p => {
    const v = bal[p.id] || 0, pay = g.payInfo && g.payInfo[p.id], canRename = ctx.editablePersonIds && ctx.editablePersonIds.has(p.id);
    return <div className="person" key={p.id}><span className="av" style={{background:idColor(p.id)}} aria-hidden="true">{(p.name[0] || "?").toUpperCase()}</span>
      <span className="f1 minw0"><b>{p.name}</b>{canRename && <> <button type="button" className="linkbtn" onClick={() => ctx.onRename(p)}>renommer</button></>}{pay && <><br /><span className="muted small">{pay}</span></>}</span>
      <span className={"r " + (v < -0.5 ? "over" : v > 0.5 ? "down" : "muted")}>{v >= 0 ? "+" : "−"}{fmt(Math.abs(v))}</span>
      {ctx.canConvert && v < -0.5 && <button type="button" className="x" title="Enregistrer comme dépense perso" onClick={() => ctx.onConvert(p)}><Icon name="wallet" /></button>}</div>;
  })}</div>;

  const settleHtml = tr.length ? <div className="settle">{tr.map(t => <div className="s" key={t.from + t.to}><p>{pn(t.from)} doit <b>{fmt(t.amount)}</b> à {pn(t.to)}</p>
    {ctx.onSettle && <button type="button" className="btn sm ghost" onClick={() => ctx.onSettle(t)}>Réglé</button>}</div>)}</div>
    : <p className="muted small">Tout le monde est à l'équilibre.</p>;

  const itemsHtml = items.length ? <ul className="items">{items.map(it => {
    const isSettle = it.kind === "settlement", mine = !isSettle && ctx.editableItemIds && ctx.editableItemIds.has(it.id);
    const withinWindow = mine && (Date.now() - (it.createdAt || 0) < 30 * 60e3), c = isSettle ? null : groupCatOf(it.cat);
    const who = it.splits ? "répartition personnalisée" : ((it.parts || []).length === g.people.length ? "tous" : (it.parts || []).map(pn).join(", "));
    return <li key={it.id}><span className="ic" style={c ? {background:c.color + "1F", color:c.color} : undefined}><Icon name={isSettle ? "handshake" : c.ico} /></span>
      {it.photo && <img src={it.photo} className="thumb" alt="" />}
      <span className="tx">{it.label || "Dépense"}{isSettle && <> <span className="tag">remboursement</span></>}<span>{fmtDay(it.date)} · payé par {pn(it.payer)} · pour {who}{it.currency ? ` · ${fmtCur(it.origAmount, it.currency)}` : ""}</span></span>
      <b>{fmt(it.amount)}</b>
      {!isSettle && (ctx.canDeleteAny || withinWindow) && ctx.onEdit && <button type="button" className="x" aria-label="Modifier" onClick={() => ctx.onEdit(it)}><Icon name="pencil" /></button>}
      {(ctx.canDeleteAny || withinWindow) && ctx.onDelete && <button type="button" className="x" aria-label="Supprimer" onClick={() => ctx.onDelete(it)}><Icon name="x" /></button>}</li>;
  })}</ul> : <p className="muted small">Aucune dépense pour l'instant.</p>;

  return {charts, balCards, settleHtml, itemsHtml, count:items.length};
}
