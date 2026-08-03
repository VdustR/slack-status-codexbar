import type { AppConfig, ExtraWindowPolicy } from "./types.js";
import { readJson, writeJsonAtomic } from "./utils.js";

export function createDefaultConfig(): AppConfig {
  return {
    version: 2,
    probeIntervalMs: 60_000,
    throttleIntervalMs: 30_000,
    statusLeaseSeconds: 0,
    formatter: {
      extraWindows: "active",
    },
    codexbar: {
      command: "codexbar",
      timeoutMs: 45_000,
      providerSelection: "enabled",
      sourceMode: "default",
      providerSourceOverrides: {
        claude: "oauth",
      },
      geminiCliPath: null,
    },
    launchd: {
      label: "dev.vdustr.slack-status-codexbar",
      startIntervalSeconds: 300,
    },
  };
}

export async function loadConfig(configPath: string): Promise<AppConfig> {
  const raw = await readJson<Partial<AppConfig>>(configPath, {});
  const defaults = createDefaultConfig();
  const extraWindows = isExtraWindowPolicy(raw.formatter?.extraWindows)
    ? raw.formatter.extraWindows
    : defaults.formatter.extraWindows;
  return {
    ...defaults,
    ...raw,
    formatter: { extraWindows },
    codexbar: { ...defaults.codexbar, ...raw.codexbar },
    launchd: { ...defaults.launchd, ...raw.launchd },
  };
}

function isExtraWindowPolicy(value: unknown): value is ExtraWindowPolicy {
  return value === "all" || value === "active" || value === "hidden";
}

export async function saveConfig(configPath: string, config: AppConfig): Promise<void> {
  await writeJsonAtomic(configPath, config);
}
