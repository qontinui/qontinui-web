-- Runner schema for qontinui-runner's PostgreSQL tables.
-- Executed once on first PostgreSQL container startup via docker-entrypoint-initdb.d.
-- Separate from qontinui-web's public schema.

CREATE SCHEMA IF NOT EXISTS runner;
GRANT ALL ON SCHEMA runner TO qontinui_user;

-- Enable pgvector for future embedding columns
CREATE EXTENSION IF NOT EXISTS vector;
