import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// La nouvelle interface est servie sous /beta tant que l'ancienne reste en production à /.
export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  base: "/beta/",
  plugins: [react()],
  build: { outDir: "../public-v2", emptyOutDir: true, sourcemap: false, target: "es2022" },
  server: { proxy: { "/api": "https://dafeuille.daryu.xyz", "/uploads": "https://dafeuille.daryu.xyz" } },
});
