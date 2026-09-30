#!/bin/sh
# Sauvegarde de la base (à lancer depuis le dossier du projet, idéalement chaque nuit via cron).
# Restauration : docker compose exec -T db pg_restore -U postgres -d potcommun --clean < backups/FICHIER.dump
set -e
cd "$(dirname "$0")/.."
mkdir -p backups
F="backups/dafeuille-$(date +%Y-%m-%d_%H%M).dump"
docker compose exec -T db pg_dump -U postgres -Fc potcommun > "$F"
find backups -name 'dafeuille-*.dump' -mtime +30 -delete
echo "Sauvegarde : $F"
