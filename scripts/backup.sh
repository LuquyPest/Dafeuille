#!/bin/sh
# Sauvegarde de la base + des fichiers uploadés (à lancer depuis le dossier du projet, idéalement
# chaque nuit via cron). Chiffrée si BACKUP_PASSPHRASE est définie dans .env (voir LISEZMOI).
# Restauration base    : [gpg -d --batch --passphrase "$BACKUP_PASSPHRASE" -o f.dump f.dump.gpg &&] \
#                         docker compose exec -T db pg_restore -U postgres -d potcommun --clean < backups/dafeuille-FICHIER.dump
# Restauration fichiers : docker compose exec -T app tar xzf - -C /app/data/uploads < backups/uploads-FICHIER.tar.gz
#                         docker compose exec -T app tar xzf - -C /app/data/private < backups/private-FICHIER.tar.gz
set -e
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
mkdir -p backups
TS="$(date +%Y-%m-%d_%H%M)"
F="backups/dafeuille-$TS.dump"
U="backups/uploads-$TS.tar.gz"
P="backups/private-$TS.tar.gz"
docker compose exec -T db pg_dump -U postgres -Fc potcommun > "$F"
docker compose exec -T app tar czf - -C /app/data/uploads . > "$U"
docker compose exec -T app tar czf - -C /app/data/private . > "$P"
if [ -n "$BACKUP_PASSPHRASE" ]; then
  for f in "$F" "$U" "$P"; do
    gpg --batch --yes --passphrase "$BACKUP_PASSPHRASE" --symmetric --cipher-algo AES256 -o "$f.gpg" "$f"
    rm -f "$f"
  done
  F="$F.gpg"; U="$U.gpg"; P="$P.gpg"
else
  echo "Astuce : définissez BACKUP_PASSPHRASE dans .env pour chiffrer automatiquement ces sauvegardes." >&2
fi
find backups -name 'dafeuille-*.dump*' -mtime +30 -delete
find backups -name 'uploads-*.tar.gz*' -mtime +30 -delete
find backups -name 'private-*.tar.gz*' -mtime +30 -delete
echo "Sauvegarde : $F, $U et $P"
