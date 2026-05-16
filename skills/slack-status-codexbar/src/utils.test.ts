import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureDir, readJson, writeJsonAtomic, fileExists, appendLogLine } from "./utils.js";

describe("ensureDir", () => {
  let tempDir: string;
  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("creates nested directories", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "utils-test-"));
    const nested = path.join(tempDir, "a", "b", "c");
    await ensureDir(nested);
    const stat = await fs.stat(nested);
    expect(stat.isDirectory()).toBe(true);
  });
});

describe("readJson", () => {
  it("returns fallback for missing file", async () => {
    const result = await readJson("/nonexistent/path.json", { x: 1 });
    expect(result).toEqual({ x: 1 });
  });

  it("throws on malformed JSON", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "utils-test-"));
    const filePath = path.join(tempDir, "bad.json");
    await fs.writeFile(filePath, "not json", "utf8");
    await expect(readJson(filePath, null)).rejects.toThrow();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});

describe("writeJsonAtomic", () => {
  let tempDir: string;
  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("writes JSON and can be read back", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "utils-test-"));
    const filePath = path.join(tempDir, "test.json");
    await writeJsonAtomic(filePath, { hello: "world" });
    const result = await readJson(filePath, null);
    expect(result).toEqual({ hello: "world" });
  });

  it("creates parent directories", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "utils-test-"));
    const filePath = path.join(tempDir, "sub", "dir", "test.json");
    await writeJsonAtomic(filePath, { nested: true });
    const result = await readJson(filePath, null);
    expect(result).toEqual({ nested: true });
  });
});

describe("fileExists", () => {
  it("returns false for missing file", async () => {
    expect(await fileExists("/nonexistent/file")).toBe(false);
  });

  it("returns true for existing file", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "utils-test-"));
    const filePath = path.join(tempDir, "exists.txt");
    await fs.writeFile(filePath, "hi", "utf8");
    expect(await fileExists(filePath)).toBe(true);
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});

describe("appendLogLine", () => {
  let tempDir: string;
  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("appends JSONL lines", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "utils-test-"));
    const logPath = path.join(tempDir, "logs", "test.jsonl");
    await appendLogLine(logPath, { a: 1 });
    await appendLogLine(logPath, { b: 2 });
    const content = await fs.readFile(logPath, "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ a: 1 });
    expect(JSON.parse(lines[1]!)).toEqual({ b: 2 });
  });
});
