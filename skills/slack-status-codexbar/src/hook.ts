import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import type {
  AppConfig,
  AppState,
  AggregateSnapshot,
  FormatResult,
  FormatStatusFn,
  HookEvent,
  QuotaSnapshot,
  Runtime,
  SlackProfile,
  StoredQuotaSnapshot,
} from "./types.js";
import { ensureDir, appendLogLine } from "./utils.js";
import { acquireLock } from "./lock.js";
import { loadConfig } from "./config.js";
import { loadState, saveState, setLastError } from "./state.js";
import { toQuotaSnapshot, probeClaudeUsage } from "./claude-usage.js";
import { buildLaunchAgentPlist, createLaunchAgentPaths } from "./launchd.js";
import {
  hasUsableAggregateData,
  probeCodexBarUsage,
  renderDefaultAggregateStatus,
} from "./codexbar.js";
import {
  getSlackToken,
  getSlackProfile,
  setSlackProfile,
  profilesEqual,
  shouldThrottleSlackWrite,
  isHardSlackError,
} from "./slack.js";

const execFileAsync = promisify(execFileCb);

export interface RuntimeOptions {
  appHome?: string;
  logDir?: string;
  settingsPath?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  execFile?: Runtime["execFile"];
  fetchImpl?: typeof globalThis.fetch;
}

export function createRuntime(options: RuntimeOptions = {}): Runtime {
  const env = options.env ?? process.env;
  const homeDir = env.HOME ?? os.homedir();
  const defaultPaths = createLaunchAgentPaths(homeDir);
  const appHome =
    options.appHome ??
    env.SLACK_STATUS_CODEXBAR_HOME ??
    defaultPaths.appHome;
  const logDir =
    options.logDir ??
    env.SLACK_STATUS_CODEXBAR_LOG_DIR ??
    (options.appHome ? path.join(appHome, "logs") : defaultPaths.logDir);
  const settingsPath =
    options.settingsPath ??
    path.join(homeDir, ".claude", "settings.json");

  return {
    env,
    homeDir,
    appHome,
    settingsPath,
    statePath: path.join(appHome, "state.json"),
    configPath: path.join(appHome, "config.json"),
    lockPath: path.join(appHome, "state.lock"),
    logDir,
    logPath: path.join(logDir, "events.jsonl"),
    formatPath: path.join(appHome, "format.mjs"),
    launchAgentPath: defaultPaths.launchAgentPath,
    stdoutLogPath: path.join(logDir, "launchd.out.log"),
    stderrLogPath: path.join(logDir, "launchd.err.log"),
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    execFile:
      options.execFile ??
      (async (file: string, args: string[]) => {
        const result = await execFileAsync(file, args);
        return { stdout: result.stdout, stderr: result.stderr };
      }),
    now: options.now ?? (() => Date.now()),
  };
}

async function loadFormatFn(formatPath: string): Promise<FormatStatusFn> {
  const url = pathToFileURL(formatPath).href;
  const mod = (await import(url)) as { formatStatus?: FormatStatusFn };
  if (typeof mod.formatStatus !== "function") {
    throw new Error("format.mjs must export a formatStatus function");
  }
  return mod.formatStatus;
}

function computeExpiration(nowMs: number, leaseSeconds: number): number {
  return leaseSeconds > 0 ? Math.floor(nowMs / 1000) + leaseSeconds : 0;
}

function fallbackFormat(snapshot: QuotaSnapshot): FormatResult {
  const p5 = Math.round(snapshot.fiveHour.percentLeft);
  const p7 = Math.round(snapshot.sevenDay.percentLeft);
  return {
    statusText: `Claude 5h:${p5}% 7d:${p7}%`,
    statusEmoji:
      p5 <= 20 || p7 <= 14
        ? ":red_circle:"
        : p5 <= 40 || p7 <= 29
          ? ":large_yellow_circle:"
          : ":large_green_circle:",
  };
}

async function formatAggregateStatus(
  runtime: Runtime,
  snapshot: AggregateSnapshot,
): Promise<FormatResult | null> {
  if (!hasUsableAggregateData(snapshot)) return null;

  try {
    const formatFn = await loadFormatFn(runtime.formatPath);
    const result = formatFn(snapshot);
    if (
      typeof result.statusText === "string" &&
      typeof result.statusEmoji === "string"
    ) {
      return result;
    }
  } catch {
    // Fall through to the built-in aggregate formatter.
  }
  return renderDefaultAggregateStatus(snapshot);
}

export interface RefreshOptions {
  dryRun?: boolean;
}

export async function handleRefresh(
  runtime: Runtime,
  options: RefreshOptions = {},
): Promise<SlackProfile | null> {
  if (options.dryRun) {
    const config = await loadConfig(runtime.configPath);
    const aggregate = await probeCodexBarUsage(runtime, config.codexbar);
    const formatted = await formatAggregateStatus(
      runtime,
      aggregate,
    );
    if (!formatted) return null;

    return {
      status_text: formatted.statusText.slice(0, 100),
      status_emoji: formatted.statusEmoji,
      status_expiration: computeExpiration(
        runtime.now(),
        config.statusLeaseSeconds,
      ),
    };
  }

  await ensureDir(runtime.appHome);
  await ensureDir(runtime.logDir);

  const release = await acquireLock(runtime.lockPath);
  try {
    const state = await loadState(runtime.statePath);
    const config = await loadConfig(runtime.configPath);
    const now = runtime.now();
    const token = getSlackToken(runtime.env);

    await appendLogLine(runtime.logPath, {
      at: new Date(now).toISOString(),
      event: "refresh",
      source: "codexbar",
    });

    let aggregate: AggregateSnapshot | null = null;
    try {
      aggregate = await probeCodexBarUsage(runtime, config.codexbar);
    } catch (error: unknown) {
      setLastError(
        state,
        error as Error & { code?: string; details?: unknown },
        runtime.now(),
      );
    }

    const hasUsableAggregate = aggregate
      ? hasUsableAggregateData(aggregate)
      : false;

    if (aggregate && hasUsableAggregate) {
      state.lastAggregateSnapshot = aggregate;
      state.lastQuotaProbeAt = aggregate.capturedAt;
    }

    if (!aggregate || !hasUsableAggregate) {
      await saveState(runtime.statePath, state);
      return null;
    }

    const formatted = await formatAggregateStatus(
      runtime,
      aggregate,
    );
    if (!formatted) {
      await saveState(runtime.statePath, state);
      return null;
    }

    const desiredProfile: SlackProfile = {
      status_text: formatted.statusText.slice(0, 100),
      status_emoji: formatted.statusEmoji,
      status_expiration: computeExpiration(now, config.statusLeaseSeconds),
    };

    if (!options.dryRun) {
      await writeSlackProfile(runtime, state, config, token, desiredProfile);
    }

    await saveState(runtime.statePath, state);
    return desiredProfile;
  } finally {
    await release();
  }
}

export async function handleHookEvent(
  runtime: Runtime,
  event: HookEvent,
): Promise<void> {
  await ensureDir(runtime.appHome);
  await ensureDir(runtime.logDir);

  const release = await acquireLock(runtime.lockPath);
  try {
    const state = await loadState(runtime.statePath);
    const config = await loadConfig(runtime.configPath);
    const now = runtime.now();
    const token = getSlackToken(runtime.env);

    await appendLogLine(runtime.logPath, {
      at: new Date(now).toISOString(),
      event: event.hook_event_name,
      session_id: event.session_id,
    });

    if (event.hook_event_name === "SessionStart") {
      state.activeSessions[event.session_id] = {
        cwd: event.cwd ?? "",
        startedAt: new Date(now).toISOString(),
        lastEventAt: new Date(now).toISOString(),
      };
      await updateSlackForSession(runtime, state, config, token, true);
    } else if (event.hook_event_name === "Stop") {
      const session = state.activeSessions[event.session_id];
      if (session) {
        session.lastEventAt = new Date(now).toISOString();
      }
      const shouldProbe =
        !state.lastQuotaProbeAt ||
        now - Date.parse(state.lastQuotaProbeAt) >= config.probeIntervalMs;
      await updateSlackForSession(
        runtime,
        state,
        config,
        token,
        shouldProbe,
      );
    } else if (event.hook_event_name === "StopFailure") {
      if (event.error === "rate_limit" && state.activeSessions[event.session_id]) {
        await ensureBaseline(runtime, state, token);
        const rlProfile: SlackProfile = {
          status_text: "Claude rate-limited",
          status_emoji: ":no_entry:",
          status_expiration: computeExpiration(now, config.statusLeaseSeconds),
        };
        await writeSlackProfile(runtime, state, config, token, rlProfile);
      }
    } else if (event.hook_event_name === "SessionEnd") {
      delete state.activeSessions[event.session_id];
      if (Object.keys(state.activeSessions).length === 0) {
        await restoreBaseline(runtime, state, token);
      }
    }

    await saveState(runtime.statePath, state);
  } catch (error: unknown) {
    const state = await loadState(runtime.statePath);
    setLastError(
      state,
      error as Error & { code?: string; details?: unknown },
      runtime.now(),
    );
    await saveState(runtime.statePath, state);
    await appendLogLine(runtime.logPath, {
      at: new Date(runtime.now()).toISOString(),
      kind: "hook_error",
      error: (error as Error).message,
    });
  } finally {
    await release();
  }
}

async function updateSlackForSession(
  runtime: Runtime,
  state: AppState,
  config: AppConfig,
  token: string | null,
  forceProbe: boolean,
): Promise<void> {
  if (
    !token ||
    state.disabledReason ||
    Object.keys(state.activeSessions).length === 0
  )
    return;

  await ensureBaseline(runtime, state, token);
  const stored = await probeQuota(runtime, state, forceProbe);
  if (!stored) return;

  const snapshot = toQuotaSnapshot(stored, runtime.now());
  let formatFn: (snapshot: QuotaSnapshot) => FormatResult;
  try {
    formatFn = await loadFormatFn(runtime.formatPath);
  } catch {
    formatFn = fallbackFormat;
  }

  const { statusText, statusEmoji } = formatFn(snapshot);
  const desiredProfile: SlackProfile = {
    status_text: statusText.slice(0, 100),
    status_emoji: statusEmoji,
    status_expiration: computeExpiration(runtime.now(), config.statusLeaseSeconds),
  };

  await writeSlackProfile(runtime, state, config, token, desiredProfile);
}

async function ensureBaseline(
  runtime: Runtime,
  state: AppState,
  token: string | null,
): Promise<void> {
  if (!token) return;
  if (Object.keys(state.activeSessions).length !== 1) return;

  const currentProfile = await getSlackProfile(runtime, token);
  if (
    state.savedBaselineProfile &&
    state.lastSlackSuccessPayload &&
    profilesEqual(currentProfile, state.lastSlackSuccessPayload)
  ) {
    return;
  }

  state.savedBaselineProfile = currentProfile;
  state.ownershipLost = false;
}

async function probeQuota(
  runtime: Runtime,
  state: AppState,
  forceProbe: boolean,
): Promise<StoredQuotaSnapshot | null> {
  if (!forceProbe && state.lastQuotaSnapshot) return state.lastQuotaSnapshot;

  try {
    const snapshot = await probeClaudeUsage(runtime);
    state.lastQuotaSnapshot = snapshot;
    state.lastQuotaProbeAt = snapshot.capturedAt;
    return snapshot;
  } catch (error: unknown) {
    setLastError(
      state,
      error as Error & { code?: string; details?: unknown },
      runtime.now(),
    );
    return state.lastQuotaSnapshot;
  }
}

async function writeSlackProfile(
  runtime: Runtime,
  state: AppState,
  config: AppConfig,
  token: string | null,
  desiredProfile: SlackProfile,
): Promise<void> {
  if (!token || state.disabledReason) return;

  const now = runtime.now();
  state.lastSlackDesiredPayload = desiredProfile;

  if (state.circuitOpenUntil && now < Date.parse(state.circuitOpenUntil))
    return;
  if (
    shouldThrottleSlackWrite(state, desiredProfile, now, config.throttleIntervalMs)
  )
    return;

  state.lastSlackAttempt = desiredProfile;
  state.lastSlackAttemptAt = new Date(now).toISOString();

  try {
    const written = await setSlackProfile(runtime, token, desiredProfile);
    state.lastSlackSuccessPayload = written;
    state.lastSlackSuccessAt = new Date(now).toISOString();
    state.lastError = null;
    state.circuitOpenUntil = null;
    state.consecutiveSlackFailures = 0;
  } catch (error: unknown) {
    const err = error as Error & {
      code?: string;
      retryAfterMs?: number;
    };
    state.consecutiveSlackFailures++;
    setLastError(state, err, now);
    if (err.code && isHardSlackError(err.code)) {
      state.disabledReason = err.code;
    } else if (err.code === "slack_rate_limited") {
      state.circuitOpenUntil = new Date(
        now + (err.retryAfterMs ?? 60_000),
      ).toISOString();
    } else if (err.code === "slack_server_error") {
      state.circuitOpenUntil = new Date(
        now +
          Math.min(300_000, state.consecutiveSlackFailures * 30_000),
      ).toISOString();
    }
  }
}

async function restoreBaseline(
  runtime: Runtime,
  state: AppState,
  token: string | null,
): Promise<void> {
  if (!token || !state.savedBaselineProfile || state.ownershipLost) return;

  try {
    // If we never successfully wrote a status, just restore baseline directly
    if (state.lastSlackSuccessPayload) {
      const current = await getSlackProfile(runtime, token);
      if (!profilesEqual(current, state.lastSlackSuccessPayload)) {
        state.ownershipLost = true;
        return;
      }
    }
    await setSlackProfile(runtime, token, state.savedBaselineProfile);
    state.savedBaselineProfile = null;
    state.ownershipLost = false;
  } catch (error: unknown) {
    setLastError(
      state,
      error as Error & { code?: string; details?: unknown },
      runtime.now(),
    );
  }
}

// --- CLI entry point ---

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "hook";

  if (command === "--validate") {
    const runtime = createRuntime();
    const formatFn = await loadFormatFn(runtime.formatPath);
    const sample: QuotaSnapshot = {
      fiveHour: {
        percentLeft: 42,
        percentUsed: 58,
        resetAt: new Date(),
        resetIn: 7200000,
      },
      sevenDay: {
        percentLeft: 78,
        percentUsed: 22,
        resetAt: new Date(),
        resetIn: 172800000,
      },
      capturedAt: new Date(),
    };
    const result = formatFn(sample);
    if (
      typeof result.statusText !== "string" ||
      typeof result.statusEmoji !== "string"
    ) {
      throw new Error(
        "formatStatus must return {statusText: string, statusEmoji: string}",
      );
    }
    process.stdout.write(JSON.stringify({ ok: true, preview: result }) + "\n");
    return;
  }

  if (command === "hook") {
    const input = await readStdin();
    const event = JSON.parse(input) as HookEvent;
    if (!event.hook_event_name || !event.session_id) {
      throw new Error("Hook input missing hook_event_name or session_id");
    }
    const runtime = createRuntime();
    await handleHookEvent(runtime, event);
    return;
  }

  if (command === "refresh") {
    const runtime = createRuntime();
    const dryRun = process.argv.includes("--dry-run");
    const profile = await handleRefresh(runtime, { dryRun });
    if (dryRun) {
      process.stdout.write(JSON.stringify({ ok: Boolean(profile), profile }) + "\n");
    }
    return;
  }

  if (command === "launchd-plist") {
    const runtime = createRuntime();
    const config = await loadConfig(runtime.configPath);
    const plist = buildLaunchAgentPlist({
      label: config.launchd.label,
      programArguments: [path.join(runtime.appHome, "hook.sh"), "refresh"],
      startIntervalSeconds: config.launchd.startIntervalSeconds,
      stdoutPath: runtime.stdoutLogPath,
      stderrPath: runtime.stderrLogPath,
    });
    process.stdout.write(plist);
    return;
  }

  process.stderr.write(`Unknown command: ${command}\n`);
  process.exitCode = 1;
}

// Only run main() when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1]?.endsWith("/hook.mjs") ||
  process.argv[1]?.endsWith("/hook.js");
if (isDirectRun) {
  main().catch((error: Error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
