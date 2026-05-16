import { describe, it, expect } from "vitest";
import {
  installManagedHooks,
  uninstallManagedHooks,
  countManagedHooks,
  isManagedHook,
} from "./settings.js";

describe("isManagedHook", () => {
  it("recognizes hook by marker in command", () => {
    expect(isManagedHook({ type: "command", command: "/home/Library/Application Support/SlackStatusCodexBar/hook.sh" })).toBe(false);
    expect(isManagedHook({ type: "command", command: "/home/Library/Application Support/SlackStatusCodexBar/slack-status-codexbar-hook.sh" })).toBe(true);
  });

  it("rejects unrelated hooks", () => {
    expect(isManagedHook({ type: "command", command: "/other/hook.sh" })).toBe(false);
  });

  it("handles missing command", () => {
    expect(isManagedHook({ type: "command" } as any)).toBe(false);
  });
});

describe("installManagedHooks", () => {
  it("adds 4 managed hooks without removing unrelated hooks", () => {
    const initial = {
      hooks: {
        SessionStart: [{
          matcher: "",
          hooks: [{ type: "command", command: "/existing/start.sh" }],
        }],
      },
    };
    const command = "/home/user/slack-status-codexbar-hook.sh";
    const next = installManagedHooks(initial, command);

    expect(countManagedHooks(next)).toBe(4);
    expect(next.hooks!.SessionStart).toHaveLength(2);
    expect(next.hooks!.SessionStart![0]!.hooks[0]!.command).toBe("/existing/start.sh");
    expect(next.hooks!.SessionStart![1]!.hooks[0]!.command).toBe(command);
    expect(next.hooks!.Stop).toHaveLength(1);
    expect(next.hooks!.StopFailure).toHaveLength(1);
    expect(next.hooks!.SessionEnd).toHaveLength(1);
  });

  it("replaces existing managed hooks on re-install", () => {
    const command1 = "/home/slack-status-codexbar-hook-v1.sh";
    const command2 = "/home/slack-status-codexbar-hook-v2.sh";
    const initial = installManagedHooks({}, command1);
    const next = installManagedHooks(initial, command2);

    expect(countManagedHooks(next)).toBe(4);
    // Check that the old command is gone
    for (const configs of Object.values(next.hooks ?? {})) {
      for (const config of configs) {
        for (const hook of config.hooks) {
          if (isManagedHook(hook)) {
            expect(hook.command).toBe(command2);
          }
        }
      }
    }
  });
});

describe("uninstallManagedHooks", () => {
  it("removes only managed hooks, keeps others", () => {
    const command = "/home/slack-status-codexbar-hook.sh";
    const initial = installManagedHooks(
      { hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "/keep-me.sh" }] }] } },
      command,
    );
    const next = uninstallManagedHooks(initial);

    expect(countManagedHooks(next)).toBe(0);
    expect(next.hooks!.Stop).toHaveLength(1);
    expect(next.hooks!.Stop![0]!.hooks[0]!.command).toBe("/keep-me.sh");
    // Empty event keys should be removed
    expect(next.hooks!.SessionStart).toBeUndefined();
    expect(next.hooks!.StopFailure).toBeUndefined();
    expect(next.hooks!.SessionEnd).toBeUndefined();
  });

  it("removes hooks key entirely when empty", () => {
    const command = "/home/slack-status-codexbar-hook.sh";
    const initial = installManagedHooks({}, command);
    const next = uninstallManagedHooks(initial);

    expect(countManagedHooks(next)).toBe(0);
    expect(next.hooks).toBeUndefined();
  });
});
