import { describe, expect, it } from "vitest";
import { buildLaunchAgentPlist, createLaunchAgentPaths } from "./launchd.js";

describe("createLaunchAgentPaths", () => {
  it("uses agent-neutral macOS user locations", () => {
    expect(createLaunchAgentPaths("/Users/test")).toEqual({
      appHome: "/Users/test/Library/Application Support/SlackStatusCodexBar",
      logDir: "/Users/test/Library/Logs/SlackStatusCodexBar",
      launchAgentPath:
        "/Users/test/Library/LaunchAgents/dev.vdustr.slack-status-codexbar.plist",
      stdoutPath:
        "/Users/test/Library/Logs/SlackStatusCodexBar/launchd.out.log",
      stderrPath:
        "/Users/test/Library/Logs/SlackStatusCodexBar/launchd.err.log",
    });
  });
});

describe("buildLaunchAgentPlist", () => {
  it("creates a RunAtLoad StartInterval LaunchAgent for refresh", () => {
    const plist = buildLaunchAgentPlist({
      label: "dev.vdustr.slack-status-codexbar",
      programArguments: [
        "/Users/test/Library/Application Support/SlackStatusCodexBar/hook.sh",
        "refresh",
      ],
      startIntervalSeconds: 300,
      stdoutPath:
        "/Users/test/Library/Logs/SlackStatusCodexBar/launchd.out.log",
      stderrPath:
        "/Users/test/Library/Logs/SlackStatusCodexBar/launchd.err.log",
    });

    expect(plist).toContain("<key>Label</key>");
    expect(plist).toContain("<string>dev.vdustr.slack-status-codexbar</string>");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<true/>");
    expect(plist).toContain("<key>StartInterval</key>");
    expect(plist).toContain("<integer>300</integer>");
    expect(plist).toContain("<string>refresh</string>");
  });
});
