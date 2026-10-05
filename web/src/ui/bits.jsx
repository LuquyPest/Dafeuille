/* Petits composants d'affichage partagés (équivalents des helpers HTML de l'ancienne interface). */
import { Fragment, useId } from "react";
import { Icon } from "./icons.jsx";
import { members, memberName, memberColor, safeColor } from "../lib/core.js";

/** Pastille d'un membre du foyer (photo ou initiale colorée) */
export function MAvatar({ id }){
  if (!id) return null;
  const m = members().find(x => x.id === id);
  if (m && m.photo) return <img className="av" src={m.photo} alt="" aria-hidden="true" />;
  return <span className="av" style={{background:memberColor(id)}} aria-hidden="true">{(memberName(id)[0] || "?").toUpperCase()}</span>;
}
/** Icône de catégorie sur fond teinté */
export const CatIc = ({ c }) => <span className="ic" style={{background:c.color + "1F", color:c.color}}><Icon name={c.ico || "tag"} /></span>;
export const CatIco = ({ c }) => <span className="catico" style={{color:safeColor(c.color, "#94A3B8")}}><Icon name={c.ico || "tag"} /></span>;

/** État vide avec appel à l'action optionnel */
export const Empty = ({ icon, children, action, label }) => (
  <div className="empty"><Icon name={icon} />{children}{action ? <button type="button" className="btn sm" onClick={action}>{label}</button> : null}</div>
);

/** Groupe de pastilles radio (input + label, comme l'ancienne interface) */
export function Chips({ items, value, onChange, label, className = "chips", name }){
  const uid = useId(), n = name || uid;
  return (
    <div className={className} role="radiogroup" aria-label={label}>
      {items.map((it, i) => <Fragment key={it.id}>
        <input type="radio" name={n} id={n + "_" + i} value={it.id} checked={it.id === value} onChange={() => onChange(it.id)} />
        <label htmlFor={n + "_" + i}>{it.label}</label>
      </Fragment>)}
    </div>
  );
}
/** Case à cocher dans un libellé */
export const Check = ({ checked, onChange, children, id, className = "check" }) => (
  <label className={className}><input type="checkbox" id={id} checked={!!checked} onChange={e => onChange(e.target.checked)} /> {children}</label>
);
/** Champ avec libellé */
export const Field = ({ label, htmlFor, children, hidden, className = "field" }) => hidden ? null : (
  <div className={className}>{label != null && (htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="lab">{label}</span>)}{children}</div>
);
/** Barre de progression utilisée dans les légendes de budget */
export const Track = ({ ratio, color }) => <span className="track"><i style={{width:Math.min(100, ratio * 100).toFixed(1) + "%", background:ratio > 1 ? "var(--warn)" : color}} /></span>;

/** Variation en % par rapport au mois précédent */
export function PctDelta({ cur, prev }){
  if (!prev) return cur ? <small>nouveau</small> : null;
  const p = Math.round((cur - prev) / prev * 100);
  if (p === 0) return <small>=</small>;
  return <small className={p > 0 ? "up" : "down"}>{p > 0 ? "+" : "−"}{Math.abs(p)} %</small>;
}
