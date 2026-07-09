import type pg from "pg";

type DatabaseSslMode = "disable" | "require" | "verify-full";

const SSL_QUERY_PARAMS = ["sslmode", "sslcert", "sslkey", "sslrootcert"];

function normalizeSslMode(value: string | undefined): DatabaseSslMode {
  const mode = String(value || "").trim().toLowerCase();

  if (["true", "1", "yes", "on", "require", "prefer", "verify-ca"].includes(mode)) {
    return "require";
  }

  if (mode === "verify-full") {
    return "verify-full";
  }

  return "disable";
}

function stripSslQueryParams(connectionString: string) {
  try {
    const url = new URL(connectionString);
    for (const param of SSL_QUERY_PARAMS) {
      url.searchParams.delete(param);
    }
    return url.toString();
  } catch {
    return connectionString;
  }
}

export function createPgPoolConfig(connectionString: string, sslModeOverride?: string): pg.PoolConfig {
  const sslMode = normalizeSslMode(sslModeOverride || process.env.DATABASE_SSL_MODE || process.env.PGSSLMODE || process.env.DB_SSL_MODE);
  const sanitizedConnectionString = stripSslQueryParams(connectionString);
  const config: pg.PoolConfig = {
    connectionString: sanitizedConnectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  };

  if (sslMode === "verify-full") {
    config.ssl = { rejectUnauthorized: true };
  } else if (sslMode === "require") {
    config.ssl = { rejectUnauthorized: false };
  } else {
    config.ssl = false;
  }

  return config;
}
