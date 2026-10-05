/* Deux colonnes équilibrées sur grand écran (≥ 880 px), comme balanceColumns() de l'ancienne interface :
   chaque panneau, dans l'ordre d'origine, va dans la colonne la plus courte ; un panneau qui reste dans sa colonne
   garde sa place, un panneau déplacé arrive en bas de sa nouvelle colonne. Sur mobile : disposition d'origine.
   Chaque panneau est enveloppé dans un élément display:contents pour être mesuré sans changer la mise en page. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const wide = () => window.innerWidth >= 880;

export function Columns({ left, right, className = "grid" }){
  const L = left.filter(Boolean), R = right.filter(Boolean), byKey = {}, ref = useRef(null);
  L.concat(R).forEach(it => byKey[it.key] = it);
  const order = L.concat(R).map(it => it.key);               // ordre d'origine (rang de chaque panneau)
  const [isWide, setWide] = useState(wide), [arr, setArr] = useState(null), own = useRef(false);
  useEffect(() => { const h = () => setWide(wide()); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);

  // Disposition courante : la précédente, complétée par les panneaux apparus depuis (à leur place d'origine)
  const base = arr || [L.map(it => it.key), R.map(it => it.key)];
  const cur = base.map(col => col.filter(k => byKey[k]));
  L.forEach(it => { if (!cur[0].includes(it.key) && !cur[1].includes(it.key)) cur[0].push(it.key); });
  R.forEach(it => { if (!cur[0].includes(it.key) && !cur[1].includes(it.key)) cur[1].push(it.key); });

  useLayoutEffect(() => {
    if (own.current) { own.current = false; return; }        // rendu provoqué par notre propre rééquilibrage : pas de nouvelle passe
    if (!isWide || !ref.current) return;
    if (ref.current.contains(document.activeElement)) return;   // pas de saut sous le doigt ou pendant une saisie
    const hs = {};
    ref.current.querySelectorAll(":scope > .col > .cslot").forEach(s => { const c = s.firstElementChild; hs[s.dataset.k] = c && !c.hidden ? c.offsetHeight : 0; });
    const next = cur.map(col => col.slice()), where = k => next[0].includes(k) ? 0 : 1;
    let a = 0, b = 0;
    order.filter(k => hs[k]).forEach(k => {
      const t = a <= b ? 0 : 1;
      if (where(k) !== t) { next[1 - t] = next[1 - t].filter(x => x !== k); next[t].push(k); }
      if (t === 0) a += hs[k]; else b += hs[k];
    });
    if (next.some((col, i) => col.join("|") !== cur[i].join("|"))) { own.current = true; setArr(next); }
  });

  const cols = isWide ? cur : [L.map(it => it.key), R.map(it => it.key)];
  return (
    <div className={className} ref={ref}>
      {cols.map((col, i) => <div className="col" key={i}>{col.map(k => <div className="cslot" data-k={k} key={k}>{byKey[k]}</div>)}</div>)}
    </div>
  );
}
