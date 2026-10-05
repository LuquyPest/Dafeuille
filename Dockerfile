# 1) Build de l'interface React (Vite) — dépendances de dev uniquement dans cette étape
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
RUN npm run build:web

# 2) Image d'exécution : serveur + fichiers statiques, sans outils de build
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY sql ./sql
COPY public ./public
COPY --from=web /app/web-dist ./web-dist
RUN mkdir -p data/uploads data/private/tickets && chown -R node:node data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "src/server.js"]
