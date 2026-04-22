/**
 * PostgreSQL pool for the runner DB (schema `runner.*`).
 *
 * The web app's API routes under /api/vga/* write directly to the same
 * PG instance the runner uses. Plan §4 explicitly chose PG over
 * IndexedDB so state machines, runs, and shadow-eval rows are shared
 * across runner + web + the Python worker.
 *
 * Connection strategy mirrors the FastAPI backend's `app/db/runner_db.py`:
 *   - DSN resolved from `RUNNER_DATABASE_URL`, falling back to
 *     `DATABASE_URL`, then to the dev default.
 *   - Every acquired client sets `search_path TO runner, public` before
 *     the caller sees it, matching the dual-schema setup described in
 *     memory note `proj_pg_dual_schema_runner_public.md`.
 *
 * This module is server-only — never import from client components.
 */

import { Pool, type PoolClient, type PoolConfig } from "pg";

const DEFAULT_DSN =
  "postgresql://qontinui_user:qontinui_dev_password@localhost:5432/qontinui_db";

let pool: Pool | null = null;

function resolveDsn(): string {
  const url =
    process.env.RUNNER_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_DSN;
  // asyncpg-style driver prefix from SQLAlchemy configs isn't valid for node-postgres.
  return url.replace(/^postgresql\+asyncpg:\/\//, "postgresql://");
}

function getPool(): Pool {
  if (pool === null) {
    const config: PoolConfig = {
      connectionString: resolveDsn(),
      max: Number.parseInt(process.env.RUNNER_DB_POOL_SIZE ?? "5", 10),
      idleTimeoutMillis: 30_000,
    };
    pool = new Pool(config);
    pool.on("error", (err: Error) => {
      console.error("[vga-db] idle client error:", err);
    });
  }
  return pool;
}

/**
 * Acquire a pooled client with `search_path` already set. Callers MUST
 * release via `client.release()` in a finally block.
 */
export async function getVgaClient(): Promise<PoolClient> {
  const client = await getPool().connect();
  try {
    await client.query("SET search_path TO runner, public");
  } catch (err) {
    client.release();
    throw err;
  }
  return client;
}

/**
 * Run a single parameterized query with a temporary client.
 *
 * Use this for one-shot queries. For multi-statement transactions,
 * call `getVgaClient` directly and manage BEGIN/COMMIT yourself.
 */
// node-postgres constrains result row generic to its own QueryResultRow,
// which is `Record<string, unknown>` at runtime but typed opaquely. We
// cast via `as unknown as <alias>` so callers can pass their own row
// shape without tripping `noImplicitAny` or the library's constraint.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

export async function vgaQuery<T = AnyRow>(
  text: string,
  params: ReadonlyArray<unknown> = []
): Promise<{ rows: T[]; rowCount: number }> {
  const client = await getVgaClient();
  try {
    const result = await client.query(text, params as unknown as unknown[]);
    return {
      rows: result.rows as unknown as T[],
      rowCount: result.rowCount ?? 0,
    };
  } finally {
    client.release();
  }
}
