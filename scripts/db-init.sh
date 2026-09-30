#!/bin/sh
# Exécuté une seule fois, à la création de la base.
# Crée un compte dédié à l'app, SANS droits d'administration :
# c'est indispensable pour que le cloisonnement des foyers (RLS) soit appliqué.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE potcommun LOGIN PASSWORD '${DB_APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE potcommun OWNER potcommun;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname potcommun -c "REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT ALL ON SCHEMA public TO potcommun;"
