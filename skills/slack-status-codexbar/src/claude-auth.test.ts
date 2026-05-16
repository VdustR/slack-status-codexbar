import { describe, it, expect } from "vitest";
import { tokenNeedsRefresh } from "./claude-auth.js";
import type { ClaudeCredentials } from "./types.js";

describe("tokenNeedsRefresh", () => {
  const base: ClaudeCredentials = {
    source: "file",
    filePath: "/tmp/creds.json",
    rawJson: {},
    oauth: {
      accessToken: "test",
      refreshToken: "refresh",
      expiresAt: null,
      subscriptionType: null,
    },
  };

  it("returns false when no expiresAt", () => {
    expect(tokenNeedsRefresh(base, Date.now())).toBe(false);
  });

  it("returns true when token expires within 5 minutes", () => {
    const now = Date.now();
    const creds: ClaudeCredentials = {
      ...base,
      oauth: { ...base.oauth, expiresAt: now + 2 * 60 * 1000 },
    };
    expect(tokenNeedsRefresh(creds, now)).toBe(true);
  });

  it("returns false when token expires in more than 5 minutes", () => {
    const now = Date.now();
    const creds: ClaudeCredentials = {
      ...base,
      oauth: { ...base.oauth, expiresAt: now + 10 * 60 * 1000 },
    };
    expect(tokenNeedsRefresh(creds, now)).toBe(false);
  });
});
