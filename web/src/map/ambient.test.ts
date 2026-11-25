import { describe, expect, it } from "vitest";
import {
  AMBIENT_FPS,
  IDLE_AFTER_MS,
  ambientAwake,
  mayStartPulse,
  nextFrameDelay,
} from "./ambient";

describe("ambientAwake", () => {
  const s = { lastInput: 1000, lastPulseEnd: 0 };

  it("is awake right after input and up to IDLE_AFTER_MS later", () => {
    expect(ambientAwake(s, 1000, false)).toBe(true);
    expect(ambientAwake(s, 1000 + IDLE_AFTER_MS, false)).toBe(true);
  });

  it("falls asleep once IDLE_AFTER_MS pass without input", () => {
    expect(ambientAwake(s, 1000 + IDLE_AFTER_MS + 1, false)).toBe(false);
  });

  it("wakes again on new input", () => {
    const later = 1000 + IDLE_AFTER_MS + 5000;
    expect(ambientAwake(s, later, false)).toBe(false);
    expect(ambientAwake({ ...s, lastInput: later }, later + 1, false)).toBe(
      true,
    );
  });

  it("never runs under reduced motion", () => {
    expect(ambientAwake(s, 1000, true)).toBe(false);
  });

  it("idles after 15 seconds", () => {
    expect(IDLE_AFTER_MS).toBe(15_000);
  });
});

describe("mayStartPulse", () => {
  it("waits while a pulse is still in flight (no overlap)", () => {
    const s = { lastInput: 0, lastPulseEnd: 2100 };
    expect(mayStartPulse(s, 1000, false)).toBe(false);
    expect(mayStartPulse(s, 2099, false)).toBe(false);
    expect(mayStartPulse(s, 2100, false)).toBe(true);
  });

  it("starts none while asleep or under reduced motion", () => {
    const s = { lastInput: 0, lastPulseEnd: 0 };
    expect(mayStartPulse(s, IDLE_AFTER_MS + 1, false)).toBe(false);
    expect(mayStartPulse(s, 10, true)).toBe(false);
  });
});

describe("nextFrameDelay", () => {
  it("caps ambient-only motion at 15 fps", () => {
    expect(AMBIENT_FPS).toBe(15);
    expect(
      nextFrameDelay({ moving: false, interactive: false, ambient: true }),
    ).toBe(1000 / 15);
  });

  it("runs every frame while the camera or an interaction moves", () => {
    expect(
      nextFrameDelay({ moving: true, interactive: false, ambient: true }),
    ).toBe(1000 / 60);
    expect(
      nextFrameDelay({ moving: false, interactive: true, ambient: false }),
    ).toBe(1000 / 60);
  });

  it("stops the loop when nothing runs", () => {
    expect(
      nextFrameDelay({ moving: false, interactive: false, ambient: false }),
    ).toBeNull();
  });
});
