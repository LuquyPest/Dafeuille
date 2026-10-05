(function () {
  "use strict";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasHover = window.matchMedia("(hover: hover)").matches;
  var reveals = document.querySelectorAll(".reveal");

  // Filet de sécurité : si GSAP n'a pas pu charger (CDN bloqué, hors ligne), ou si l'utilisateur
  // préfère moins de mouvement, on affiche tout immédiatement plutôt que de bloquer le contenu.
  function showAllStatic() {
    reveals.forEach(function (el) { el.style.opacity = 1; el.style.transform = "none"; });
    document.querySelectorAll(".split-lines .line").forEach(function (el) { el.style.opacity = 1; el.style.transform = "none"; });
    document.querySelectorAll(".hero-fade").forEach(function (el) { el.style.opacity = 1; el.style.transform = "none"; });
    var tw = document.querySelector(".typewriter");
    if (tw) tw.textContent = tw.dataset.text;
  }

  if (reduced || typeof window.gsap === "undefined" || typeof window.ScrollTrigger === "undefined") {
    showAllStatic();
    return;
  }

  var gsap = window.gsap;
  gsap.registerPlugin(window.ScrollTrigger);

  /* ---------- Barre de progression de défilement ---------- */
  var bar = document.getElementById("scrollBar");
  if (bar) {
    gsap.set(bar, { scaleX: 0, transformOrigin: "left center" });
    gsap.to(bar, {
      scaleX: 1, ease: "none",
      scrollTrigger: { start: "top top", end: "max", scrub: 0.2 },
    });
  }

  /* ---------- Nav compacte au défilement ---------- */
  var nav = document.querySelector(".nav");
  ScrollTrigger.create({
    start: "top -40",
    onToggle: function (self) { nav.classList.toggle("scrolled", self.isActive); },
  });

  /* ---------- Lueur du hero : suit le curseur ---------- */
  var hero = document.querySelector(".hero");
  if (hero && hasHover) {
    hero.addEventListener("mousemove", function (e) {
      var r = hero.getBoundingClientRect();
      hero.style.setProperty("--gx", ((e.clientX - r.left) / r.width * 100) + "%");
      hero.style.setProperty("--gy", ((e.clientY - r.top) / r.height * 100) + "%");
    });
  }

  /* ---------- Entrée du hero : titre en cascade, puis sous-texte, CTA, visuel ---------- */
  gsap.set(".split-lines .line", { y: 40, opacity: 0 }); // reprend la main sur l'état posé en CSS (voir styles.css, règle .js)
  var tl = gsap.timeline({ defaults: { ease: "power4.out" } });
  tl.to(".split-lines .line", { y: 0, opacity: 1, duration: 0.9, stagger: 0.12 })
    .to(".hero-fade", { opacity: 1, y: 0, duration: 0.7, stagger: 0.12 }, "-=0.55")
    .fromTo(".hero-visual .tilt-card", { opacity: 0, x: 60, rotateY: -8 }, { opacity: 1, x: 0, rotateY: 0, duration: 1, ease: "power3.out" }, "-=0.8");

  /* ---------- Révélation au défilement (remplace l'observer simple du CSS) ---------- */
  ScrollTrigger.batch(".reveal", {
    start: "top 87%",
    onEnter: function (batch) {
      gsap.to(batch, { opacity: 1, y: 0, duration: 0.9, ease: "back.out(1.5)", stagger: 0.1, overwrite: true });
    },
  });

  /* ---------- Liste à puces : pop en cascade ---------- */
  gsap.utils.toArray(".checklist").forEach(function (list) {
    ScrollTrigger.create({
      trigger: list, start: "top 85%",
      onEnter: function () { gsap.from(list.children, { opacity: 0, scale: 0.85, x: -12, duration: 0.5, stagger: 0.12, ease: "back.out(2)" }); },
      once: true,
    });
  });

  /* ---------- Téléphone : bascule en place au défilement ---------- */
  gsap.utils.toArray(".split-visual .tilt-card").forEach(function (el) {
    gsap.fromTo(el, { opacity: 0, rotateY: -18, x: -50 }, {
      opacity: 1, rotateY: 0, x: 0, duration: 1, ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 80%" },
    });
  });

  /* ---------- Cartes à bascule 3D au survol (souris uniquement) ---------- */
  if (hasHover) {
    document.querySelectorAll(".tilt-card").forEach(function (card) {
      var bounds;
      card.addEventListener("mouseenter", function () { bounds = card.getBoundingClientRect(); });
      card.addEventListener("mousemove", function (e) {
        if (!bounds) bounds = card.getBoundingClientRect();
        var px = (e.clientX - bounds.left) / bounds.width - 0.5;
        var py = (e.clientY - bounds.top) / bounds.height - 0.5;
        gsap.to(card, { rotateY: px * 10, rotateX: -py * 10, duration: 0.5, ease: "power2.out", transformPerspective: 900 });
      });
      card.addEventListener("mouseleave", function () {
        gsap.to(card, { rotateY: 0, rotateX: 0, duration: 0.6, ease: "elastic.out(1, 0.6)" });
      });
    });

    /* ---------- Boutons magnétiques ---------- */
    document.querySelectorAll(".btn.mag").forEach(function (btn) {
      btn.addEventListener("mousemove", function (e) {
        var r = btn.getBoundingClientRect();
        gsap.to(btn, { x: (e.clientX - r.left - r.width / 2) * 0.35, y: (e.clientY - r.top - r.height / 2) * 0.5, duration: 0.3, ease: "power2.out" });
      });
      btn.addEventListener("mouseleave", function () { gsap.to(btn, { x: 0, y: 0, duration: 0.5, ease: "elastic.out(1, 0.5)" }); });
    });
  }

  /* ---------- Terminal : effet machine à écrire, une fois visible ---------- */
  var tw = document.querySelector(".typewriter");
  if (tw) {
    var fullText = tw.dataset.text || "";
    ScrollTrigger.create({
      trigger: tw, start: "top 75%", once: true,
      onEnter: function () {
        var i = 0;
        var step = function () {
          tw.textContent = fullText.slice(0, i);
          i += 2;
          if (i <= fullText.length) requestAnimationFrame(step); else tw.textContent = fullText;
        };
        step();
      },
    });
  }
})();
