import path from "node:path";
import { HOOK_EVENTS, HOOK_MARKER } from "./constants.js";
import { readJson, writeJsonAtomic, ensureDir } from "./utils.js";

interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
}

interface HookConfig {
  matcher: string;
  hooks: HookEntry[];
}

interface Settings {
  hooks?: Record<string, HookConfig[]>;
  [key: string]: unknown;
}

export function isManagedHook(hook: HookEntry): boolean {
  return typeof hook?.command === "string" && hook.command.includes(HOOK_MARKER);
}

function buildHookEntry(command: string): HookConfig {
  return {
    matcher: ".*",
    hooks: [{ type: "command", command, timeout: 30 }],
  };
}

export function installManagedHooks(settings: Settings, command: string): Settings {
  const next = structuredClone(settings);
  const hooks: Record<string, HookConfig[]> = { ...(next.hooks ?? {}) };

  for (const eventName of HOOK_EVENTS) {
    const existing = hooks[eventName];
    const configs = Array.isArray(existing)
      ? existing.map((c: HookConfig) => ({
          ...c,
          hooks: c.hooks.filter((h) => !isManagedHook(h)),
        }))
      : [];
    const cleaned = configs.filter((c: HookConfig) => c.hooks.length > 0);
    cleaned.push(buildHookEntry(command));
    hooks[eventName] = cleaned;
  }

  next.hooks = hooks;
  return next;
}

export function uninstallManagedHooks(settings: Settings): Settings {
  const next = structuredClone(settings);
  const hooks: Record<string, HookConfig[]> = { ...(next.hooks ?? {}) };

  for (const eventName of Object.keys(hooks)) {
    const existing = hooks[eventName];
    const configs = Array.isArray(existing) ? existing : [];
    const cleaned = configs
      .map((c: HookConfig) => ({ ...c, hooks: c.hooks.filter((h) => !isManagedHook(h)) }))
      .filter((c: HookConfig) => c.hooks.length > 0);

    if (cleaned.length > 0) {
      hooks[eventName] = cleaned;
    } else {
      delete hooks[eventName];
    }
  }

  next.hooks = Object.keys(hooks).length > 0 ? hooks : undefined;
  return next;
}

export function countManagedHooks(settings: Settings): number {
  let count = 0;
  for (const configs of Object.values(settings.hooks ?? {})) {
    if (!Array.isArray(configs)) continue;
    for (const config of configs) {
      for (const hook of config.hooks ?? []) {
        if (isManagedHook(hook)) count++;
      }
    }
  }
  return count;
}

export async function loadSettings(settingsPath: string): Promise<Settings> {
  return readJson<Settings>(settingsPath, {});
}

export async function saveSettings(settingsPath: string, settings: Settings): Promise<void> {
  await ensureDir(path.dirname(settingsPath));
  await writeJsonAtomic(settingsPath, settings);
}
