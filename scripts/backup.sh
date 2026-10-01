#!/bin/sh
# Sauvegarde de la base + des fichiers uploadés (à lancer depuis le dossier du projet, idéalement
# chaque nuit via cron).
# Restauration base : docker compose exec -T db pg_restore -U postgres -d potcommun --clean < backups/dafeuille-FICHIER.dump
# Restauration fichiers : docker compose exec -T app tar xzf - -C /app/data/uploads < backups/uploads-FICHIER.tar.gz
#                         docker compose exec -T app tar xzf - -C /app/data/private < backups/private-FICHIER.tar.gz
set -e
cd "$(dirname "$0")/.."
mkdir -p backups
TS="$(date +%Y-%m-%d_%H%M)"
F="backups/dafeuille-$TS.dump"
U="backups/uploads-$TS.tar.gz"
P="backups/private-$TS.tar.gz"
docker compose exec -T db pg_dump -U postgres -Fc potcommun > "$F"
docker compose exec -T app tar czf - -C /app/data/uploads . > "$U"
docker compose exec -T app tar czf - -C /app/data/private . > "$P"
find backups -name 'dafeuille-*.dump' -mtime +30 -delete
find backups -name 'uploads-*.tar.gz' -mtime +30 -delete
find backups -name 'private-*.tar.gz' -mtime +30 -delete
echo "Sauvegarde : $F, $U et $P"
