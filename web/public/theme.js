// Appliqué avant le premier rendu pour éviter un éclair de thème clair (fichier externe : CSP stricte).
try {
  const t = localStorage.getItem("pc.theme"); if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  const a = localStorage.getItem("pc.accent"); if (a && a !== "vert") document.documentElement.setAttribute("data-accent", a);
  if (localStorage.getItem("pc.contrast") === "1") document.documentElement.setAttribute("data-contrast", "high");
  document.documentElement.style.fontSize = (localStorage.getItem("pc.fsize") || "100") + "%";
} catch {}
