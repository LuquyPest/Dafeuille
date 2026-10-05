# DAFeuille — installation sur un VPS Linux

Application de gestion des dépenses du foyer : comptes personnels, plusieurs foyers par compte,
invitations par e-mail, rôles, synchronisation en direct, installable sur l'écran d'accueil du téléphone.

## Ce qu'il faut

- Un VPS Linux (Debian 12 ou Ubuntu 22.04/24.04 conseillés), 1 Go de RAM suffit.
- Un nom de domaine dont un enregistrement **A** pointe vers l'IP du VPS (ex. `budget.exemple.fr`).
- Les ports 80 et 443 ouverts.
- Un compte d'envoi d'e-mails SMTP (Brevo, Mailjet, OVH, Scaleway, Gmail avec mot de passe d'application…).
  Pensez à configurer SPF et DKIM chez votre fournisseur, sinon les e-mails risquent d'arriver en spam.

## Installation (Docker, le plus simple)

```bash
# 1. Installer Docker
curl -fsSL https://get.docker.com | sh

# 2. Copier ce dossier sur le serveur, puis :
cd dafeuille-serveur
cp .env.example .env
nano .env            # domaine, mots de passe, SMTP

# 3. Démarrer
docker compose up -d --build
docker compose logs -f app
```

Le certificat HTTPS est obtenu automatiquement par Caddy. Ouvrez `https://votre-domaine`, créez votre compte,
confirmez l'e-mail, créez votre foyer. Sur le téléphone : menu du navigateur → **Ajouter à l'écran d'accueil**.

Une fois les comptes de la famille créés, vous pouvez mettre `ALLOW_SIGNUP=false` : les nouvelles personnes
ne pourront alors s'inscrire que par invitation (`docker compose up -d` pour appliquer).

## Fonctionnement des comptes

- **Inscription** : e-mail + mot de passe (10 caractères minimum), puis e-mail de confirmation obligatoire.
- **Connexion** : mot de passe, ou lien de connexion reçu par e-mail (valable 15 min, usage unique).
- **Double authentification** (Réglages › Mon compte) : application TOTP (Google Authenticator, Microsoft
  Authenticator, 1Password…) + 10 codes de secours.
- **Mot de passe oublié** : lien par e-mail valable 1 heure ; toutes les sessions sont alors fermées.
- **Plusieurs foyers** : après connexion, la liste de vos foyers s'affiche ; « Changer » dans les réglages.

## Rôles et invitations

| Rôle | Voir | Modifier les données | Gérer les accès |
|---|---|---|---|
| Propriétaire | oui | oui | oui |
| Contributeur | oui | oui | non |
| Lecteur | oui | non | non |

Réglages › Accès au foyer : saisissez l'e-mail et le rôle. La personne reçoit un e-mail :
- sans compte, elle le crée depuis le lien et rejoint automatiquement le foyer après confirmation ;
- avec un compte, elle se connecte et accepte l'invitation.
Une invitation n'est utilisable que par l'adresse invitée, pendant 7 jours.

Les « dépenses perso » restent visibles uniquement par leur auteur, même au sein du foyer.

## Sécurité

- **Cloisonnement des foyers à deux niveaux** : contrôle dans le code, et politique *Row Level Security*
  dans PostgreSQL. L'app utilise un compte PostgreSQL dédié sans droits d'administration (créé par
  `scripts/db-init.sh`) ; le serveur refuse de démarrer s'il est branché sur un compte administrateur.
- Mots de passe hachés avec scrypt ; jetons de session et liens e-mail stockés sous forme d'empreinte.
- Cookies `HttpOnly`, `Secure`, `SameSite` ; protection anti-CSRF ; limitation des tentatives de connexion.
- En-têtes de sécurité (HSTS…), HTTPS automatique, et CSP stricte : aucun script ni style en ligne,
  aucun script tiers (l'interface est un bundle servi par le serveur ; seules les polices viennent de Google Fonts).

## Développement de l'interface

L'interface est en React (dossier `web/`, construite par Vite dans `web-dist/` lors du `docker compose build`).

```bash
npm install
npm run dev:web      # serveur de développement (l'API est relayée vers la production, voir web/vite.config.mjs)
npm run build:web    # construit web-dist/
```

## Connexion bancaire automatique (facultatif)

Les dépenses et revenus peuvent se remplir tout seuls depuis un compte bancaire réel, via
[Enable Banking](https://enablebanking.com/), un agrégateur conforme DSP2. Son mode **Restricted
Production** est gratuit et sans contrat pour un usage personnel (comptes que vous liez vous-même),
tant que l'app n'est pas rendue publique à d'autres personnes — exactement notre cas.

1. Créez un compte sur le [Control Panel Enable Banking](https://enablebanking.com/cp/).
2. Onglet **API applications** → *Add a new application*. Environnement **Production** (pas Sandbox),
   laissez « Generate in the browser and export private key » coché, mettez l'URL de redirection
   `https://votre-domaine/api/h/PLACEHOLDER/bank/callback` (le `PLACEHOLDER` n'a pas d'importance, seul
   le domaine compte). Validez : une clé privée `.pem` se télécharge, et l'**Application ID** s'affiche.
3. L'application démarre *Inactive*. Cliquez **Activate by linking accounts** et reliez-y un premier
   compte bancaire à vous (cette unique étape passe par le site d'Enable Banking, pas par DAFeuille) :
   cela active le mode Restricted Production, gratuit, sans KYB ni contrat.
4. Ajoutez dans `.env` (le contenu du `.pem` sur une seule ligne, `\n` à la place des retours à la ligne) :
   ```
   EB_APPLICATION_ID=votre_application_id
   EB_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"
   ```
5. `docker compose up -d` pour appliquer.

Dans l'app : Patrimoine › Comptes › **Connexion bancaire**. Pour chaque compte (y compris celui déjà lié
à l'étape 3), la personne choisit sa banque, s'authentifie sur une page sécurisée (jamais sur ce serveur),
et revient automatiquement. Les opérations des 90 derniers jours sont importées une première fois, puis
une synchronisation automatique tourne 3 fois par jour (bouton « Synchroniser » pour forcer une mise à
jour) — beaucoup de banques limitent à 4 relevés par jour hors présence de l'utilisateur. La connexion
est en lecture seule et révocable à tout moment depuis cette même fenêtre. Sans ces deux clés, le bouton
reste présent mais indique que la fonction n'est pas configurée sur ce serveur.

## Sauvegardes

```bash
./scripts/backup.sh                       # crée backups/dafeuille-DATE.dump (garde 30 jours)
crontab -e                                # tous les jours à 3 h :
0 3 * * * cd /chemin/dafeuille-serveur && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Chiffrement : ajoutez `BACKUP_PASSPHRASE=une-phrase-longue-et-aleatoire` dans `.env` pour que chaque
sauvegarde soit automatiquement chiffrée (AES-256 via `gpg`, le fichier en clair est supprimé après
coup) — recommandé avant de copier les sauvegardes hors du VPS. Nécessite le paquet `gnupg`
(`apt install gnupg` si `gpg` n'est pas déjà présent). Sans cette variable, les sauvegardes restent en
clair comme avant.

Restauration :
```bash
# si chiffré :
gpg -d --batch --passphrase "$BACKUP_PASSPHRASE" -o backups/FICHIER.dump backups/FICHIER.dump.gpg
docker compose exec -T db pg_restore -U postgres -d potcommun --clean < backups/FICHIER.dump
```
Copiez régulièrement le dossier `backups` hors du VPS.

## Mises à jour

Remplacez les fichiers (sauf `.env`), puis `docker compose up -d --build`. Le schéma de la base se met à jour
automatiquement au démarrage.

## Sans Docker (optionnel)

PostgreSQL 14+ et Node.js 20+ installés sur le système :
1. Créer le compte et la base : exécuter le contenu SQL de `scripts/db-init.sh` avec `psql` (en tant que postgres).
2. `npm ci --omit=dev`, puis lancer `node src/server.js` avec les variables de `.env` et
   `DATABASE_URL=postgres://potcommun:MOTDEPASSE@localhost:5432/potcommun` (service systemd conseillé).
3. Mettre un reverse proxy HTTPS devant le port 3000 (Caddy ou nginx ; pour nginx, désactiver le buffering
   sur `/api/h/*/events` : `proxy_buffering off;`).

## Dépannage

- **Pas d'e-mail reçu** : `docker compose logs app` (erreurs SMTP, ou liens affichés si SMTP non configuré).
- **« Le compte PostgreSQL de l'app est administrateur »** : la base a été créée sans le script d'initialisation ;
  supprimez le volume (`docker compose down -v`, attention : efface les données) ou créez le compte à la main.
