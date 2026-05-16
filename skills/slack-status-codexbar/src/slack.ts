import type { AppState, Runtime, SlackProfile } from "./types.js";
import { SLACK_API_BASE_URL } from "./constants.js";

const HARD_FAILURES = new Set([
  "not_allowed_token_type",
  "team_access_not_granted",
  "token_revoked",
  "permission_denied",
  "missing_scope",
  "invalid_auth",
  "account_inactive",
]);

export function normalizeSlackProfile(profile: Partial<SlackProfile> | null | undefined): SlackProfile {
  return {
    status_text: profile?.status_text ?? "",
    status_emoji: profile?.status_emoji ?? "",
    status_expiration: Number(profile?.status_expiration ?? 0) || 0,
  };
}

export function profilesEqual(left: SlackProfile, right: SlackProfile): boolean {
  return (
    left.status_text === right.status_text &&
    left.status_emoji === right.status_emoji &&
    left.status_expiration === right.status_expiration
  );
}

export function profilesMatchStatus(left: SlackProfile, right: SlackProfile): boolean {
  return left.status_text === right.status_text && left.status_emoji === right.status_emoji;
}

export function isHardSlackError(code: string): boolean {
  return HARD_FAILURES.has(code);
}

export function shouldThrottleSlackWrite(
  state: AppState,
  desiredProfile: SlackProfile,
  nowMs: number,
  throttleMs: number,
): boolean {
  if (!state.lastSlackAttemptAt || !state.lastSlackAttempt) return false;
  if (!profilesMatchStatus(state.lastSlackAttempt, desiredProfile)) return false;
  return nowMs - Date.parse(state.lastSlackAttemptAt) < throttleMs;
}

export function getSlackToken(env: NodeJS.ProcessEnv): string | null {
  return env.SLACK_STATUS_USER_TOKEN ?? env.SLACK_MCP_XOXP_TOKEN ?? null;
}

export async function callSlackApi(
  runtime: Runtime,
  method: string,
  body: Record<string, unknown>,
  token: string,
): Promise<Record<string, unknown>> {
  const response = await runtime.fetchImpl(`${SLACK_API_BASE_URL}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (response.status === 429) {
    const retryAfterSeconds = Number(response.headers.get("retry-after") ?? "60") || 60;
    const error = new Error(`Slack API rate limited on ${method}`) as Error & { code: string; retryAfterMs: number };
    error.code = "slack_rate_limited";
    error.retryAfterMs = retryAfterSeconds * 1000;
    throw error;
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (response.status >= 500) {
    const error = new Error(`Slack API ${method} failed with HTTP ${response.status}`) as Error & { code: string; details: unknown };
    error.code = "slack_server_error";
    error.details = payload;
    throw error;
  }

  if (!response.ok || payload.ok === false) {
    const error = new Error(`Slack API ${method} failed: ${payload.error ?? response.status}`) as Error & { code: string; details: unknown };
    error.code = String(payload.error ?? `http_${response.status}`);
    error.details = payload;
    throw error;
  }

  return payload;
}

export async function authTest(runtime: Runtime, token: string): Promise<Record<string, unknown>> {
  return callSlackApi(runtime, "auth.test", {}, token);
}

export async function getSlackProfile(runtime: Runtime, token: string): Promise<SlackProfile> {
  const payload = await callSlackApi(runtime, "users.profile.get", {}, token);
  return normalizeSlackProfile((payload.profile ?? {}) as Partial<SlackProfile>);
}

export async function setSlackProfile(
  runtime: Runtime,
  token: string,
  profile: SlackProfile,
): Promise<SlackProfile> {
  const payload = await callSlackApi(runtime, "users.profile.set", { profile }, token);
  return normalizeSlackProfile((payload.profile ?? profile) as Partial<SlackProfile>);
}
