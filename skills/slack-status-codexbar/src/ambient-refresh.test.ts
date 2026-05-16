import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRuntime, handleRefresh } from "./hook.js";
import type { SlackProfile } from "./types.js";

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("handleRefresh", () => {
  it("updates Slack from CodexBar aggregate usage without active Claude sessions", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ambient-refresh-"));
    let currentProfile: SlackProfile = {
      status_text: "",
      status_emoji: "",
      status_expiration: 0,
    };

    const runtime = createRuntime({
      appHome: path.join(tempDir, "app"),
      env: { HOME: tempDir, SLACK_STATUS_USER_TOKEN: "test-token" } as NodeJS.ProcessEnv,
      now: () => Date.parse("2026-05-16T08:36:48.083Z"),
      execFile: async (file, args) => {
        expect(file).toBe("codexbar");
        expect(args).toEqual(["usage", "--format", "json", "--json-only"]);
        return {
          stdout: JSON.stringify([
            {
              provider: "codex",
              source: "codex-cli",
              usage: {
                primary: {
                  usedPercent: 47,
                  windowMinutes: 300,
                  resetDescription: "18:34",
                },
                secondary: {
                  usedPercent: 54,
                  windowMinutes: 10080,
                  resetDescription: "May 19 08:10",
                },
                updatedAt: "2026-05-16T08:36:49Z",
              },
            },
            {
              provider: "claude",
              source: "claude",
              usage: {
                primary: {
                  usedPercent: 22,
                  windowMinutes: 300,
                  resetDescription: "13:00",
                },
                secondary: {
                  usedPercent: 8,
                  windowMinutes: 10080,
                  resetDescription: "May 20 09:00",
                },
                updatedAt: "2026-05-16T08:37:12Z",
              },
            },
          ]),
          stderr: "",
        };
      },
      fetchImpl: (async (url: string | URL | Request, options?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        if (urlStr.endsWith("/users.profile.set")) {
          const body = JSON.parse(options?.body as string) as { profile: SlackProfile };
          currentProfile = { ...currentProfile, ...body.profile };
          return jsonResponse(200, { ok: true, profile: currentProfile });
        }
        throw new Error(`Unexpected: ${urlStr}`);
      }) as typeof globalThis.fetch,
    });

    try {
      await handleRefresh(runtime);

      expect(currentProfile.status_text).toBe(
        "Codex 53%@18:34/46%@5/19 08:10 · Claude 78%@13:00/92%@5/20 09:00",
      );
      expect(currentProfile.status_emoji).toBe(":battery:");
      expect(currentProfile.status_expiration).toBe(0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("dry-run renders a profile without writing runtime state", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ambient-dry-run-"));
    const runtime = createRuntime({
      appHome: path.join(tempDir, "app"),
      env: { HOME: tempDir } as NodeJS.ProcessEnv,
      now: () => Date.parse("2026-05-16T08:36:48.083Z"),
      execFile: async () => ({
        stdout: JSON.stringify([
          {
            provider: "codex",
            source: "codex-cli",
            usage: {
              primary: {
                usedPercent: 47,
                windowMinutes: 300,
                resetDescription: "18:34",
              },
              secondary: {
                usedPercent: 54,
                windowMinutes: 10080,
                resetDescription: "May 19 08:10",
              },
              updatedAt: "2026-05-16T08:36:49Z",
            },
          },
        ]),
        stderr: "",
      }),
    });

    try {
      const profile = await handleRefresh(runtime, { dryRun: true });

      expect(profile?.status_text).toBe("Codex 53%@18:34/46%@5/19 08:10");
      expect(profile?.status_expiration).toBe(0);
      await expect(fs.access(runtime.statePath)).rejects.toThrow();
      await expect(fs.access(runtime.logPath)).rejects.toThrow();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not write a Slack status when CodexBar has no usable data", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ambient-empty-"));
    let slackSetCount = 0;
    let currentProfile: SlackProfile = {
      status_text: "In focus",
      status_emoji: ":spiral_calendar_pad:",
      status_expiration: 0,
    };

    const runtime = createRuntime({
      appHome: path.join(tempDir, "app"),
      env: { HOME: tempDir, SLACK_STATUS_USER_TOKEN: "test-token" } as NodeJS.ProcessEnv,
      now: () => Date.parse("2026-05-16T08:36:48.083Z"),
      execFile: async () => ({
        stdout: JSON.stringify([
          {
            provider: "codex",
            source: "codex-cli",
            error: {
              kind: "provider",
              code: 1,
              message: "CodexBar provider unavailable.",
            },
          },
        ]),
        stderr: "",
      }),
      fetchImpl: (async (url: string | URL | Request, options?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        if (urlStr.endsWith("/users.profile.set")) {
          slackSetCount++;
          const body = JSON.parse(options?.body as string) as { profile: SlackProfile };
          currentProfile = { ...currentProfile, ...body.profile };
          return jsonResponse(200, { ok: true, profile: currentProfile });
        }
        throw new Error(`Unexpected: ${urlStr}`);
      }) as typeof globalThis.fetch,
    });

    try {
      const profile = await handleRefresh(runtime);

      expect(profile).toBeNull();
      expect(slackSetCount).toBe(0);
      expect(currentProfile).toEqual({
        status_text: "In focus",
        status_emoji: ":spiral_calendar_pad:",
        status_expiration: 0,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("dry-run returns null when CodexBar has no usable data", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ambient-empty-dry-run-"));
    const runtime = createRuntime({
      appHome: path.join(tempDir, "app"),
      env: { HOME: tempDir } as NodeJS.ProcessEnv,
      now: () => Date.parse("2026-05-16T08:36:48.083Z"),
      execFile: async () => ({
        stdout: JSON.stringify([
          {
            provider: "codex",
            source: "codex-cli",
            error: {
              kind: "provider",
              code: 1,
              message: "CodexBar provider unavailable.",
            },
          },
        ]),
        stderr: "",
      }),
    });

    try {
      const profile = await handleRefresh(runtime, { dryRun: true });

      expect(profile).toBeNull();
      await expect(fs.access(runtime.statePath)).rejects.toThrow();
      await expect(fs.access(runtime.logPath)).rejects.toThrow();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
