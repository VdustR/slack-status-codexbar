import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleHookEvent, createRuntime } from "./hook.js";
import { USAGE_URL } from "./constants.js";
import type { SlackProfile } from "./types.js";

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function setupTestEnv() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hook-test-"));
  const appHome = path.join(tempDir, "app");
  await fs.mkdir(appHome, { recursive: true });

  // Write a test format.mjs
  await fs.writeFile(
    path.join(appHome, "format.mjs"),
    `export function formatStatus(s) {
      const p5 = Math.round(s.fiveHour.percentLeft);
      const p7 = Math.round(s.sevenDay.percentLeft);
      return {
        statusText: \`Claude 5h:\${p5}% 7d:\${p7}%\`,
        statusEmoji: p5 < 10 ? ":red_circle:" : ":large_green_circle:",
      };
    }`,
  );

  let currentProfile: SlackProfile = {
    status_text: "In focus",
    status_emoji: ":spiral_calendar_pad:",
    status_expiration: 0,
  };

  let slackSetCount = 0;
  let tick = 1_700_000_000_000;

  const runtime = createRuntime({
    appHome,
    settingsPath: path.join(tempDir, "settings.json"),
    env: { HOME: tempDir, SLACK_STATUS_USER_TOKEN: "test-token" } as unknown as NodeJS.ProcessEnv,
    now: () => {
      tick += 1_000;
      return tick;
    },
    execFile: async (_file: string, args: string[]) => {
      // getKeychainAccount: no -w flag, returns metadata text
      if (!args.includes("-w")) {
        return { stdout: '"acct"<blob>="testuser"\n', stderr: "" };
      }
      // loadCredentialsFromKeychain: -w flag, returns JSON value
      return {
        stdout: JSON.stringify({ claudeAiOauth: { accessToken: "test-token" } }),
        stderr: "",
      };
    },
    fetchImpl: (async (url: string | URL | Request, options?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (urlStr === USAGE_URL) {
        return jsonResponse(200, {
          five_hour: { utilization: 40, resets_at: "2026-04-02T16:30:00Z" },
          seven_day: { utilization: 20, resets_at: "2026-04-05T00:00:00Z" },
        });
      }
      if (urlStr.endsWith("/users.profile.get")) {
        return jsonResponse(200, { ok: true, profile: currentProfile });
      }
      if (urlStr.endsWith("/users.profile.set")) {
        slackSetCount++;
        const body = JSON.parse(options?.body as string) as { profile: SlackProfile };
        currentProfile = { ...currentProfile, ...body.profile };
        return jsonResponse(200, { ok: true, profile: currentProfile });
      }
      throw new Error(`Unexpected: ${urlStr}`);
    }) as typeof globalThis.fetch,
  });

  return {
    tempDir,
    runtime,
    getProfile: () => currentProfile,
    setProfile: (p: SlackProfile) => { currentProfile = p; },
    getSetCount: () => slackSetCount,
  };
}

describe("hook lifecycle", () => {
  it("SessionStart sets quota status, SessionEnd restores baseline", async () => {
    const { tempDir, runtime, getProfile } = await setupTestEnv();
    try {
      await handleHookEvent(runtime, { hook_event_name: "SessionStart", session_id: "s1", cwd: "/tmp" });
      expect(getProfile().status_text).toContain("5h:60%");
      expect(getProfile().status_text).toContain("7d:80%");
      expect(getProfile().status_emoji).toBe(":large_green_circle:");

      await handleHookEvent(runtime, { hook_event_name: "SessionEnd", session_id: "s1" });
      expect(getProfile().status_text).toBe("In focus");
      expect(getProfile().status_emoji).toBe(":spiral_calendar_pad:");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not restore when ownership is lost (user changed status)", async () => {
    const { tempDir, runtime, getProfile, setProfile } = await setupTestEnv();
    try {
      await handleHookEvent(runtime, { hook_event_name: "SessionStart", session_id: "s2", cwd: "/tmp" });
      // User manually changes their status
      setProfile({ status_text: "Lunch", status_emoji: ":sandwich:", status_expiration: 0 });

      await handleHookEvent(runtime, { hook_event_name: "SessionEnd", session_id: "s2" });
      // Should NOT restore — ownership lost
      expect(getProfile().status_text).toBe("Lunch");
      expect(getProfile().status_emoji).toBe(":sandwich:");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("statusLeaseSeconds=0 sets status_expiration to 0 (no expiration)", async () => {
    const { tempDir, runtime, getProfile } = await setupTestEnv();
    try {
      await fs.writeFile(
        path.join(runtime.appHome, "config.json"),
        JSON.stringify({ version: 1, probeIntervalMs: 60000, throttleIntervalMs: 30000, statusLeaseSeconds: 0 }),
      );

      await handleHookEvent(runtime, { hook_event_name: "SessionStart", session_id: "s-lease0", cwd: "/tmp" });
      expect(getProfile().status_expiration).toBe(0);
      expect(getProfile().status_text).toContain("5h:60%");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("Stop within throttle window does not re-set identical status", async () => {
    const { tempDir, runtime, getSetCount } = await setupTestEnv();
    try {
      await handleHookEvent(runtime, { hook_event_name: "SessionStart", session_id: "s3", cwd: "/tmp" });
      const countAfterStart = getSetCount();

      // Stop event shortly after — same quota, should be throttled
      await handleHookEvent(runtime, { hook_event_name: "Stop", session_id: "s3" });
      expect(getSetCount()).toBe(countAfterStart);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
