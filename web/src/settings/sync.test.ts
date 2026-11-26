import { describe, expect, it } from "vitest";
import { fixtureSettings } from "./fixture";
import { newestFinished } from "./runs";
import { runSummary, setupCommand } from "./text";

describe("sync text", () => {
  it("the setup command names the address, the publishable key and no secret", () => {
    expect(setupCommand("https://p.supabase.co", "sb_publishable_x")).toBe(
      'node sync/src/cli.ts setup --url https://p.supabase.co --publishable-key sb_publishable_x --folder "<your vault folder>"',
    );
  });
  it("a run's summary is counts only", () => {
    expect(
      runSummary({
        added: 3,
        changed: 1,
        moved: 0,
        deleted: 2,
        tooBig: 1,
        heldBack: 0,
        error: null,
      }),
    ).toBe("3 added · 1 changed · 2 deleted · 1 too big");
    expect(
      runSummary({
        added: 0,
        changed: 0,
        moved: 0,
        deleted: 0,
        tooBig: 0,
        heldBack: 40,
        error: null,
      }),
    ).toBe("No changes · 40 deletions held back");
  });
  it("a run that stopped says so", () => {
    expect(
      runSummary({
        added: 0,
        changed: 0,
        moved: 0,
        deleted: 0,
        tooBig: 0,
        heldBack: 0,
        error: "offline",
      }),
    ).toBe("No changes · stopped: offline");
  });
  it("the fixture has two keys and three runs, the latest with a too-big file", () => {
    const d = fixtureSettings();
    expect(d.syncKeys).toHaveLength(2);
    expect(d.syncRuns).toHaveLength(3);
    expect(d.syncRuns[0]!.tooBigPaths).toEqual(["talks/keynote.key"]);
    expect(d.syncRuns[0]!.heldBack).toBe(40);
  });
  it("the too-big list is the newest finished run's, not one still going", () => {
    const d = fixtureSettings();
    const going = {
      ...d.syncRuns[0]!,
      id: "going",
      startedAt: "2026-11-26T12:00:00.000Z",
      finishedAt: null,
      tooBigPaths: [],
    };
    expect(newestFinished([going, ...d.syncRuns])).toBe(d.syncRuns[0]);
    expect(newestFinished([going])).toBeNull();
    expect(newestFinished([])).toBeNull();
  });
});
