import { describe, it, expect } from "vitest";
import {
  normalizeSlackProfile,
  profilesEqual,
  profilesMatchStatus,
  shouldThrottleSlackWrite,
  isHardSlackError,
  getSlackToken,
} from "./slack.js";
import type { SlackProfile } from "./types.js";
import { createDefaultState } from "./state.js";

describe("normalizeSlackProfile", () => {
  it("fills missing fields with defaults", () => {
    const profile = normalizeSlackProfile({});
    expect(profile).toEqual({ status_text: "", status_emoji: "", status_expiration: 0 });
  });

  it("preserves existing values", () => {
    const profile = normalizeSlackProfile({ status_text: "hi", status_emoji: ":wave:", status_expiration: 100 });
    expect(profile.status_text).toBe("hi");
    expect(profile.status_expiration).toBe(100);
  });
});

describe("profilesEqual", () => {
  const a: SlackProfile = { status_text: "hi", status_emoji: ":wave:", status_expiration: 100 };

  it("returns true for identical profiles", () => {
    expect(profilesEqual(a, { ...a })).toBe(true);
  });

  it("returns false when text differs", () => {
    expect(profilesEqual(a, { ...a, status_text: "bye" })).toBe(false);
  });

  it("returns false when expiration differs", () => {
    expect(profilesEqual(a, { ...a, status_expiration: 999 })).toBe(false);
  });
});

describe("profilesMatchStatus", () => {
  it("matches text and emoji, ignores expiration", () => {
    const a: SlackProfile = { status_text: "hi", status_emoji: ":wave:", status_expiration: 100 };
    const b: SlackProfile = { status_text: "hi", status_emoji: ":wave:", status_expiration: 999 };
    expect(profilesMatchStatus(a, b)).toBe(true);
  });

  it("returns false when emoji differs", () => {
    const a: SlackProfile = { status_text: "hi", status_emoji: ":wave:", status_expiration: 100 };
    const b: SlackProfile = { status_text: "hi", status_emoji: ":fire:", status_expiration: 100 };
    expect(profilesMatchStatus(a, b)).toBe(false);
  });
});

describe("shouldThrottleSlackWrite", () => {
  it("does not throttle first write", () => {
    const state = createDefaultState();
    const profile: SlackProfile = { status_text: "x", status_emoji: ":y:", status_expiration: 0 };
    expect(shouldThrottleSlackWrite(state, profile, Date.now(), 30_000)).toBe(false);
  });

  it("throttles identical profile within interval", () => {
    const now = Date.now();
    const profile: SlackProfile = { status_text: "x", status_emoji: ":y:", status_expiration: 100 };
    const state = createDefaultState();
    state.lastSlackAttempt = profile;
    state.lastSlackAttemptAt = new Date(now - 10_000).toISOString();
    expect(shouldThrottleSlackWrite(state, profile, now, 30_000)).toBe(true);
  });

  it("does not throttle when profile changed", () => {
    const now = Date.now();
    const state = createDefaultState();
    state.lastSlackAttempt = { status_text: "old", status_emoji: ":y:", status_expiration: 100 };
    state.lastSlackAttemptAt = new Date(now - 10_000).toISOString();
    const newProfile: SlackProfile = { status_text: "new", status_emoji: ":y:", status_expiration: 100 };
    expect(shouldThrottleSlackWrite(state, newProfile, now, 30_000)).toBe(false);
  });

  it("does not throttle after interval passes", () => {
    const now = Date.now();
    const profile: SlackProfile = { status_text: "x", status_emoji: ":y:", status_expiration: 100 };
    const state = createDefaultState();
    state.lastSlackAttempt = profile;
    state.lastSlackAttemptAt = new Date(now - 60_000).toISOString();
    expect(shouldThrottleSlackWrite(state, profile, now, 30_000)).toBe(false);
  });
});

describe("isHardSlackError", () => {
  it("recognizes token_revoked", () => {
    expect(isHardSlackError("token_revoked")).toBe(true);
  });

  it("recognizes missing_scope", () => {
    expect(isHardSlackError("missing_scope")).toBe(true);
  });

  it("rejects unknown errors", () => {
    expect(isHardSlackError("some_random_error")).toBe(false);
  });
});

describe("getSlackToken", () => {
  it("prefers SLACK_STATUS_USER_TOKEN", () => {
    expect(getSlackToken({ SLACK_STATUS_USER_TOKEN: "primary-token", SLACK_MCP_XOXP_TOKEN: "fallback-token" } as NodeJS.ProcessEnv)).toBe("primary-token");
  });

  it("falls back to SLACK_MCP_XOXP_TOKEN", () => {
    expect(getSlackToken({ SLACK_MCP_XOXP_TOKEN: "fallback-token" } as NodeJS.ProcessEnv)).toBe("fallback-token");
  });

  it("returns null when no token", () => {
    expect(getSlackToken({} as NodeJS.ProcessEnv)).toBeNull();
  });
});
