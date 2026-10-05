import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Interface React : construite dans web-dist/, servie à la racine par le serveur Express.
export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  base: "/",
  plugins: [react()],
  build: { outDir: "../web-dist", emptyOutDir: true, sourcemap: false, target: "es2022" },
  server: { proxy: { "/api": "https://dafeuille.daryu.xyz", "/uploads": "https://dafeuille.daryu.xyz" } },
});
