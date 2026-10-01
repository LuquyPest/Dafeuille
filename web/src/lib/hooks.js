import { useSyncExternalStore } from "react";
import { subscribe, getVersion } from "./core.js";

/** Redessine le composant à chaque bump() de l'état partagé. */
export const useStore = () => useSyncExternalStore(subscribe, getVersion);

/* Niveaux de compte (même barème que le serveur et l'ancienne interface) */
export const xpForLevel = n => 50 * n * (n + 1) / 2;
export function levelInfo(xp){
  xp = xp || 0;
  let level = 1; while (xpForLevel(level) <= xp) level++;
  const floor = xpForLevel(level - 1), ceil = xpForLevel(level);
  const title = level >= 36 ? "Légende" : level >= 21 ? "Maître" : level >= 11 ? "Expert" : level >= 6 ? "Habitué" : "Débutant";
  return {level, xp, floor, ceil, pct:Math.max(0, Math.min(100, Math.round((xp - floor) / (ceil - floor) * 100))), title};
}
