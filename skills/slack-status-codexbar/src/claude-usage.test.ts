import { describe, it, expect } from "vitest";
import { normalizeUsageResponse, toQuotaSnapshot } from "./claude-usage.js";

describe("normalizeUsageResponse", () => {
  const nowMs = 1_700_000_000_000;

  it("extracts percentages and reset times from resets_at", () => {
    const payload = {
      five_hour: { utilization: 40, resets_at: "2026-04-02T16:30:00Z" },
      seven_day: { utilization: 20, resets_at: "2026-04-05T00:00:00Z" },
    };
    const result = normalizeUsageResponse(payload, nowMs);
    expect(result.fiveHour.percentLeft).toBe(60);
    expect(result.fiveHour.percentUsed).toBe(40);
    expect(result.fiveHour.resetAt).toBe("2026-04-02T16:30:00Z");
    expect(result.sevenDay.percentLeft).toBe(80);
    expect(result.sevenDay.percentUsed).toBe(20);
    expect(result.sevenDay.resetAt).toBe("2026-04-05T00:00:00Z");
  });

  it("uses expires_at as fallback for reset time", () => {
    const payload = {
      five_hour: { utilization: 30, expires_at: "2026-04-02T18:00:00Z" },
      seven_day: { utilization: 10, expires_at: "2026-04-06T00:00:00Z" },
    };
    const result = normalizeUsageResponse(payload, nowMs);
    expect(result.fiveHour.resetAt).toBe("2026-04-02T18:00:00Z");
    expect(result.sevenDay.resetAt).toBe("2026-04-06T00:00:00Z");
  });

  it("computes fallback reset time from window duration when no time field", () => {
    const payload = {
      five_hour: { utilization: 50 },
      seven_day: { utilization: 10 },
    };
    const result = normalizeUsageResponse(payload, nowMs);
    expect(result.fiveHour.percentLeft).toBe(50);
    // fallback: nowMs + 5h
    const expected5h = new Date(nowMs + 5 * 3600_000).toISOString();
    expect(result.fiveHour.resetAt).toBe(expected5h);
    // fallback: nowMs + 7d
    const expected7d = new Date(nowMs + 7 * 24 * 3600_000).toISOString();
    expect(result.sevenDay.resetAt).toBe(expected7d);
  });

  it("clamps percentages to 0-100", () => {
    const payload = {
      five_hour: { utilization: 110, resets_at: "2026-04-02T16:30:00Z" },
      seven_day: { utilization: -5, resets_at: "2026-04-05T00:00:00Z" },
    };
    const result = normalizeUsageResponse(payload, nowMs);
    expect(result.fiveHour.percentLeft).toBe(0);
    expect(result.fiveHour.percentUsed).toBe(100);
    expect(result.sevenDay.percentLeft).toBe(100);
    expect(result.sevenDay.percentUsed).toBe(0);
  });

  it("handles missing utilization", () => {
    const payload = {
      five_hour: { resets_at: "2026-04-02T16:30:00Z" },
      seven_day: {},
    };
    const result = normalizeUsageResponse(payload, nowMs);
    expect(result.fiveHour.percentLeft).toBe(100);
    expect(result.fiveHour.percentUsed).toBe(0);
  });
});

describe("toQuotaSnapshot", () => {
  it("converts stored snapshot to live snapshot with resetIn", () => {
    const nowMs = 1_700_000_000_000;
    const resetAt5h = new Date(nowMs + 2 * 3600_000).toISOString();
    const resetAt7d = new Date(nowMs + 48 * 3600_000).toISOString();
    const stored = {
      fiveHour: { percentLeft: 60, percentUsed: 40, resetAt: resetAt5h },
      sevenDay: { percentLeft: 80, percentUsed: 20, resetAt: resetAt7d },
      capturedAt: new Date(nowMs).toISOString(),
    };
    const snapshot = toQuotaSnapshot(stored, nowMs);
    expect(snapshot.fiveHour.resetIn).toBe(2 * 3600_000);
    expect(snapshot.sevenDay.resetIn).toBe(48 * 3600_000);
    expect(snapshot.fiveHour.resetAt).toBeInstanceOf(Date);
    expect(snapshot.capturedAt).toBeInstanceOf(Date);
  });

  it("clamps resetIn to 0 when reset time is in the past", () => {
    const nowMs = 1_700_000_000_000;
    const stored = {
      fiveHour: {
        percentLeft: 60,
        percentUsed: 40,
        resetAt: new Date(1_000).toISOString(),
      },
      sevenDay: {
        percentLeft: 80,
        percentUsed: 20,
        resetAt: new Date(1_000).toISOString(),
      },
      capturedAt: new Date(1_000).toISOString(),
    };
    const snapshot = toQuotaSnapshot(stored, nowMs);
    expect(snapshot.fiveHour.resetIn).toBe(0);
    expect(snapshot.sevenDay.resetIn).toBe(0);
  });
});
