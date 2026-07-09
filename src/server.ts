import "dotenv/config";
import compression from "compression";
import crypto from "crypto";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import { primaryQuery, query, runMigrations, close as closeDb } from "./db.ts";
import { connectRedis, closeRedis, destroySession, getRedis, getSession, touchSession } from "./sessions.ts";
import { renderDashboardPage } from "./dashboard-pages.ts";
import { consumeFixedWindow, FixedWindowRateLimitRule } from "./fixed-window-rate-limit.ts";
import { redactMetadataValue, redactSensitiveText } from "./redaction.ts";
import {
  BATCH_BLOCK_DEFINITIONS,
  generateBatchScript,
  normalizeBlocks,
  normalizeSettings,
  toBatchFileName
} from "./batch-generator.ts";
import { WINDOWS_COMMANDS } from "./windows-commands.ts";
import "./types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

const PORT = Number(process.env.PORT) || 3020;
const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
const isProd = process.env.NODE_ENV === "production";
const SESSION_COOKIE_DOMAIN = String(process.env.SESSION_COOKIE_DOMAIN || "").trim();
const CSRF_COOKIE_NAME = "csrfToken";
const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_SECRET = String(process.env.CSRF_SECRET || "").trim() || crypto.randomBytes(32).toString("hex");

const SCRIPT_CREATE_RATE_LIMIT_WINDOW_SECONDS = Math.max(1, Number(process.env.SCRIPT_CREATE_RATE_LIMIT_WINDOW_SECONDS) || 60 * 60);
const SCRIPT_CREATE_RATE_LIMIT_MAX_USER = Math.max(1, Number(process.env.SCRIPT_CREATE_RATE_LIMIT_MAX_USER) || 60);
const SCRIPT_READ_RATE_LIMIT_WINDOW_SECONDS = Math.max(1, Number(process.env.SCRIPT_READ_RATE_LIMIT_WINDOW_SECONDS) || 5 * 60);
const SCRIPT_READ_RATE_LIMIT_MAX_USER = Math.max(1, Number(process.env.SCRIPT_READ_RATE_LIMIT_MAX_USER) || 240);
const SCRIPT_MUTATION_RATE_LIMIT_WINDOW_SECONDS = Math.max(1, Number(process.env.SCRIPT_MUTATION_RATE_LIMIT_WINDOW_SECONDS) || 15 * 60);
const SCRIPT_MUTATION_RATE_LIMIT_MAX_USER = Math.max(1, Number(process.env.SCRIPT_MUTATION_RATE_LIMIT_MAX_USER) || 240);

const MAX_SCRIPTS_PER_USER = Math.max(1, Number(process.env.MAX_SCRIPTS_PER_USER) || 200);

if (isProd && !process.env.CSRF_SECRET) {
  console.warn("CSRF_SECRET is not configured; using an ephemeral key for this process.");
}

app.disable("x-powered-by");

function applyNoStoreHeaders(res: express.Response) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

type SessionAuthResult =
  | { ok: true; sessionUser: Express.Request["sessionUser"] }
  | { ok: false; reason: "missing" | "disabled" | "revoked" };

type SessionAuthResultWithMeta =
  | { ok: true; sessionUser: Express.Request["sessionUser"]; sidCount: number }
  | { ok: false; reason: "missing" | "disabled" | "revoked"; sidCount: number };

type SessionAuthFailureReason = Extract<SessionAuthResult, { ok: false }>["reason"];

type ScriptRow = {
  id: number;
  userId: number;
  name: string;
  description: string | null;
  settings: unknown;
  blocks: unknown;
  createdAt: string;
  updatedAt: string;
};

const SCRIPT_SELECT_COLUMNS = `
  id,
  user_id AS "userId",
  name,
  description,
  settings,
  blocks,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const SCRIPT_SUMMARY_COLUMNS = `
  id,
  user_id AS "userId",
  name,
  description,
  settings,
  jsonb_array_length(blocks) AS "blockCount",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

function logScriptOperationError(
  operation: string,
  error: unknown,
  context: Record<string, unknown> = {}
) {
  const detail = error instanceof Error
    ? error.stack || `${error.name}: ${error.message}`
    : String(error || "Unknown error");

  console.error(
    `[script-operation:${operation}]`,
    redactSensitiveText(detail),
    redactMetadataValue(context)
  );
}

function createCsrfTokenForSid(sid: string) {
  return crypto.createHmac("sha256", CSRF_SECRET).update(String(sid || "")).digest("hex");
}

function secureTokenEquals(left: string, right: string) {
  const leftValue = String(left || "");
  const rightValue = String(right || "");
  if (!leftValue || !rightValue || leftValue.length !== rightValue.length) return false;

  const leftBuffer = Buffer.from(leftValue, "utf8");
  const rightBuffer = Buffer.from(rightValue, "utf8");
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function appendSetCookie(res: express.Response, cookieValue: string) {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", [cookieValue]);
    return;
  }

  if (Array.isArray(current)) {
    res.setHeader("Set-Cookie", [...current, cookieValue]);
    return;
  }

  res.setHeader("Set-Cookie", [String(current), cookieValue]);
}

const parseCookieValues = (cookieHeader = ""): Record<string, string[]> => {
  return cookieHeader.split(";").reduce<Record<string, string[]>>((acc, segment) => {
    const trimmed = segment.trim();
    if (!trimmed) return acc;

    const eqIndex = trimmed.indexOf("=");
    const key = (eqIndex === -1 ? trimmed : trimmed.slice(0, eqIndex)).trim();
    if (!key) return acc;

    const rawValue = eqIndex === -1 ? "" : trimmed.slice(eqIndex + 1);
    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      value = rawValue;
    }

    if (!acc[key]) acc[key] = [];
    acc[key].push(value);
    return acc;
  }, {});
};

const getCookieValues = (cookieHeader = "", key: string): string[] => {
  return parseCookieValues(cookieHeader)[key] || [];
};

const isSecureRequest = (req) => req.secure || req.headers["x-forwarded-proto"] === "https";

const getRequestHost = (req) => {
  const forwarded = req.headers["x-forwarded-host"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return String(req.headers.host || "").trim();
};

const toHostname = (host: string) => {
  const value = host.trim().toLowerCase();
  if (!value) return "";

  if (value.startsWith("[") && value.includes("]")) {
    return value.slice(1, value.indexOf("]"));
  }

  return value.split(":")[0];
};

const isIpAddress = (hostname: string) => {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  return hostname.includes(":");
};

const deriveApexDomain = (hostname: string) => {
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  return labels.slice(-2).join(".");
};

const normalizeAuthLoginUrl = (rawValue: string) => {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) return "";

  const value = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/+/, "")}`;

  try {
    const parsed = new URL(value);
    if (!parsed.hostname) return "";
    return value;
  } catch {
    return "";
  }
};

const getAuthRedirectUrl = (req) => {
  const configuredAuthUrl = normalizeAuthLoginUrl(process.env.AUTH_LOGIN_URL || "");
  if (configuredAuthUrl) {
    return configuredAuthUrl;
  }

  const hostname = toHostname(getRequestHost(req));
  if (!hostname || hostname === "localhost" || isIpAddress(hostname)) {
    return "https://solaeyn.com";
  }

  const apexDomain = deriveApexDomain(hostname);
  if (!apexDomain) {
    return "https://solaeyn.com";
  }

  return `https://${apexDomain}`;
};

const resolveSessionCookieDomain = (req) => {
  const configured = String(SESSION_COOKIE_DOMAIN || "").trim();
  if (configured) {
    return configured.startsWith(".") ? configured : `.${configured}`;
  }

  const hostname = toHostname(getRequestHost(req));
  if (!hostname || hostname === "localhost" || isIpAddress(hostname)) {
    return "";
  }

  const apexDomain = deriveApexDomain(hostname);
  return apexDomain ? `.${apexDomain}` : "";
};

const buildCookieDomainSuffix = (req) => {
  const domain = resolveSessionCookieDomain(req);
  if (!domain) return "";
  return `; Domain=${domain}`;
};

const buildClearedSessionCookie = (req) => {
  return `sid=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${buildCookieDomainSuffix(req)}${isSecureRequest(req) ? "; Secure" : ""}`;
};

const buildCsrfCookie = (req, sid, ttlSeconds = 60 * 60 * 24 * 30) => {
  const token = createCsrfTokenForSid(sid);
  return `${CSRF_COOKIE_NAME}=${token}; Max-Age=${ttlSeconds}; Path=/; SameSite=Lax${buildCookieDomainSuffix(req)}${isSecureRequest(req) ? "; Secure" : ""}`;
};

const buildClearedCsrfCookie = (req) => {
  return `${CSRF_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax${buildCookieDomainSuffix(req)}${isSecureRequest(req) ? "; Secure" : ""}`;
};

async function validateSessionBySid(sid: string, shouldTouch = true): Promise<SessionAuthResult> {
  if (!sid) return { ok: false, reason: "missing" };

  const session = await getSession(sid);
  if (!session) return { ok: false, reason: "missing" };

  const result = await primaryQuery(
    "SELECT id, username, role, disabled, session_version FROM users WHERE id = $1",
    [session.userId]
  );

  const user = result.rows[0];
  if (!user) return { ok: false, reason: "missing" };
  if (user.disabled) return { ok: false, reason: "disabled" };

  const currentVersion = Number(user.session_version || 1);
  const rawSessionVersion = session.sessionVersion ?? session.session_version;
  const hasSessionVersion = rawSessionVersion !== undefined && rawSessionVersion !== null && rawSessionVersion !== "";
  const sessionVersion = hasSessionVersion ? Number(rawSessionVersion) : currentVersion;

  if (!Number.isFinite(sessionVersion)) {
    return { ok: false, reason: "revoked" };
  }

  if (currentVersion !== sessionVersion) {
    return { ok: false, reason: "revoked" };
  }

  if (shouldTouch) {
    touchSession(sid, {
      ...session,
      sessionVersion,
      session_version: sessionVersion
    }).catch(() => {});
  }

  return {
    ok: true,
    sessionUser: {
      sid,
      userId: Number(user.id),
      username: String(user.username),
      role: String(user.role),
      sessionVersion: currentVersion,
      createdAt: Number(session.createdAt || 0),
      lastSeenAt: Number(session.lastSeenAt || 0)
    }
  };
}

async function validateSessionFromRequest(req, shouldTouch = true): Promise<SessionAuthResultWithMeta> {
  const sidCandidates = getCookieValues(req.headers.cookie || "", "sid")
    .map((candidate) => String(candidate || "").trim())
    .filter(Boolean);

  if (!sidCandidates.length) {
    return { ok: false, reason: "missing", sidCount: 0 };
  }

  if (sidCandidates.length === 1) {
    const auth = await validateSessionBySid(sidCandidates[0], shouldTouch);
    if (auth.ok) return { ok: true, sessionUser: auth.sessionUser, sidCount: 1 };
    const failedAuth = auth as Extract<SessionAuthResult, { ok: false }>;
    return { ok: false, reason: failedAuth.reason, sidCount: 1 };
  }

  let lastReason: SessionAuthFailureReason = "missing";
  for (const sid of sidCandidates) {
    const auth = await validateSessionBySid(sid, shouldTouch);
    if (auth.ok) {
      return { ok: true, sessionUser: auth.sessionUser, sidCount: sidCandidates.length };
    }
    const failedAuth = auth as Extract<SessionAuthResult, { ok: false }>;
    lastReason = failedAuth.reason;
  }

  return { ok: false, reason: lastReason, sidCount: sidCandidates.length };
}

const logAuthFailure = (req, auth: SessionAuthResultWithMeta, target: string) => {
  if (auth.ok) return;
  const failedAuth = auth as Extract<SessionAuthResultWithMeta, { ok: false }>;

  const cookieHeader = String(req.headers.cookie || "");
  const cookieNames = Object.keys(parseCookieValues(cookieHeader));

  console.warn(
    "[auth] redirect to %s | host=%s path=%s reason=%s sidCount=%d cookieNames=%s cookieDomain=%s",
    target,
    getRequestHost(req),
    req.originalUrl || req.url,
    failedAuth.reason,
    auth.sidCount,
    cookieNames.length ? cookieNames.join(",") : "<none>",
    resolveSessionCookieDomain(req) || "<none>"
  );
};

const authRequired = async (req, res, next) => {
  const auth = await validateSessionFromRequest(req, true);

  if (!auth.ok) {
    const failedAuth = auth as Extract<SessionAuthResultWithMeta, { ok: false }>;
    if (failedAuth.reason === "disabled") {
      return res.status(403).json({ success: false, message: "This account has been disabled." });
    }
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  req.sessionUser = auth.sessionUser;

  const csrfCookie = String(getCookieValues(req.headers.cookie || "", CSRF_COOKIE_NAME)[0] || "").trim();
  const expectedCsrf = createCsrfTokenForSid(auth.sessionUser.sid);
  if (!secureTokenEquals(csrfCookie, expectedCsrf)) {
    appendSetCookie(res, buildCsrfCookie(req, auth.sessionUser.sid));
  }

  return next();
};

const requireCsrfToken = (req, res, next) => {
  if (!req.sessionUser?.sid) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const cookieToken = String(getCookieValues(req.headers.cookie || "", CSRF_COOKIE_NAME)[0] || "").trim();
  const headerValue = req.headers[CSRF_HEADER_NAME];
  const headerToken = Array.isArray(headerValue)
    ? String(headerValue[0] || "").trim()
    : String(headerValue || "").trim();
  const expected = createCsrfTokenForSid(req.sessionUser.sid);

  const cookieValid = secureTokenEquals(cookieToken, expected);
  const headerValid = secureTokenEquals(headerToken, expected);

  if (!cookieValid) {
    appendSetCookie(res, buildCsrfCookie(req, req.sessionUser.sid));
  }

  if (!cookieValid || !headerValid) {
    return res.status(403).json({ success: false, message: "CSRF token missing or invalid." });
  }

  return next();
};

const pageAuthRequired = async (req, res, next) => {
  const auth = await validateSessionFromRequest(req, true);

  if (!auth.ok) {
    const target = getAuthRedirectUrl(req);
    logAuthFailure(req, auth, target);
    return res.redirect(target);
  }

  req.sessionUser = auth.sessionUser;

  const csrfCookie = String(getCookieValues(req.headers.cookie || "", CSRF_COOKIE_NAME)[0] || "").trim();
  const expectedCsrf = createCsrfTokenForSid(auth.sessionUser.sid);
  if (!secureTokenEquals(csrfCookie, expectedCsrf)) {
    appendSetCookie(res, buildCsrfCookie(req, auth.sessionUser.sid));
  }

  return next();
};

const toScriptId = (raw: string) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
};

const rateLimitKeyPart = (value: unknown) => String(value || "unknown")
  .toLowerCase()
  .replace(/[^a-z0-9:._-]/g, "_");

const scriptRateLimitKey = (scope: string, ...parts: unknown[]) =>
  `rl:batch:${scope}:${parts.map(rateLimitKeyPart).join(":")}`;

const createScriptRateLimit = (
  operation: string,
  windowSeconds: number,
  buildRules: (req: express.Request) => FixedWindowRateLimitRule[]
) => async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const result = await consumeFixedWindow(getRedis(), buildRules(req), windowSeconds);
    if (result.allowed) return next();

    res.setHeader("Retry-After", String(result.retryAfterSeconds));
    return res.status(429).json({
      success: false,
      message: "Too many requests. Try again later."
    });
  } catch (error) {
    logScriptOperationError(`${operation}-rate-limit`, error, {
      userId: req.sessionUser?.userId || null,
      scriptId: req.params.id || null
    });
    return res.status(503).json({
      success: false,
      message: "Service temporarily unavailable."
    });
  }
};

const scriptCreateRateLimit = createScriptRateLimit(
  "create",
  SCRIPT_CREATE_RATE_LIMIT_WINDOW_SECONDS,
  (req) => [{
    key: scriptRateLimitKey("create", "user", req.sessionUser?.userId),
    limit: SCRIPT_CREATE_RATE_LIMIT_MAX_USER
  }]
);

const scriptReadRateLimit = createScriptRateLimit(
  "read",
  SCRIPT_READ_RATE_LIMIT_WINDOW_SECONDS,
  (req) => [{
    key: scriptRateLimitKey("read", "user", req.sessionUser?.userId),
    limit: SCRIPT_READ_RATE_LIMIT_MAX_USER
  }]
);

const scriptMutationRateLimit = createScriptRateLimit(
  "mutation",
  SCRIPT_MUTATION_RATE_LIMIT_WINDOW_SECONDS,
  (req) => [{
    key: scriptRateLimitKey("mutation", "user", req.sessionUser?.userId),
    limit: SCRIPT_MUTATION_RATE_LIMIT_MAX_USER
  }]
);

const normalizeName = (raw: unknown) => String(raw || "").replace(/[\r\n]+/g, " ").trim().slice(0, 120);
const normalizeDescription = (raw: unknown) => String(raw || "").trim().slice(0, 500) || null;

const serializeScript = (row: ScriptRow) => ({
  id: Number(row.id),
  name: row.name,
  description: row.description,
  settings: normalizeSettings(row.settings),
  blocks: normalizeBlocks(row.blocks),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

const serializeScriptSummary = (row: ScriptRow & { blockCount?: number }) => ({
  id: Number(row.id),
  name: row.name,
  description: row.description,
  settings: normalizeSettings(row.settings),
  blockCount: Number(row.blockCount || 0),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

app.use((_req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(18).toString("base64url");
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      scriptSrc: [
        "'self'",
        (_req, res) => `'nonce-${String((res as express.Response).locals.cspNonce || "")}'`
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: isProd ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  crossOriginResourcePolicy: { policy: "same-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  strictTransportSecurity: isProd
    ? {
      maxAge: 15552000,
      includeSubDomains: true,
      preload: false
    }
    : false
}));

app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()"
  );
  next();
});

app.use(compression());
if (!isTest) {
  app.use(morgan("tiny", {
    stream: {
      write(message) {
        console.log(redactSensitiveText(String(message || "").trimEnd()));
      }
    }
  }));
}
app.use(express.json({ limit: "512kb" }));
app.use(express.urlencoded({ extended: false }));

// Trust reverse proxy when hosted on Coolify.
app.set("trust proxy", 1);

app.get("/api/health", async (_req, res) => {
  try {
    await Promise.all([primaryQuery("SELECT 1"), query("SELECT 1")]);
    return res.status(200).json({
      status: "ok",
      service: "batch-solaeyn-builder",
      uptimeSeconds: Math.floor(process.uptime()),
      now: new Date().toISOString()
    });
  } catch {
    return res.status(503).json({ success: false, status: "degraded", message: "Database unreachable" });
  }
});

app.get("/api/me", authRequired, async (req, res) => {
  try {
    const result = await primaryQuery("SELECT username, role, email, email_verified FROM users WHERE id = $1", [req.sessionUser.userId]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    return res.status(200).json({
      success: true,
      user: {
        username: user.username,
        role: user.role,
        email: user.email || null,
        emailVerified: Boolean(user.email_verified)
      }
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to load user." });
  }
});

app.get("/api/blocks/catalog", authRequired, (_req, res) => {
  return res.status(200).json({ success: true, blocks: BATCH_BLOCK_DEFINITIONS });
});

app.get("/api/commands/catalog", authRequired, (_req, res) => {
  return res.status(200).json({ success: true, commands: WINDOWS_COMMANDS });
});

app.get("/api/dashboard/overview", authRequired, scriptReadRateLimit, async (req, res) => {
  try {
    const result = await query(
      `
        SELECT
          COUNT(*)::int AS "totalScripts",
          COALESCE(SUM(jsonb_array_length(blocks)), 0)::int AS "totalBlocks",
          MAX(updated_at) AS "lastUpdatedAt"
        FROM batch_scripts
        WHERE user_id = $1
      `,
      [req.sessionUser.userId]
    );

    const recent = await query(
      `
        SELECT ${SCRIPT_SUMMARY_COLUMNS}
        FROM batch_scripts
        WHERE user_id = $1
        ORDER BY updated_at DESC
        LIMIT 5
      `,
      [req.sessionUser.userId]
    );

    const stats = result.rows[0] || { totalScripts: 0, totalBlocks: 0, lastUpdatedAt: null };

    return res.status(200).json({
      success: true,
      overview: {
        totalScripts: Number(stats.totalScripts || 0),
        totalBlocks: Number(stats.totalBlocks || 0),
        lastUpdatedAt: stats.lastUpdatedAt || null,
        maxScripts: MAX_SCRIPTS_PER_USER
      },
      recent: recent.rows.map(serializeScriptSummary)
    });
  } catch (error) {
    logScriptOperationError("overview", error, { userId: req.sessionUser?.userId || null });
    return res.status(500).json({ success: false, message: "Failed to load overview." });
  }
});

app.get("/api/scripts", authRequired, scriptReadRateLimit, async (req, res) => {
  try {
    const result = await query(
      `
        SELECT ${SCRIPT_SUMMARY_COLUMNS}
        FROM batch_scripts
        WHERE user_id = $1
        ORDER BY updated_at DESC
      `,
      [req.sessionUser.userId]
    );

    return res.status(200).json({
      success: true,
      scripts: result.rows.map(serializeScriptSummary)
    });
  } catch (error) {
    logScriptOperationError("list", error, { userId: req.sessionUser?.userId || null });
    return res.status(500).json({ success: false, message: "Failed to load scripts." });
  }
});

app.post("/api/scripts", authRequired, requireCsrfToken, scriptCreateRateLimit, async (req, res) => {
  const name = normalizeName(req.body?.name);
  if (name.length < 2) {
    return res.status(400).json({ success: false, message: "Script name must be at least 2 characters." });
  }

  const description = normalizeDescription(req.body?.description);
  const settings = normalizeSettings(req.body?.settings);
  const blocks = normalizeBlocks(req.body?.blocks);

  try {
    const countResult = await query(
      "SELECT COUNT(*)::int AS total FROM batch_scripts WHERE user_id = $1",
      [req.sessionUser.userId]
    );
    if (Number(countResult.rows[0]?.total || 0) >= MAX_SCRIPTS_PER_USER) {
      return res.status(409).json({
        success: false,
        message: `You have reached the limit of ${MAX_SCRIPTS_PER_USER} scripts.`
      });
    }

    const result = await query(
      `
        INSERT INTO batch_scripts (user_id, name, description, settings, blocks)
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
        RETURNING ${SCRIPT_SELECT_COLUMNS}
      `,
      [req.sessionUser.userId, name, description, JSON.stringify(settings), JSON.stringify(blocks)]
    );

    return res.status(201).json({ success: true, script: serializeScript(result.rows[0]) });
  } catch (error) {
    logScriptOperationError("create", error, { userId: req.sessionUser?.userId || null });
    return res.status(500).json({ success: false, message: "Failed to create script." });
  }
});

app.get("/api/scripts/:id", authRequired, scriptReadRateLimit, async (req, res) => {
  const scriptId = toScriptId(req.params.id);
  if (!scriptId) {
    return res.status(400).json({ success: false, message: "Invalid script id." });
  }

  try {
    const result = await query(
      `SELECT ${SCRIPT_SELECT_COLUMNS} FROM batch_scripts WHERE id = $1 AND user_id = $2`,
      [scriptId, req.sessionUser.userId]
    );
    const script = result.rows[0];
    if (!script) {
      return res.status(404).json({ success: false, message: "Script not found." });
    }

    return res.status(200).json({ success: true, script: serializeScript(script) });
  } catch (error) {
    logScriptOperationError("read", error, { userId: req.sessionUser?.userId || null, scriptId });
    return res.status(500).json({ success: false, message: "Failed to load script." });
  }
});

app.patch("/api/scripts/:id", authRequired, requireCsrfToken, scriptMutationRateLimit, async (req, res) => {
  const scriptId = toScriptId(req.params.id);
  if (!scriptId) {
    return res.status(400).json({ success: false, message: "Invalid script id." });
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  if (req.body?.name !== undefined) {
    const name = normalizeName(req.body.name);
    if (name.length < 2) {
      return res.status(400).json({ success: false, message: "Script name must be at least 2 characters." });
    }
    updates.push(`name = $${index++}`);
    values.push(name);
  }

  if (req.body?.description !== undefined) {
    updates.push(`description = $${index++}`);
    values.push(normalizeDescription(req.body.description));
  }

  if (req.body?.settings !== undefined) {
    updates.push(`settings = $${index++}::jsonb`);
    values.push(JSON.stringify(normalizeSettings(req.body.settings)));
  }

  if (req.body?.blocks !== undefined) {
    updates.push(`blocks = $${index++}::jsonb`);
    values.push(JSON.stringify(normalizeBlocks(req.body.blocks)));
  }

  if (!updates.length) {
    return res.status(400).json({ success: false, message: "No fields to update." });
  }

  updates.push("updated_at = NOW()");
  values.push(scriptId, req.sessionUser.userId);

  try {
    const result = await query(
      `
        UPDATE batch_scripts
        SET ${updates.join(", ")}
        WHERE id = $${index++} AND user_id = $${index++}
        RETURNING ${SCRIPT_SELECT_COLUMNS}
      `,
      values
    );
    const script = result.rows[0];
    if (!script) {
      return res.status(404).json({ success: false, message: "Script not found." });
    }

    return res.status(200).json({ success: true, script: serializeScript(script) });
  } catch (error) {
    logScriptOperationError("update", error, { userId: req.sessionUser?.userId || null, scriptId });
    return res.status(500).json({ success: false, message: "Failed to update script." });
  }
});

app.delete("/api/scripts/:id", authRequired, requireCsrfToken, scriptMutationRateLimit, async (req, res) => {
  const scriptId = toScriptId(req.params.id);
  if (!scriptId) {
    return res.status(400).json({ success: false, message: "Invalid script id." });
  }

  try {
    const result = await query(
      "DELETE FROM batch_scripts WHERE id = $1 AND user_id = $2 RETURNING id",
      [scriptId, req.sessionUser.userId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: "Script not found." });
    }

    return res.status(200).json({ success: true, message: "Script deleted." });
  } catch (error) {
    logScriptOperationError("delete", error, { userId: req.sessionUser?.userId || null, scriptId });
    return res.status(500).json({ success: false, message: "Failed to delete script." });
  }
});

// Authoritative .bat generation for an ad-hoc draft (unsaved builder state).
app.post("/api/generate", authRequired, requireCsrfToken, scriptReadRateLimit, (req, res) => {
  try {
    const name = normalizeName(req.body?.name) || "script";
    const settings = normalizeSettings(req.body?.settings);
    const blocks = normalizeBlocks(req.body?.blocks);
    const script = generateBatchScript({ settings, blocks });

    return res.status(200).json({
      success: true,
      script,
      fileName: toBatchFileName(name)
    });
  } catch (error) {
    logScriptOperationError("generate", error, { userId: req.sessionUser?.userId || null });
    return res.status(500).json({ success: false, message: "Failed to generate script." });
  }
});

// Authoritative .bat download for a saved script.
app.get("/api/scripts/:id/download", authRequired, scriptReadRateLimit, async (req, res) => {
  const scriptId = toScriptId(req.params.id);
  if (!scriptId) {
    return res.status(400).json({ success: false, message: "Invalid script id." });
  }

  try {
    const result = await query(
      `SELECT ${SCRIPT_SELECT_COLUMNS} FROM batch_scripts WHERE id = $1 AND user_id = $2`,
      [scriptId, req.sessionUser.userId]
    );
    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ success: false, message: "Script not found." });
    }

    const script = serializeScript(row);
    const contents = generateBatchScript({ settings: script.settings, blocks: script.blocks });
    const fileName = toBatchFileName(script.name);

    applyNoStoreHeaders(res);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(contents);
  } catch (error) {
    logScriptOperationError("download", error, { userId: req.sessionUser?.userId || null, scriptId });
    return res.status(500).json({ success: false, message: "Failed to download script." });
  }
});

app.post("/api/logout", authRequired, async (req, res) => {
  await Promise.all([
    destroySession(req.sessionUser.sid).catch(() => {})
  ]);
  appendSetCookie(res, buildClearedSessionCookie(req));
  appendSetCookie(res, buildClearedCsrfCookie(req));
  return res.status(200).json({ success: true, message: "Signed out." });
});

app.use(express.static(path.join(__dirname, "..", "public"), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      applyNoStoreHeaders(res);
      return;
    }

    if (filePath.endsWith(".js") || filePath.endsWith(".css")) {
      applyNoStoreHeaders(res);
    }
  }
}));

app.get("/", pageAuthRequired, (_req, res) => {
  return res.redirect("/home");
});

const sendDashboardPage = (section: "overview" | "scripts" | "builder") =>
  (_req: express.Request, res: express.Response) => {
    res.vary("Cookie");
    applyNoStoreHeaders(res);
    return res.status(200).type("html").send(renderDashboardPage(section, String(res.locals.cspNonce || "")));
  };

app.get("/home", pageAuthRequired, sendDashboardPage("overview"));
app.get("/home/scripts", pageAuthRequired, sendDashboardPage("scripts"));
app.get("/home/builder", pageAuthRequired, sendDashboardPage("builder"));

app.get("/login", (_req, res) => {
  const target = getAuthRedirectUrl(_req);
  console.warn(
    "[auth] /login redirect -> %s | host=%s cookieNames=%s",
    target,
    getRequestHost(_req),
    Object.keys(parseCookieValues(String(_req.headers.cookie || ""))).join(",") || "<none>"
  );
  return res.redirect(target);
});

app.use("/api", (_req, res) => {
  return res.status(404).json({ success: false, message: "API route not found." });
});

app.get("*", (_req, res) => {
  return res.status(404).sendFile(path.join(__dirname, "..", "public", "404.html"));
});

export async function startServer() {
  await connectRedis();
  await runMigrations();

  const server = app.listen(PORT, () => {
    console.log(`Batch builder listening on http://localhost:${PORT}`);
  });

  return server;
}

export async function shutdown() {
  await closeRedis();
  await closeDb();
}

if (!isTest) {
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
  });

  process.on("unhandledRejection", (err) => {
    console.error("Unhandled rejection:", err);
  });

  startServer().catch((err) => {
    console.error("Failed to start batch builder:", err);
    process.exit(1);
  });
}
