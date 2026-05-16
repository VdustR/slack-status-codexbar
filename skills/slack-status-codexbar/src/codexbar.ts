import type {
  AggregateRateWindow,
  AggregateSnapshot,
  CodexBarConfig,
  FormatResult,
  ProviderAggregateSnapshot,
  Runtime,
} from "./types.js";

interface RawCodexBarWindow {
  usedPercent?: unknown;
  windowMinutes?: unknown;
  resetsAt?: unknown;
  resets_at?: unknown;
  expiresAt?: unknown;
  expires_at?: unknown;
  windowEnd?: unknown;
  window_end?: unknown;
  resetDescription?: unknown;
  reset_description?: unknown;
}

interface RawCodexBarProvider {
  provider?: unknown;
  source?: unknown;
  account?: unknown;
  usage?: {
    primary?: RawCodexBarWindow | null;
    secondary?: RawCodexBarWindow | null;
    tertiary?: RawCodexBarWindow | null;
    extraRateWindows?: unknown;
    updatedAt?: unknown;
    identity?: {
      accountEmail?: unknown;
    };
    accountEmail?: unknown;
  };
  credits?: {
    remaining?: unknown;
    updatedAt?: unknown;
  } | null;
  error?: {
    kind?: unknown;
    code?: unknown;
    message?: unknown;
  } | null;
}

export async function probeCodexBarUsage(
  runtime: Runtime,
  config: CodexBarConfig,
): Promise<AggregateSnapshot> {
  const args = buildCodexBarArgs(config);
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  try {
    const result = await runtime.execFile(config.command, args);
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error: unknown) {
    const err = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    stdout = err.stdout ?? "";
    stderr = err.stderr ?? "";
    exitCode = typeof err.code === "number" ? err.code : 1;
    if (!stdout.trim()) {
      throw err;
    }
  }

  const raw = parseCodexBarJSON(stdout);
  const payloads = Array.isArray(raw) ? raw : [raw];
  const nowMs = runtime.now();

  return {
    capturedAt: new Date(nowMs).toISOString(),
    source: {
      kind: "codexbar-cli",
      command: config.command,
      providerSelection: config.providerSelection,
      sourceMode: config.sourceMode,
      exitCode,
      stderrLines: stderr.trim() ? stderr.trim().split("\n").length : 0,
    },
    providers: payloads.map((payload) =>
      normalizeProvider(payload as RawCodexBarProvider, nowMs),
    ),
  };
}

export function buildCodexBarArgs(config: CodexBarConfig): string[] {
  const args = ["usage"];
  if (config.providerSelection !== "enabled") {
    args.push("--provider", config.providerSelection);
  }
  if (config.sourceMode !== "default") {
    args.push("--source", config.sourceMode);
  }
  args.push("--format", "json", "--json-only");
  return args;
}

export function renderDefaultAggregateStatus(
  aggregate: AggregateSnapshot,
): FormatResult {
  const usableProviders = aggregate.providers.filter(
    (provider) => provider.windows.length > 0 || provider.credits,
  );

  if (usableProviders.length === 0) {
    return {
      statusText: "CodexBar unavailable",
      statusEmoji: ":large_yellow_circle:",
    };
  }

  const statusText = usableProviders
    .map((provider) => {
      const label = providerLabel(provider.provider);
      if (provider.windows.length > 0) {
        const percentages = provider.windows
          .slice(0, 2)
          .map(renderWindowStatus)
          .join("/");
        return `${label} ${percentages}`;
      }
      if (provider.credits) {
        return `${label} $${provider.credits.remaining}`;
      }
      return `${label} err`;
    })
    .join(" · ");

  return {
    statusText,
    statusEmoji: severityEmoji(worstSeverity(aggregate)),
  };
}

function renderWindowStatus(window: AggregateRateWindow): string {
  const resetLabel = compactResetLabel(window);
  if (!resetLabel) return `${window.percentLeft}%`;
  return `${window.percentLeft}%@${resetLabel}`;
}

function compactResetLabel(window: AggregateRateWindow): string | null {
  if (window.resetDescription) {
    return compactResetDescription(window.resetDescription);
  }
  if (window.resetAt) {
    return compactResetAt(window.resetAt);
  }
  if (window.windowMinutes) {
    return compactDuration(window.windowMinutes);
  }
  return null;
}

function compactResetDescription(description: string): string {
  const normalized = description
    .trim()
    .replace(/^resets\s+/i, "")
    .replace(/,\s*\d{4}(?=\s)/, "")
    .replace(/\s+/g, " ");
  return (
    compactRelativeDescription(normalized) ??
    compactAbsoluteDescription(normalized) ??
    normalized
  );
}

function compactResetAt(resetAt: string): string | null {
  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) return null;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}`;
}

function compactDuration(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const roundedMinutes = Math.round(minutes);
  const compact = compactDurationParts(roundedMinutes);
  return compact ? `~${compact}` : null;
}

function compactDurationParts(minutes: number): string | null {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return remainingMinutes > 0
      ? `${hours}h${remainingMinutes}`
      : `${hours}h`;
  }
  return `${remainingMinutes}m`;
}

function compactRelativeDescription(description: string): string | null {
  const match = description.match(/^in\s+(.+)$/i);
  if (!match) return null;
  const value = match[1]!;
  const days = value.match(/(\d+)\s*d/i)?.[1];
  const hours = value.match(/(\d+)\s*h/i)?.[1];
  const minutes = value.match(/(\d+)\s*m/i)?.[1];
  const parts = [
    days ? `${days}d` : null,
    hours ? `${hours}h` : null,
    minutes ? (days || hours ? minutes : `${minutes}m`) : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join("") : null;
}

function compactAbsoluteDescription(description: string): string | null {
  const monthTime = description.match(
    /^([a-z]+)\s+(\d{1,2})\s+(\d{1,2}):(\d{2})(?:\s*([ap]m))?$/i,
  );
  if (monthTime) {
    const month = monthNumber(monthTime[1]!);
    if (!month) return null;
    const day = Number(monthTime[2]);
    const hour = normalizeHour(monthTime[3]!, monthTime[5] ?? null);
    return `${month}/${day} ${hour}:${monthTime[4]}`;
  }

  const time = description.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if (time) {
    return `${normalizeHour(time[1]!, time[3]!)}:${time[2]}`;
  }

  return null;
}

function monthNumber(month: string): number | null {
  const months: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  return months[month.toLowerCase()] ?? null;
}

function normalizeHour(hour: string, meridiem: string | null): string {
  let value = Number(hour);
  if (meridiem) {
    const lower = meridiem.toLowerCase();
    if (lower === "pm" && value < 12) value += 12;
    if (lower === "am" && value === 12) value = 0;
  }
  return String(value).padStart(2, "0");
}

function parseCodexBarJSON(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("codexbar produced no stdout JSON");
  }

  const arrayStart = trimmed.indexOf("[");
  const objectStart = trimmed.indexOf("{");
  const jsonStart =
    arrayStart === -1
      ? objectStart
      : objectStart === -1
        ? arrayStart
        : Math.min(arrayStart, objectStart);

  if (jsonStart === -1) {
    throw new Error("codexbar stdout did not contain JSON");
  }

  return JSON.parse(trimmed.slice(jsonStart));
}

function normalizeProvider(
  payload: RawCodexBarProvider,
  nowMs: number,
): ProviderAggregateSnapshot {
  const provider = stringOr(payload.provider, "unknown");
  const windows = [
    normalizeWindow("primary", "Primary", payload.usage?.primary, nowMs),
    normalizeWindow("secondary", "Secondary", payload.usage?.secondary, nowMs),
    normalizeWindow("tertiary", "Tertiary", payload.usage?.tertiary, nowMs),
    ...normalizeExtraWindows(payload.usage?.extraRateWindows, nowMs),
  ].filter((window): window is AggregateRateWindow => Boolean(window));

  return {
    provider,
    source: stringOr(payload.source, "unknown"),
    accountLabel: redactAccount(
      stringOrNull(payload.account) ??
        stringOrNull(payload.usage?.identity?.accountEmail) ??
        stringOrNull(payload.usage?.accountEmail),
    ),
    updatedAt: stringOrNull(payload.usage?.updatedAt),
    windows,
    credits:
      typeof payload.credits?.remaining === "number"
        ? {
            remaining: payload.credits.remaining,
            updatedAt: stringOrNull(payload.credits.updatedAt),
          }
        : null,
    error:
      typeof payload.error?.message === "string"
        ? {
            kind: stringOr(payload.error.kind, "provider"),
            code:
              typeof payload.error.code === "number" ||
              typeof payload.error.code === "string"
                ? payload.error.code
                : null,
            message: payload.error.message,
          }
        : null,
  };
}

function normalizeWindow(
  id: string,
  title: string,
  raw: RawCodexBarWindow | null | undefined,
  nowMs: number,
): AggregateRateWindow | null {
  if (!raw || typeof raw.usedPercent !== "number") return null;
  const resetAt =
    stringOrNull(raw.resetsAt) ??
    stringOrNull(raw.resets_at) ??
    stringOrNull(raw.expiresAt) ??
    stringOrNull(raw.expires_at) ??
    stringOrNull(raw.windowEnd) ??
    stringOrNull(raw.window_end);
  return {
    id,
    title,
    percentUsed: clamp(Math.round(raw.usedPercent), 0, 100),
    percentLeft: clamp(Math.round(100 - raw.usedPercent), 0, 100),
    windowMinutes:
      typeof raw.windowMinutes === "number" ? raw.windowMinutes : null,
    resetAt,
    resetIn: resetAt
      ? Math.max(0, new Date(resetAt).getTime() - nowMs)
      : null,
    resetDescription:
      stringOrNull(raw.resetDescription) ??
      stringOrNull(raw.reset_description),
  };
}

function normalizeExtraWindows(
  raw: unknown,
  nowMs: number,
): Array<AggregateRateWindow | null> {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, index) => {
    const item = entry as {
      id?: unknown;
      title?: unknown;
      window?: RawCodexBarWindow | null;
    };
    return normalizeWindow(
      stringOr(item.id, `extra-${index + 1}`),
      stringOr(item.title, `Extra ${index + 1}`),
      item.window,
      nowMs,
    );
  });
}

function worstSeverity(aggregate: AggregateSnapshot): number {
  let worst = 0;
  for (const provider of aggregate.providers) {
    for (const window of provider.windows) {
      worst = Math.max(worst, windowSeverity(window));
    }
  }
  return worst;
}

function windowSeverity(window: AggregateRateWindow): number {
  const left = window.percentLeft;
  if (left < 1) return 3;
  if (left <= 20) return 2;
  if (left <= 40) return 1;
  return 0;
}

function severityEmoji(level: number): string {
  return (
    [
      ":battery:",
      ":low_battery:",
      ":warning:",
      ":no_entry:",
    ][level] ?? ":grey_question:"
  );
}

function providerLabel(id: string): string {
  const labels: Record<string, string> = {
    codex: "Codex",
    claude: "Claude",
    gemini: "Gemini",
    copilot: "Copilot",
    cursor: "Cursor",
  };
  return labels[id] ?? id;
}

function redactAccount(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/^(.).+(@.+)$/, "$1***$2");
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
