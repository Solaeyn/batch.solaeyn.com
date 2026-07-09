import pg from "pg";
import { createPgPoolConfig } from "./db-config.ts";

const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/solaeyn";
const primaryConnectionString = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
const batchConnectionString = process.env.BATCH_DATABASE_URL || primaryConnectionString;

const createPool = (connectionString: string) => {
  return new pg.Pool(createPgPoolConfig(connectionString));
};

const primaryPool = createPool(primaryConnectionString);
const batchPool = batchConnectionString === primaryConnectionString
  ? primaryPool
  : createPool(batchConnectionString);

const attachPoolErrorHandler = (name: string, pool: pg.Pool) => {
  pool.on("error", (err) => {
    console.error(`Unexpected ${name} PG pool error:`, err.message);
  });
};

attachPoolErrorHandler("primary", primaryPool);
if (batchPool !== primaryPool) {
  attachPoolErrorHandler("batch", batchPool);
}

export const primaryQuery = (text: string, params: unknown[] = []) => primaryPool.query(text, params);
export const batchQuery = (text: string, params: unknown[] = []) => batchPool.query(text, params);

// Backward-compatible default query for builder tables.
export const query = batchQuery;

export const getPrimaryPool = () => primaryPool;
export const getBatchPool = () => batchPool;
export const getPool = () => batchPool;

export async function runMigrations() {
  await batchQuery(`
    CREATE TABLE IF NOT EXISTS batch_scripts (
      id          BIGSERIAL PRIMARY KEY,
      user_id     INT NOT NULL,
      name        VARCHAR(120) NOT NULL,
      description TEXT,
      settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
      blocks      JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await batchQuery(`
    CREATE INDEX IF NOT EXISTS idx_batch_scripts_owner_updated
    ON batch_scripts (user_id, updated_at DESC)
  `);
}

export async function close() {
  if (batchPool !== primaryPool) {
    await batchPool.end();
  }
  await primaryPool.end();
}
