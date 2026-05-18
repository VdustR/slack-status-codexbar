import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { probeCodexBarUsage, renderDefaultAggregateStatus } from "./codexbar.js";
import type { Runtime } from "./types.js";

function runtimeWithExec(
  execFile: Runtime["execFile"],
  now = () => Date.parse("2026-05-16T08:36:48.083Z"),
): Runtime {
  return {
    env: {},
    homeDir: "/Users/test",
    appHome: "/tmp/app",
    settingsPath: "/tmp/settings.json",
    statePath: "/tmp/state.json",
    configPath: "/tmp/config.json",
    lockPath: "/tmp/state.lock",
    logDir: "/tmp/logs",
    logPath: "/tmp/logs/events.jsonl",
    formatPath: "/tmp/format.mjs",
    launchAgentPath: "/tmp/dev.vdustr.slack-status-codexbar.plist",
    stdoutLogPath: "/tmp/launchd.out.log",
    stderrLogPath: "/tmp/launchd.err.log",
    fetchImpl: globalThis.fetch,
    execFile,
    now,
  };
}

describe("probeCodexBarUsage", () => {
  it("uses CodexBar CLI even when the default widget snapshot cache exists", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codexbar-widget-"));
    const snapshotPath = path.join(
      tempDir,
      "Library",
      "Group Containers",
      "Y5PE65HELJ.com.steipete.codexbar",
      "widget-snapshot.json",
    );
    try {
      await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
      await fs.writeFile(
        snapshotPath,
        JSON.stringify({
          generatedAt: "2026-05-16T08:35:46Z",
          enabledProviders: ["codex", "claude", "gemini"],
          entries: [
            {
              provider: "claude",
              source: "widget",
              primary: {
                usedPercent: 35,
                windowMinutes: 300,
                resetDescription: "May 16 at 8:00PM",
                resetsAt: "2026-05-16T12:00:00Z",
              },
              secondary: {
                usedPercent: 10,
                windowMinutes: 10080,
                resetDescription: "May 23 at 5:00AM",
                resetsAt: "2026-05-22T21:00:01Z",
              },
              updatedAt: "2026-05-16T08:35:46Z",
            },
          ],
        }),
      );

      let cliCalled = false;
      const runtime = {
        ...runtimeWithExec(async (file, args) => {
          cliCalled = true;
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
                    resetsAt: "2026-05-16T10:34:20Z",
                  },
                  updatedAt: "2026-05-16T08:36:49Z",
                },
              },
            ]),
            stderr: "",
          };
        }),
        homeDir: tempDir,
      };
      const aggregate = await probeCodexBarUsage(runtime, {
        command: "codexbar",
        timeoutMs: 45_000,
        providerSelection: "enabled",
        sourceMode: "default",
      });

      expect(cliCalled).toBe(true);
      expect(aggregate.source.kind).toBe("codexbar-cli");
      expect(aggregate.providers[0]!.provider).toBe("codex");
      expect(aggregate.providers[0]!.windows[0]!.resetAt).toBe(
        "2026-05-16T10:34:20Z",
      );
      expect(renderDefaultAggregateStatus(aggregate)).toEqual({
        statusText: "Codex 53%@5/16 18:34",
        statusEmoji: ":battery:",
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses CodexBar defaults by omitting provider and source overrides", async () => {
    const runtime = runtimeWithExec(async (file, args) => {
      expect(file).toBe("codexbar");
      expect(args).toEqual(["usage", "--format", "json", "--json-only"]);
      return { stdout: "[]", stderr: "" };
    });

    await probeCodexBarUsage(runtime, {
      command: "codexbar",
      timeoutMs: 45_000,
      providerSelection: "enabled",
      sourceMode: "default",
    });
  });

  it("keeps partial success payloads from non-zero CodexBar exits", async () => {
    const stdout = JSON.stringify([
      {
        provider: "codex",
        source: "codex-cli",
        usage: {
          primary: {
            usedPercent: 47,
            windowMinutes: 300,
            resetsAt: "2026-05-16T10:34:20Z",
            resetDescription: "18:34",
          },
          secondary: {
            usedPercent: 54,
            windowMinutes: 10080,
            resetsAt: "2026-05-19T00:10:59Z",
          },
          tertiary: null,
          updatedAt: "2026-05-16T08:36:49Z",
          identity: {
            accountEmail: "user@example.com",
            loginMethod: "plus",
            providerID: "codex",
          },
        },
        credits: { remaining: 0, updatedAt: "2026-05-16T08:36:49Z" },
      },
      {
        provider: "claude",
        source: "cli",
        error: {
          code: 1,
          kind: "provider",
          message: "Claude usage probe timed out.",
        },
      },
    ]);
    const error = Object.assign(new Error("codexbar failed"), {
      code: 1,
      stdout,
      stderr: "diagnostic\n",
    });
    const runtime = runtimeWithExec(async () => {
      throw error;
    });

    const aggregate = await probeCodexBarUsage(runtime, {
      command: "codexbar",
      timeoutMs: 45_000,
      providerSelection: "enabled",
      sourceMode: "default",
    });

    expect(aggregate.source.exitCode).toBe(1);
    expect(aggregate.providers).toHaveLength(2);
    expect(aggregate.providers[0]!.provider).toBe("codex");
    expect(aggregate.providers[0]!.accountLabel).toBe("u***@example.com");
    expect(aggregate.providers[0]!.windows[0]!.percentLeft).toBe(53);
    expect(aggregate.providers[1]!.error?.message).toBe("Claude usage probe timed out.");
  });

  it("normalizes snake_case reset fields from provider-specific quota payloads", async () => {
    const stdout = JSON.stringify([
      {
        provider: "claude",
        source: "cli",
        usage: {
          primary: {
            usedPercent: 40,
            windowMinutes: 300,
            resets_at: "2026-05-16T10:34:20Z",
          },
          secondary: {
            usedPercent: 20,
            windowMinutes: 10080,
            reset_description: "Resets May 19, 2026 8:11 AM",
          },
        },
      },
    ]);
    const runtime = runtimeWithExec(async () => ({ stdout, stderr: "" }));

    const aggregate = await probeCodexBarUsage(runtime, {
      command: "codexbar",
      timeoutMs: 45_000,
      providerSelection: "enabled",
      sourceMode: "default",
    });

    expect(aggregate.providers[0]!.windows[0]!.resetAt).toBe(
      "2026-05-16T10:34:20Z",
    );
    expect(aggregate.providers[0]!.windows[0]!.resetIn).toBe(
      Date.parse("2026-05-16T10:34:20Z") -
        Date.parse("2026-05-16T08:36:48.083Z"),
    );
    expect(aggregate.providers[0]!.windows[1]!.resetDescription).toBe(
      "Resets May 19, 2026 8:11 AM",
    );
  });
});

describe("renderDefaultAggregateStatus", () => {
  it("renders multiple provider windows into a compact Slack status", async () => {
    const runtime = runtimeWithExec(async () => ({
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
              resetDescription: "May 19, 2026 at 08:10",
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
    }));
    const aggregate = await probeCodexBarUsage(runtime, {
      command: "codexbar",
      timeoutMs: 45_000,
      providerSelection: "enabled",
      sourceMode: "default",
    });

    expect(renderDefaultAggregateStatus(aggregate)).toEqual({
      statusText:
        "Codex 53%@18:34/46%@5/19 08:10 · Claude 78%@13:00/92%@5/20 09:00",
      statusEmoji: ":battery:",
    });
  });

  it("filters providers that only contain errors from the default status text", async () => {
    const runtime = runtimeWithExec(async () => ({
      stdout: JSON.stringify([
        {
          provider: "codex",
          source: "openai-web",
          usage: {
            primary: {
              usedPercent: 73,
              windowMinutes: 300,
              resetDescription: "Resets 6:34 PM",
            },
            secondary: {
              usedPercent: 58,
              windowMinutes: 10080,
              resetDescription: "Resets May 19, 2026 8:11 AM",
            },
          },
        },
        {
          provider: "gemini",
          source: "auto",
          error: {
            code: 1,
            kind: "provider",
            message: "Could not find Gemini CLI OAuth configuration",
          },
        },
      ]),
      stderr: "",
    }));
    const aggregate = await probeCodexBarUsage(runtime, {
      command: "codexbar",
      timeoutMs: 45_000,
      providerSelection: "enabled",
      sourceMode: "default",
    });

    expect(renderDefaultAggregateStatus(aggregate)).toEqual({
      statusText: "Codex 27%@18:34/42%@5/19 08:11",
      statusEmoji: ":low_battery:",
    });
  });

  it("keeps the original seven-day threshold above the low cutoff", async () => {
    const runtime = runtimeWithExec(async () => ({
      stdout: JSON.stringify([
        {
          provider: "codex",
          source: "openai-web",
          usage: {
            primary: {
              usedPercent: 10,
              windowMinutes: 300,
              resetDescription: "18:34",
            },
            secondary: {
              usedPercent: 70,
              windowMinutes: 10080,
              resetDescription: "May 19 08:10",
            },
          },
        },
      ]),
      stderr: "",
    }));
    const aggregate = await probeCodexBarUsage(runtime, {
      command: "codexbar",
      timeoutMs: 45_000,
      providerSelection: "enabled",
      sourceMode: "default",
    });

    expect(renderDefaultAggregateStatus(aggregate)).toEqual({
      statusText: "Codex 90%@18:34/30%@5/19 08:10",
      statusEmoji: ":battery:",
    });
  });

  it("uses the lowest remaining displayed window for emoji severity", async () => {
    const runtime = runtimeWithExec(async () => ({
      stdout: JSON.stringify([
        {
          provider: "codex",
          source: "openai-web",
          usage: {
            primary: {
              usedPercent: 10,
              windowMinutes: 300,
              resetDescription: "18:34",
            },
            secondary: {
              usedPercent: 71,
              windowMinutes: 10080,
              resetDescription: "May 19 08:10",
            },
          },
        },
      ]),
      stderr: "",
    }));
    const aggregate = await probeCodexBarUsage(runtime, {
      command: "codexbar",
      timeoutMs: 45_000,
      providerSelection: "enabled",
      sourceMode: "default",
    });

    expect(renderDefaultAggregateStatus(aggregate)).toEqual({
      statusText: "Codex 90%@18:34/29%@5/19 08:10",
      statusEmoji: ":low_battery:",
    });
  });

  it("uses the original warning threshold for seven-day quota", async () => {
    const runtime = runtimeWithExec(async () => ({
      stdout: JSON.stringify([
        {
          provider: "codex",
          source: "openai-web",
          usage: {
            primary: {
              usedPercent: 10,
              windowMinutes: 300,
              resetDescription: "18:34",
            },
            secondary: {
              usedPercent: 86,
              windowMinutes: 10080,
              resetDescription: "May 19 08:10",
            },
          },
        },
      ]),
      stderr: "",
    }));
    const aggregate = await probeCodexBarUsage(runtime, {
      command: "codexbar",
      timeoutMs: 45_000,
      providerSelection: "enabled",
      sourceMode: "default",
    });

    expect(renderDefaultAggregateStatus(aggregate)).toEqual({
      statusText: "Codex 90%@18:34/14%@5/19 08:10",
      statusEmoji: ":warning:",
    });
  });

  it("uses the original critical emoji for low short-window quota", async () => {
    const runtime = runtimeWithExec(async () => ({
      stdout: JSON.stringify([
        {
          provider: "codex",
          source: "openai-web",
          usage: {
            primary: {
              usedPercent: 85,
              windowMinutes: 300,
              resetDescription: "18:34",
            },
            secondary: {
              usedPercent: 10,
              windowMinutes: 10080,
              resetDescription: "May 19 08:10",
            },
          },
        },
      ]),
      stderr: "",
    }));
    const aggregate = await probeCodexBarUsage(runtime, {
      command: "codexbar",
      timeoutMs: 45_000,
      providerSelection: "enabled",
      sourceMode: "default",
    });

    expect(renderDefaultAggregateStatus(aggregate)).toEqual({
      statusText: "Codex 15%@18:34/90%@5/19 08:10",
      statusEmoji: ":warning:",
    });
  });

  it("compacts reset labels enough for the common three-provider status", async () => {
    const runtime = runtimeWithExec(async () => ({
      stdout: JSON.stringify([
        {
          provider: "codex",
          source: "openai-web",
          usage: {
            primary: {
              usedPercent: 75,
              windowMinutes: 300,
              resetDescription: "Resets 6:34 PM",
            },
            secondary: {
              usedPercent: 59,
              windowMinutes: 10080,
              resetDescription: "Resets May 19, 2026 8:11 AM",
            },
          },
        },
        {
          provider: "claude",
          source: "web",
          usage: {
            primary: { usedPercent: 0, windowMinutes: 300 },
            secondary: { usedPercent: 0, windowMinutes: 10080 },
          },
        },
        {
          provider: "gemini",
          source: "oauth-api",
          usage: {
            primary: {
              usedPercent: 0,
              windowMinutes: 1440,
              resetDescription: "Resets in 23h 59m",
            },
            secondary: {
              usedPercent: 0,
              windowMinutes: 1440,
              resetDescription: "Resets in 23h 59m",
            },
          },
        },
      ]),
      stderr: "",
    }));
    const aggregate = await probeCodexBarUsage(runtime, {
      command: "codexbar",
      timeoutMs: 45_000,
      providerSelection: "enabled",
      sourceMode: "default",
    });

    const result = renderDefaultAggregateStatus(aggregate);

    expect(result?.statusText).toBe(
      "Codex 25%@18:34/41%@5/19 08:11 · Claude 100%@~5h/100%@~7d · Gemini 100%@23h59/100%@23h59",
    );
    expect(result?.statusText.length).toBeLessThanOrEqual(100);
  });

  it("uses approximate reset labels when CodexBar only reports window duration", async () => {
    const runtime = runtimeWithExec(async () => ({
      stdout: JSON.stringify([
        {
          provider: "claude",
          source: "web",
          usage: {
            primary: { usedPercent: 0, windowMinutes: 300 },
            secondary: { usedPercent: 0, windowMinutes: 10080 },
          },
        },
      ]),
      stderr: "",
    }));
    const aggregate = await probeCodexBarUsage(runtime, {
      command: "codexbar",
      timeoutMs: 45_000,
      providerSelection: "enabled",
      sourceMode: "default",
    });

    expect(renderDefaultAggregateStatus(aggregate)).toEqual({
      statusText: "Claude 100%@~5h/100%@~7d",
      statusEmoji: ":battery:",
    });
  });
});
