/* Fenêtres modales natives (<dialog>) : focus piégé et Échap gérés par le navigateur.
   openDialog(nom, props) empile une fenêtre enregistrée ; <DialogHost/> les affiche. */
import { useEffect, useId, useRef } from "react";
import { bump } from "../lib/core.js";
import { useStore } from "../lib/hooks.js";

export function Dialog({ onClose, title, wide, children, actions, onSubmit, closeLabel = "Annuler", className = "", form = true }){
  const ref = useRef(null), id = useId();
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  const Body = form ? "form" : "div";
  return (
    <dialog ref={ref} className={(wide ? "wide " : "") + className} aria-labelledby={id}
      onCancel={e => { e.preventDefault(); onClose(); }}
      onClick={e => { if (e.target === ref.current) onClose(); }}>
      <Body className="sheet" noValidate={form || undefined} onSubmit={form ? e => { e.preventDefault(); onSubmit && onSubmit(e); } : undefined}>
        <div className="sheet-head"><h2 id={id}>{title}</h2>{actions}<button type="button" className="linkbtn" onClick={onClose}>{closeLabel}</button></div>
        {children}
      </Body>
    </dialog>
  );
}

const REG = {}, stack = [];
let seq = 0;
export const registerDialog = (name, Comp) => { REG[name] = Comp; };
export function openDialog(name, props = {}){ const key = ++seq; stack.push({name, props, key}); bump(); return key; }
export function closeDialog(key){ const i = stack.findIndex(d => d.key === key); if (i >= 0) { stack.splice(i, 1); bump(); } }
export const anyDialogOpen = () => stack.length > 0;

export function DialogHost(){
  useStore();
  return stack.map(d => { const C = REG[d.name]; return C ? <C key={d.key} {...d.props} onClose={() => closeDialog(d.key)} /> : null; });
}
