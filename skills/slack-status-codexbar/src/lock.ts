import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "./utils.js";

interface LockOptions {
  timeoutMs?: number;
  staleMs?: number;
  retryMs?: number;
}

export async function acquireLock(
  lockPath: string,
  options: LockOptions = {},
): Promise<() => Promise<void>> {
  const {
    timeoutMs = 10_000,
    staleMs = 60_000,
    retryMs = 100,
  } = options;

  await ensureDir(path.dirname(lockPath));
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      return async () => {
        try {
          await handle.close();
        } finally {
          await fs.rm(lockPath, { force: true });
        }
      };
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code !== "EEXIST") {
        throw error;
      }

      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
      } catch (statError: unknown) {
        if (statError && typeof statError === "object" && "code" in statError && statError.code === "ENOENT") {
          continue;
        }
        throw statError;
      }

      await new Promise((r) => setTimeout(r, retryMs));
    }
  }

  throw new Error(`Timed out waiting for lock: ${lockPath}`);
}
