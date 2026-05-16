import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadState, saveState, createDefaultState, setLastError } from "./state.js";

describe("state", () => {
  let tempDir: string;
  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns default state for missing file", async () => {
    const state = await loadState("/nonexistent/state.json");
    expect(state).toEqual(createDefaultState());
    expect(state.activeSessions).toEqual({});
    expect(state.consecutiveSlackFailures).toBe(0);
  });

  it("round-trips through save and load", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "state-test-"));
    const statePath = path.join(tempDir, "state.json");
    const state = createDefaultState();
    state.teamId = "T12345";
    await saveState(statePath, state);
    const loaded = await loadState(statePath);
    expect(loaded.teamId).toBe("T12345");
  });

  it("setLastError records error info", () => {
    const state = createDefaultState();
    const error = Object.assign(new Error("test error"), { code: "test_code", details: { x: 1 } });
    setLastError(state, error, 1_700_000_000_000);
    expect(state.lastError).not.toBeNull();
    expect(state.lastError!.message).toBe("test error");
    expect(state.lastError!.code).toBe("test_code");
  });
});
