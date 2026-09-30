-- Pot commun : schéma PostgreSQL (idempotent, appliqué au démarrage)

CREATE TABLE IF NOT EXISTS users (
  id              text PRIMARY KEY,
  email           text NOT NULL,
  name            text NOT NULL DEFAULT '',
  pass            text NOT NULL,
  verified_at     timestamptz,
  totp_secret     text,
  totp_pending    text,
  totp_on         boolean NOT NULL DEFAULT false,
  totp_last_step  bigint  NOT NULL DEFAULT 0,
  backup_codes    jsonb   NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (lower(email));
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio    text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS xp     integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS badges jsonb   NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_from_leaderboard boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS users_xp_idx ON users (xp DESC) WHERE hide_from_leaderboard = false;

CREATE TABLE IF NOT EXISTS sessions (
  id          text PRIMARY KEY,                 -- empreinte SHA-256 du jeton
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mfa_pending boolean NOT NULL DEFAULT false,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS email_tokens (
  id          text PRIMARY KEY,                 -- empreinte SHA-256 du jeton
  kind        text NOT NULL,                    -- verify | magic | reset
  user_id     text REFERENCES users(id) ON DELETE CASCADE,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

CREATE TABLE IF NOT EXISTS households (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  created_by  text REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- xp/badges appartiennent à la personne (users), pas au foyer : voir plus haut.
ALTER TABLE households DROP COLUMN IF EXISTS xp;
ALTER TABLE households DROP COLUMN IF EXISTS badges;
ALTER TABLE households ADD COLUMN IF NOT EXISTS ics_token text;
CREATE UNIQUE INDEX IF NOT EXISTS households_ics_token_idx ON households (ics_token) WHERE ics_token IS NOT NULL;

-- Lien public (token en clair, fait pour être partagé) donnant un accès en ajout
-- seulement à un groupe "entre amis" précis, sans compte ni session.
CREATE TABLE IF NOT EXISTS group_links (
  id           text PRIMARY KEY,
  token        text NOT NULL UNIQUE,
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  group_id     text NOT NULL,
  created_by   text REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS group_links_group_idx ON group_links (household_id, group_id) WHERE revoked_at IS NULL;

-- Jetons de "possession" (hachés, jamais relus) permettant à un ami sans compte
-- de modifier/supprimer sa propre entrée ou de renommer sa propre personne,
-- pendant une courte fenêtre après création.
CREATE TABLE IF NOT EXISTS group_claims (
  id           text PRIMARY KEY,
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  group_id     text NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('item','person')),
  subject_id   text NOT NULL,
  token_hash   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS group_claims_subject_idx ON group_claims (household_id, group_id, subject_type, subject_id);

CREATE TABLE IF NOT EXISTS memberships (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('owner','contributor','viewer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id);

CREATE TABLE IF NOT EXISTS invites (
  id           text PRIMARY KEY,
  token_hash   text NOT NULL UNIQUE,
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         text NOT NULL CHECK (role IN ('contributor','viewer')),
  invited_by   text REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS invites_household_idx ON invites (household_id);

-- Données de l'app, stockées comme des documents JSON par foyer.
-- owner = '' pour les données partagées, = id de l'utilisateur pour ses données privées.
CREATE TABLE IF NOT EXISTS docs (
  household_id text NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  coll         text NOT NULL,
  id           text NOT NULL,
  owner        text NOT NULL DEFAULT '',
  data         jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text,
  PRIMARY KEY (household_id, coll, id)
);

-- ---------- Cloisonnement garanti par la base (Row Level Security) ----------
-- Chaque requête applicative fixe app.user_id dans sa transaction ; PostgreSQL
-- refuse alors toute lecture ou écriture hors des foyers de cet utilisateur.
CREATE OR REPLACE FUNCTION app_uid() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;

CREATE OR REPLACE FUNCTION pc_role(hid text) RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT role FROM memberships WHERE household_id = hid AND user_id = app_uid() $$;

ALTER TABLE docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE docs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS docs_select ON docs;
CREATE POLICY docs_select ON docs FOR SELECT
  USING (pc_role(household_id) IS NOT NULL AND (owner = '' OR owner = app_uid()));

DROP POLICY IF EXISTS docs_insert ON docs;
CREATE POLICY docs_insert ON docs FOR INSERT
  WITH CHECK (pc_role(household_id) IN ('owner','contributor') AND (owner = '' OR owner = app_uid()));

DROP POLICY IF EXISTS docs_update ON docs;
CREATE POLICY docs_update ON docs FOR UPDATE
  USING      (pc_role(household_id) IN ('owner','contributor') AND (owner = '' OR owner = app_uid()))
  WITH CHECK (pc_role(household_id) IN ('owner','contributor') AND (owner = '' OR owner = app_uid()));

DROP POLICY IF EXISTS docs_delete ON docs;
CREATE POLICY docs_delete ON docs FOR DELETE
  USING (pc_role(household_id) IN ('owner','contributor') AND (owner = '' OR owner = app_uid()));
