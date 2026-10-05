/* Registre des vues par onglet ; chaque phase de la migration remplace un Pending par la vraie vue. */
import { createElement as h } from "react";
import Budget from "./Budget.jsx";
import Analyse from "./Analyse.jsx";
import Courses from "./Courses.jsx";
import Projets from "./Projets.jsx";
import Agenda from "./Agenda.jsx";

const Pending = label => () => h("section", {className:"panel pending-view"},
  h("h2", null, label),
  h("p", {className:"muted"}, "Cette section n'est pas encore disponible dans la nouvelle interface. ", h("a", {href:"/"}, "Ouvrir l'interface actuelle")));

export const VIEWS = {
  budget: Budget,
  analyse: Analyse,
  courses: Courses,
  projets: Projets,
  agenda: Agenda,
  patrimoine: Pending("Patrimoine"),
};
