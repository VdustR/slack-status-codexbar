import type {
  ClaudeCredentials,
  Runtime,
  StoredQuotaSnapshot,
  QuotaSnapshot,
} from "./types.js";
import { USAGE_URL } from "./constants.js";
import {
  loadClaudeCredentials,
  tokenNeedsRefresh,
  refreshClaudeToken,
} from "./claude-auth.js";

const FIVE_HOUR_MS = 5 * 3600_000;
const SEVEN_DAY_MS = 7 * 24 * 3600_000;

export async function probeClaudeUsage(
  runtime: Runtime,
): Promise<StoredQuotaSnapshot> {
  const credentials = await loadClaudeCredentials(runtime);
  if (!credentials) {
    const error = new Error("Claude credentials not found") as Error & {
      code: string;
    };
    error.code = "claude_credentials_missing";
    throw error;
  }

  let working = credentials;
  if (tokenNeedsRefresh(working, runtime.now()) && working.oauth.refreshToken) {
    working = await refreshClaudeToken(runtime, working);
  }

  const payload = await fetchUsage(runtime, working);
  return normalizeUsageResponse(payload, runtime.now());
}

async function fetchUsage(
  runtime: Runtime,
  credentials: ClaudeCredentials,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credentials.oauth.accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "anthropic-beta": "oauth-2025-04-20",
    "User-Agent": "slack-status-codexbar",
  };

  let response = await runtime.fetchImpl(USAGE_URL, {
    method: "GET",
    headers,
  });

  if (
    (response.status === 401 || response.status === 403) &&
    credentials.oauth.refreshToken
  ) {
    const refreshed = await refreshClaudeToken(runtime, credentials);
    headers.Authorization = `Bearer ${refreshed.oauth.accessToken}`;
    response = await runtime.fetchImpl(USAGE_URL, { method: "GET", headers });
  }

  if (!response.ok) {
    const error = new Error(
      `Claude usage API failed with HTTP ${response.status}`,
    ) as Error & { code: string };
    error.code = "claude_usage_http_error";
    throw error;
  }

  return (await response.json()) as Record<string, unknown>;
}

interface WindowPayload {
  utilization?: number;
  resets_at?: string;
  expires_at?: string;
  window_end?: string;
}

export function normalizeUsageResponse(
  payload: Record<string, unknown>,
  nowMs: number,
): StoredQuotaSnapshot {
  const fiveHour = payload.five_hour as WindowPayload | undefined;
  const sevenDay = payload.seven_day as WindowPayload | undefined;

  return {
    fiveHour: normalizeWindow(fiveHour, nowMs, FIVE_HOUR_MS),
    sevenDay: normalizeWindow(sevenDay, nowMs, SEVEN_DAY_MS),
    capturedAt: new Date(nowMs).toISOString(),
  };
}

function normalizeWindow(
  window: WindowPayload | undefined,
  nowMs: number,
  fallbackDurationMs: number,
): StoredQuotaSnapshot["fiveHour"] {
  const utilization =
    typeof window?.utilization === "number" ? window.utilization : 0;
  const percentUsed = clamp(Math.round(utilization), 0, 100);
  const percentLeft = 100 - percentUsed;

  const resetAtRaw =
    window?.resets_at ?? window?.expires_at ?? window?.window_end;
  const resetAt = resetAtRaw ?? new Date(nowMs + fallbackDurationMs).toISOString();

  return { percentLeft, percentUsed, resetAt };
}

export function toQuotaSnapshot(
  stored: StoredQuotaSnapshot,
  nowMs: number,
): QuotaSnapshot {
  return {
    fiveHour: {
      ...stored.fiveHour,
      resetAt: new Date(stored.fiveHour.resetAt),
      resetIn: Math.max(
        0,
        new Date(stored.fiveHour.resetAt).getTime() - nowMs,
      ),
    },
    sevenDay: {
      ...stored.sevenDay,
      resetAt: new Date(stored.sevenDay.resetAt),
      resetIn: Math.max(
        0,
        new Date(stored.sevenDay.resetAt).getTime() - nowMs,
      ),
    },
    capturedAt: new Date(stored.capturedAt),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
