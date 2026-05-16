import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireLock } from "./lock.js";

describe("acquireLock", () => {
  let tempDir: string;
  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("acquires and releases a lock", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lock-test-"));
    const lockPath = path.join(tempDir, "test.lock");
    const release = await acquireLock(lockPath);
    expect(await fs.access(lockPath).then(() => true, () => false)).toBe(true);
    await release();
    expect(await fs.access(lockPath).then(() => true, () => false)).toBe(false);
  });

  it("blocks concurrent access and times out", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lock-test-"));
    const lockPath = path.join(tempDir, "test.lock");
    const release = await acquireLock(lockPath);
    await expect(acquireLock(lockPath, { timeoutMs: 200, retryMs: 50 }))
      .rejects.toThrow("Timed out");
    await release();
  });
});
