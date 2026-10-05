/* Deux colonnes équilibrées sur grand écran (≥ 880 px) : chaque panneau, dans l'ordre, va dans la colonne
   la plus courte (comme balanceColumns() de l'ancienne interface). Sur mobile : ordre d'origine.
   Les panneaux sont enveloppés dans un élément display:contents pour pouvoir les mesurer sans changer la mise en page. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const wide = () => window.innerWidth >= 880;

export function Columns({ left, right, className = "grid" }){
  const items = left.concat(right).filter(Boolean), ref = useRef(null);
  const [isWide, setWide] = useState(wide), [assign, setAssign] = useState(null);
  useEffect(() => { const h = () => setWide(wide()); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);
  useLayoutEffect(() => {
    if (!isWide || !ref.current) return;
    if (ref.current.contains(document.activeElement) && document.activeElement !== document.body && assign) return;   // pas de saut pendant une saisie
    const hs = {};
    ref.current.querySelectorAll(":scope > .col > .cslot").forEach(s => { const c = s.firstElementChild; hs[s.dataset.k] = c && !c.hidden ? c.offsetHeight : 0; });
    let a = 0, b = 0; const next = {};
    items.forEach(it => { const h = hs[it.key] || 0; if (!h) { next[it.key] = assign?.[it.key] ?? 0; return; } if (a <= b) { next[it.key] = 0; a += h; } else { next[it.key] = 1; b += h; } });
    if (!assign || items.some(it => assign[it.key] !== next[it.key])) setAssign(next);
  });
  const slot = it => <div className="cslot" data-k={it.key} key={it.key}>{it}</div>;
  if (!isWide || !assign) return (
    <div className={className} ref={ref}>
      <div className="col">{left.filter(Boolean).map(slot)}</div>
      <div className="col">{right.filter(Boolean).map(slot)}</div>
    </div>
  );
  return (
    <div className={className} ref={ref}>
      <div className="col">{items.filter(it => (assign[it.key] ?? 0) === 0).map(slot)}</div>
      <div className="col">{items.filter(it => assign[it.key] === 1).map(slot)}</div>
    </div>
  );
}
