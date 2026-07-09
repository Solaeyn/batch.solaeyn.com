const SENSITIVE_KEY_PATTERN = /password|passphrase|token|secret|api[_-]?key|authorization|cookie/i;

export function redactSensitiveText(value: unknown) {
  let text = String(value || "");
  text = text.replace(/[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{20,}/g, "[REDACTED_TOKEN]");
  text = text.replace(/\b(Bearer\s+)[A-Za-z0-9._\-+/=]+/gi, "$1[REDACTED]");
  text = text.replace(/(["']?(?:password|passphrase|token|secret|api[_-]?key|authorization|cookie)["']?\s*[:=]\s*)([^\s,;"'}]+)/gi, "$1[REDACTED]");
  return text;
}

export function redactMetadataValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSensitiveText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((entry) => redactMetadataValue(entry));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : redactMetadataValue(nestedValue);
    }
    return out;
  }

  return redactSensitiveText(String(value));
}
