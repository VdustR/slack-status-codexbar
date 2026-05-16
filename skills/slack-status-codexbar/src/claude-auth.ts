import type { ClaudeCredentials, Runtime } from "./types.js";
import { writeJsonAtomic } from "./utils.js";
import {
  KEYCHAIN_SERVICE,
  KEYCHAIN_ACCOUNT_FALLBACK,
  ANTHROPIC_CLIENT_ID,
  ANTHROPIC_SCOPES,
  REFRESH_URL,
} from "./constants.js";

export async function loadClaudeCredentials(
  runtime: Runtime,
): Promise<ClaudeCredentials | null> {
  return (
    (await loadCredentialsFromFile(runtime)) ??
    (await loadCredentialsFromKeychain(runtime))
  );
}

async function loadCredentialsFromFile(
  runtime: Runtime,
): Promise<ClaudeCredentials | null> {
  const fs = await import("node:fs/promises");
  const filePath = `${runtime.homeDir}/.claude/.credentials.json`;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(raw) as Record<string, unknown>;
    const oauth = json.claudeAiOauth as Record<string, unknown> | undefined;
    if (!oauth?.accessToken) return null;

    return {
      source: "file",
      filePath,
      rawJson: json,
      oauth: {
        accessToken: String(oauth.accessToken).trim(),
        refreshToken: oauth.refreshToken
          ? String(oauth.refreshToken).trim()
          : null,
        expiresAt: oauth.expiresAt != null ? Number(oauth.expiresAt) : null,
        subscriptionType:
          oauth.subscriptionType != null
            ? String(oauth.subscriptionType)
            : null,
      },
    };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  }
}

async function loadCredentialsFromKeychain(
  runtime: Runtime,
): Promise<ClaudeCredentials | null> {
  try {
    // Get the account name from keychain metadata first
    const account = await getKeychainAccount(runtime);

    const { stdout } = await runtime.execFile("/usr/bin/security", [
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
    ]);
    const json = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const oauth = json.claudeAiOauth as Record<string, unknown> | undefined;
    if (!oauth?.accessToken) return null;

    return {
      source: "keychain",
      service: KEYCHAIN_SERVICE,
      account,
      rawJson: json,
      oauth: {
        accessToken: String(oauth.accessToken).trim(),
        refreshToken: oauth.refreshToken
          ? String(oauth.refreshToken).trim()
          : null,
        expiresAt: oauth.expiresAt != null ? Number(oauth.expiresAt) : null,
        subscriptionType:
          oauth.subscriptionType != null
            ? String(oauth.subscriptionType)
            : null,
      },
    };
  } catch {
    return null;
  }
}

async function getKeychainAccount(runtime: Runtime): Promise<string> {
  try {
    // `security find-generic-password -s <service>` (without -w) prints metadata
    // including `"acct"<blob>="<account>"`
    const { stdout } = await runtime.execFile("/usr/bin/security", [
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
    ]);
    const match = /"acct"<blob>="([^"]*)"/.exec(stdout);
    return match?.[1] ?? KEYCHAIN_ACCOUNT_FALLBACK;
  } catch {
    return KEYCHAIN_ACCOUNT_FALLBACK;
  }
}

export function tokenNeedsRefresh(
  credentials: ClaudeCredentials,
  nowMs: number,
): boolean {
  if (credentials.oauth.expiresAt == null) return false;
  return nowMs + 5 * 60 * 1000 >= credentials.oauth.expiresAt;
}

export async function persistClaudeCredentials(
  runtime: Runtime,
  credentials: ClaudeCredentials,
): Promise<void> {
  const nextRawJson = {
    ...credentials.rawJson,
    claudeAiOauth: {
      ...((credentials.rawJson.claudeAiOauth as Record<string, unknown>) ??
        {}),
      accessToken: credentials.oauth.accessToken,
      refreshToken: credentials.oauth.refreshToken ?? undefined,
      expiresAt: credentials.oauth.expiresAt ?? undefined,
      subscriptionType: credentials.oauth.subscriptionType ?? undefined,
    },
  };

  if (credentials.source === "file" && credentials.filePath) {
    await writeJsonAtomic(credentials.filePath, nextRawJson);
    return;
  }

  if (credentials.source === "keychain") {
    await runtime.execFile("/usr/bin/security", [
      "add-generic-password",
      "-U",
      "-a",
      credentials.account ?? KEYCHAIN_ACCOUNT_FALLBACK,
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
      JSON.stringify(nextRawJson),
    ]);
  }
}

export async function refreshClaudeToken(
  runtime: Runtime,
  credentials: ClaudeCredentials,
): Promise<ClaudeCredentials> {
  const response = await runtime.fetchImpl(REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: credentials.oauth.refreshToken,
      client_id: ANTHROPIC_CLIENT_ID,
      scope: ANTHROPIC_SCOPES,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok || !payload.access_token) {
    const error = new Error(
      `Claude token refresh failed: ${payload.error ?? response.status}`,
    ) as Error & {
      code: string;
      details: unknown;
    };
    error.code = String(payload.error ?? "claude_refresh_failed");
    error.details = payload;
    throw error;
  }

  const next: ClaudeCredentials = {
    ...credentials,
    oauth: {
      ...credentials.oauth,
      accessToken: String(payload.access_token),
      refreshToken: payload.refresh_token
        ? String(payload.refresh_token)
        : credentials.oauth.refreshToken,
      expiresAt: payload.expires_in
        ? runtime.now() + Number(payload.expires_in) * 1000
        : credentials.oauth.expiresAt,
    },
  };
  await persistClaudeCredentials(runtime, next);
  return next;
}
