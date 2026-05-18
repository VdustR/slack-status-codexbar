import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig, saveConfig, createDefaultConfig } from "./config.js";

describe("config", () => {
  let tempDir: string;
  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns defaults for missing config file", async () => {
    const config = await loadConfig("/nonexistent/config.json");
    expect(config).toEqual(createDefaultConfig());
  });

  it("createDefaultConfig has expected shape", () => {
    const config = createDefaultConfig();
    expect(config.version).toBe(2);
    expect(config.probeIntervalMs).toBe(60_000);
    expect(config.throttleIntervalMs).toBe(30_000);
    expect(config.statusLeaseSeconds).toBe(0);
    expect(config.codexbar).toEqual({
      command: "codexbar",
      timeoutMs: 45_000,
      providerSelection: "enabled",
      sourceMode: "default",
    });
    expect(config.launchd.startIntervalSeconds).toBe(300);
  });

  it("round-trips through save and load", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-test-"));
    const configPath = path.join(tempDir, "config.json");
    const config = createDefaultConfig();
    config.probeIntervalMs = 120_000;
    await saveConfig(configPath, config);
    const loaded = await loadConfig(configPath);
    expect(loaded.probeIntervalMs).toBe(120_000);
  });
});
