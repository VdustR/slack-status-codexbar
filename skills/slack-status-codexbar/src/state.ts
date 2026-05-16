import type { AppState } from "./types.js";
import { readJson, writeJsonAtomic } from "./utils.js";

export function createDefaultState(): AppState {
  return {
    version: 1,
    activeSessions: {},
    lastQuotaSnapshot: null,
    lastAggregateSnapshot: null,
    lastQuotaProbeAt: null,
    lastSlackDesiredPayload: null,
    lastSlackSuccessPayload: null,
    lastSlackSuccessAt: null,
    lastSlackAttempt: null,
    lastSlackAttemptAt: null,
    savedBaselineProfile: null,
    ownershipLost: false,
    disabledReason: null,
    teamId: null,
    userId: null,
    lastError: null,
    circuitOpenUntil: null,
    consecutiveSlackFailures: 0,
  };
}

export async function loadState(statePath: string): Promise<AppState> {
  const raw = await readJson<Partial<AppState>>(statePath, {});
  return { ...createDefaultState(), ...raw };
}

export async function saveState(statePath: string, state: AppState): Promise<void> {
  await writeJsonAtomic(statePath, state);
}

export function setLastError(state: AppState, error: Error & { code?: string; details?: unknown }, now: number): void {
  state.lastError = {
    at: new Date(now).toISOString(),
    message: error.message,
    code: error.code ?? null,
    details: error.details ?? null,
  };
}
