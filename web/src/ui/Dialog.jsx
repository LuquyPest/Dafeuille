/* Fenêtre modale native (<dialog>) : focus piégé et Échap gérés par le navigateur. */
import { useEffect, useId, useRef } from "react";

export function Dialog({ open, onClose, title, wide, children, actions, onSubmit, className = "" }){
  const ref = useRef(null), id = useId();
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal(); else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={(wide ? "wide " : "") + className} aria-labelledby={id} onClose={() => open && onClose && onClose()}
      onClick={e => { if (e.target === ref.current) onClose && onClose(); }}>
      {open && (
        <form className="sheet" noValidate onSubmit={e => { e.preventDefault(); onSubmit && onSubmit(e); }}>
          <div className="sheet-head"><h2 id={id}>{title}</h2>{actions}<button type="button" className="linkbtn" onClick={onClose}>Fermer</button></div>
          {children}
        </form>
      )}
    </dialog>
  );
}
