/* Profil (bannière, avatar, niveau, série, XP par semaine, bio, badges) et classement (mondial / foyer). */
import { useEffect, useId, useRef, useState } from "react";
import { openDialog, registerDialog, useModal } from "../ui/Dialog.jsx";
import { Icon } from "../ui/icons.jsx";
import { Check } from "../ui/bits.jsx";
import { fmtDay, safeImg, bump } from "../lib/core.js";
import { levelInfo, useStore } from "../lib/hooks.js";
import { SV, api, toast } from "../data/store.js";
import { drawScaled } from "../lib/image.js";
import { Avatar } from "../Shell.jsx";
import { BadgeGrid } from "../views/Projets.jsx";

export async function loadProgress(){ try { SV.progress = await api("GET", "/api/me/progress"); bump(); } catch {} return SV.progress; }
setInterval(() => { if (SV.hh && !document.hidden) loadProgress(); }, 15 * 60e3);

/** Fenêtre « plein cadre » sans en-tête standard (profil) */
function BareDialog({ onClose, label, className = "", children }){
  const [ref, open] = useModal();
  return <dialog ref={ref} className={className} aria-labelledby={label} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) onClose(); }}>{open && children}</dialog>;
}

function Progress(){
  const pr = SV.progress; if (!pr) return null;
  const s = pr.streak, pl = n => n > 1 ? "s" : "";
  const weeks = []; for (let i = 0; i < pr.days.length; i += 7) weeks.push(pr.days.slice(i, i + 7));
  const tot = weeks.map(w => w.reduce((a, d) => a + d.xp, 0)), max = Math.max(1, ...tot), W = 240, H = 64, bw = W / weeks.length, sum = tot.reduce((a, b) => a + b, 0);
  return <div className="pf-prog">
    <div className="pf-streak"><span className={"pf-flame" + (s ? "" : " off")} aria-hidden="true"><Icon name="flame" /></span>
      <div><b>{s ? `${s} jour${pl(s)} d'affilée` : "Pas de série en cours"}</b><span className="muted small">{(s && !pr.activeToday ? "Une action aujourd'hui pour la prolonger · " : "") + `record : ${pr.best} jour${pl(pr.best)}`}</span></div></div>
    <div className="pf-chart"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`XP gagnée par semaine sur 12 semaines : ${sum} XP au total, meilleure semaine ${Math.max(...tot)} XP`}>
      {tot.map((v, i) => { const h = v ? Math.max(3, v / max * (H - 4)) : 2;
        return <rect key={i} x={(i * bw + 2).toFixed(1)} y={(H - h).toFixed(1)} width={(bw - 4).toFixed(1)} height={h.toFixed(1)} rx="3" fill={v ? "var(--accent)" : "var(--line)"}><title>Semaine du {fmtDay(weeks[i][0].d)} : {v} XP</title></rect>; })}</svg>
      <div className="lbl"><span>{fmtDay(weeks[0][0].d)}</span><span>XP par semaine</span><span>cette semaine</span></div></div>
  </div>;
}

async function uploadProfileImage(file, kind){
  const cfg = kind === "avatar" ? {max:480, q:.82, bytes:170000} : {max:1400, q:.78, bytes:250000};
  const c = await drawScaled(file, cfg.max); let q = cfg.q, url = c.toDataURL("image/jpeg", q);
  while (url.length > cfg.bytes && q > 0.35) { q -= 0.12; url = c.toDataURL("image/jpeg", q); }
  const r = await api("POST", `/api/me/${kind}`, {image:url});
  if (kind === "avatar") SV.me.avatar = r.url; else SV.me.banner = r.url;
  bump();
}

function ProfileDialog({ user, editable, onClose }){
  useStore();
  const u = editable && user.id === SV.me.id ? SV.me : user, canEdit = !!editable && u.id === SV.me.id, li = levelInfo(u.xp), id = useId();
  const [bio, setBio] = useState(u.bio || ""), [hide, setHide] = useState(!!u.hideFromLeaderboard);
  useEffect(() => { if (canEdit) loadProgress(); }, []);
  const pick = kind => async e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) try { await uploadProfileImage(f, kind); } catch { toast("Image invalide"); } };
  const save = async e => {
    e.preventDefault(); if (!canEdit) return;
    try { await api("PATCH", "/api/me", {name:SV.me.name, bio, hideFromLeaderboard:hide}); SV.me.bio = bio; SV.me.hideFromLeaderboard = hide; toast("Profil mis à jour"); } catch (err) { toast(err.message); }
  };
  const banner = safeImg(u.banner);
  return <BareDialog onClose={onClose} label={id}>
    <div className="sheet pf-sheet">
      <div className="pf-banner" style={banner ? {backgroundImage:`url("${banner}")`} : undefined}>
        {canEdit && <label className="iconbtn pf-edit" id="pfBannerBtn" title="Changer la bannière" aria-label="Changer la bannière"><Icon name="camera" /><input type="file" accept="image/*" hidden onChange={pick("banner")} /></label>}
        <button type="button" className="iconbtn pf-close" title="Fermer" aria-label="Fermer" onClick={onClose}><Icon name="x" /></button>
        <div className="pf-av-wrap">
          <span className="av pf-av" aria-hidden="true"><Avatar user={u} /></span>
          {canEdit && <label className="iconbtn pf-edit pf-av-edit" title="Changer la photo" aria-label="Changer la photo"><Icon name="camera" /><input type="file" accept="image/*" hidden onChange={pick("avatar")} /></label>}
        </div>
      </div>
      <div className="pf-body">
        <h2 id={id} className="mb2"><span>{u.name || u.email}</span></h2>
        <p className="muted small pf-mail">{u.email || ""}</p>
        <div className="pf-level">
          <div className="pf-lvlrow"><b>Niveau {li.level} · {li.title}</b><span className="muted small">{li.xp} XP · {li.ceil - li.xp} XP avant le niveau {li.level + 1}</span></div>
          <div className="bar"><span style={{background:"var(--accent)", width:li.pct + "%"}} /></div>
          <button type="button" className="btn sm ghost mt10" onClick={() => { onClose(); openDialog("leader"); }}><Icon name="trophy" />Classement</button>
        </div>
        {canEdit && <Progress />}
        {canEdit && <div className="field mt14"><Check checked={hide} onChange={setHide}>Masquer mon profil du classement mondial</Check>
          <p className="hint mt4">Tu restes visible dans le classement de tes foyers.</p></div>}
        <form onSubmit={save}>
          <div className="field mt18"><label htmlFor={id + "bio"}>Bio</label>
            <textarea className="inp" id={id + "bio"} rows={3} maxLength={280} placeholder="Dites-en un peu plus sur vous…" disabled={!canEdit} value={bio} onChange={e => setBio(e.target.value)} />
            <p className="muted small bioc">{bio.length} / 280</p></div>
          {canEdit && <div className="actions"><button type="submit" className="btn push">Enregistrer</button></div>}
        </form>
        <h3>Badges</h3>
        <BadgeGrid unlocked={(u.badges || []).map(b => b.id)} />
      </div>
    </div>
  </BareDialog>;
}

function CountUp({ to }){
  const [v, setV] = useState(0);
  useEffect(() => { let raf; const t = setTimeout(() => { const start = performance.now();
    const tick = now => { const p = Math.min(1, (now - start) / 700); setV(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); }, 550); return () => { clearTimeout(t); cancelAnimationFrame(raf); }; }, [to]);
  return <span className="pxp" aria-hidden="true">{v} XP</span>;
}

function LeaderDialog({ onClose }){
  const [mode, setMode] = useState("global"), [res, setRes] = useState(null), [err, setErr] = useState(""), [ref] = useModal();
  useEffect(() => { setRes(null); setErr(""); (async () => {
    try {
      if (mode === "global") setRes(await api("GET", "/api/leaderboard"));
      else { const r = await api("GET", `/api/h/${encodeURIComponent(SV.hh.id)}/members`); setRes({top:r.members.slice().sort((a, b) => (b.xp || 0) - (a.xp || 0))}); }
    } catch (e) { setErr(e.message); }
  })(); }, [mode]);
  const open = u => { onClose(); openDialog("profile", {user:u, editable:u.id === SV.me.id}); };
  const row = (rank, mine, u) => { const li = levelInfo(u.xp || 0);
    return <li key={u.id + rank} style={{animationDelay:Math.min(rank, 12) * 0.02 + "s"}}><button type="button" className={"row-btn" + (mine ? " me" : "")} onClick={() => open(u)}>
      <span className="ic rank">{rank}</span><span className="av av32"><Avatar user={u} /></span>
      <span className="tx">{u.name || "?"}{mine ? " (toi)" : ""}<span>Niveau {li.level} · {li.title}</span></span><b>{u.xp || 0} XP</b></button></li>; };
  let body = null, podium = null;
  if (err) body = <p className="err">{err}</p>;
  else if (!res) body = Array.from({length:6}, (_, i) => <div className="skel" key={i} />);
  else {
    const top = res.top, top3 = top.slice(0, 3);
    if (top3.length) podium = <div className="podium">{[top3[1], top3[0], top3[2]].filter(Boolean).map(u => { const rank = top3.indexOf(u) + 1, me = u.id === SV.me.id, label = ["1er", "2e", "3e"][rank - 1];
      return <button key={u.id} type="button" className={"pplace p" + rank} aria-label={`${label} : ${u.name || "?"}${me ? " (toi)" : ""}, ${u.xp || 0} XP`} onClick={() => open(u)}>
        {rank === 1 && <span className="crown" aria-hidden="true">👑</span>}<span className="av pav" aria-hidden="true"><Avatar user={u} /></span>
        <span className="pname" aria-hidden="true">{u.name || "?"}{me ? " (toi)" : ""}</span><CountUp to={u.xp || 0} />
        <div className="pedestal" aria-hidden="true">{["🥇", "🥈", "🥉"][rank - 1]}</div></button>; })}</div>;
    const rows = top.slice(3).map((u, i) => row(i + 4, u.id === SV.me.id, u));
    body = <>{rows.length ? <ul className="items">{rows}</ul> : (top.length ? null : <div className="empty"><Icon name="trophy" />Personne pour l'instant</div>)}
      {mode === "global" && (res.hidden ? <p className="muted small mt10">Ton profil est masqué du classement mondial.</p>
        : res.me && res.me.rank > top.length ? <><div className="day">Toi</div><ul className="items">{row(res.me.rank, true, SV.me)}</ul></> : null)}</>;
  }
  return <dialog ref={ref} id="leaderDlg" className="wide" aria-labelledby="leaderTitle" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) onClose(); }}>
    <div className="sheet">
      <div className="sheet-head"><h2 id="leaderTitle">🏆 Classement</h2><button type="button" className="linkbtn" onClick={onClose}>Fermer</button></div>
      <div className="chips mb18" role="radiogroup" aria-label="Classement">
        <button type="button" className="chip" aria-pressed={mode === "global"} onClick={() => setMode("global")}>🌍 Mondial</button>
        <button type="button" className="chip" aria-pressed={mode === "house"} onClick={() => setMode("house")}>🏠 Mon foyer</button></div>
      {podium}<div id="leaderBody">{body}</div>
    </div></dialog>;
}

registerDialog("profile", ProfileDialog);
registerDialog("leader", LeaderDialog);
export const openProfile = () => openDialog("profile", {user:SV.me, editable:true});
