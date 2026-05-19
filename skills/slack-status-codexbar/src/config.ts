import type { AppConfig } from "./types.js";
import { readJson, writeJsonAtomic } from "./utils.js";

export function createDefaultConfig(): AppConfig {
  return {
    version: 2,
    probeIntervalMs: 60_000,
    throttleIntervalMs: 30_000,
    statusLeaseSeconds: 0,
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
  return {
    ...defaults,
    ...raw,
    codexbar: { ...defaults.codexbar, ...raw.codexbar },
    launchd: { ...defaults.launchd, ...raw.launchd },
  };
}

export async function saveConfig(configPath: string, config: AppConfig): Promise<void> {
  await writeJsonAtomic(configPath, config);
}
