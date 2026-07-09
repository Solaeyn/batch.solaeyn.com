import { describe, expect, it } from "vitest";
import { redactMetadataValue, redactSensitiveText } from "../src/redaction.ts";

describe("log and runtime event redaction", () => {
  it("redacts token-shaped and labeled secrets from text", () => {
    const tokenLike = "abcdefghijklmnopqrstuvwx.ABCDEF.abcdefghijklmnopqrstuvwxyz123456";
    const redacted = redactSensitiveText(
      `startup failed token=plain-secret Authorization: Bearer bearer-secret ${tokenLike}`
    );

    expect(redacted).toContain("token=[REDACTED]");
    expect(redacted).toContain("Authorization: [REDACTED]");
    expect(redacted).toContain("[REDACTED_TOKEN]");
    expect(redacted).not.toContain("plain-secret");
    expect(redacted).not.toContain("bearer-secret");
    expect(redacted).not.toContain(tokenLike);
  });

  it("redacts sensitive metadata keys recursively while preserving safe diagnostics", () => {
    const redacted = redactMetadataValue({
      operation: "create",
      token: "top-level-secret",
      nested: {
        cookie: "sid=session-secret",
        reason: "save failed password=hunter2"
      },
      attempts: 2
    });

    expect(redacted).toEqual({
      operation: "create",
      token: "[REDACTED]",
      nested: {
        cookie: "[REDACTED]",
        reason: "save failed password=[REDACTED]"
      },
      attempts: 2
    });
  });
});
