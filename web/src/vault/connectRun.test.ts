import { describe, expect, it, vi } from "vitest";
import type { ConnectResult } from "../import/types";
import { GIVE_UP_AFTER, runConnect } from "./connectRun";

const step = (
  next: string | null,
  over: Partial<Extract<ConnectResult, { ok: true }>> = {},
): ConnectResult => ({
  ok: true,
  next,
  total: 90,
  scanned: 40,
  linked: 7,
  already: 2,
  missing: 1,
  failed: 0,
  ...over,
});

const REFUSED: ConnectResult = { ok: false };

/** A `connect` that answers from a list, one answer a call, and remembers its cursors. */
function scripted(answers: (ConnectResult | Error)[]) {
  const cursors: (string | null)[] = [];
  const connect = vi.fn(async (_ws: string, after: string | null) => {
    cursors.push(after);
    const answer = answers.shift();
    if (answer === undefined) throw new Error("called once too often");
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return { connect, cursors };
}

const quiet = () => ({ progress: vi.fn(), stop: () => false });

describe("the loop that connects wiki links", () => {
  it("gives up after three", () => {
    expect(GIVE_UP_AFTER).toBe(3);
  });

  it("walks the cursors to the end and sums the counts", async () => {
    const { connect, cursors } = scripted([
      step("a"),
      step("b", { failed: 2 }),
      step(null, { scanned: 10, linked: 1, already: 0, missing: 4 }),
    ]);
    const out = await runConnect(connect, "ws-1", quiet());
    expect(cursors).toEqual([null, "a", "b"]);
    expect(connect.mock.calls.every(([ws]) => ws === "ws-1")).toBe(true);
    expect(out).toEqual({
      tally: { linked: 15, already: 4, missing: 6, failed: 2 },
      end: "finished",
    });
  });

  it("says the notes read so far and the workspace's total after each step", async () => {
    const { connect } = scripted([
      step("a"),
      step("b"),
      step(null, { scanned: 10 }),
    ]);
    const on = quiet();
    await runConnect(connect, "ws-1", on);
    expect(on.progress.mock.calls).toEqual([
      [40, 90],
      [80, 90],
      [90, 90],
    ]);
  });

  it("stops after the step on its way", async () => {
    const { connect, cursors } = scripted([step("a"), step("b")]);
    let stop = false;
    const out = await runConnect(connect, "ws-1", {
      progress: () => {
        stop = true;
      },
      stop: () => stop,
    });
    expect(cursors).toEqual([null]);
    expect(out).toEqual({
      tally: { linked: 7, already: 2, missing: 1, failed: 0 },
      end: "stopped",
    });
  });

  it("is finished, not stopped, when Stop came during the last step", async () => {
    const { connect } = scripted([step(null)]);
    const out = await runConnect(connect, "ws-1", {
      progress: () => {},
      stop: () => true,
    });
    expect(out.end).toBe("finished");
  });

  it("tries a refused step again from the same cursor", async () => {
    const { connect, cursors } = scripted([
      step("a"),
      REFUSED,
      REFUSED,
      step(null),
    ]);
    const out = await runConnect(connect, "ws-1", quiet());
    expect(cursors).toEqual([null, "a", "a", "a"]);
    expect(out.end).toBe("finished");
    expect(out.tally.linked).toBe(14);
  });

  it("halts after three refusals in a row and keeps what was counted", async () => {
    const { connect, cursors } = scripted([
      step("a"),
      REFUSED,
      REFUSED,
      REFUSED,
    ]);
    const out = await runConnect(connect, "ws-1", quiet());
    expect(cursors).toEqual([null, "a", "a", "a"]);
    expect(out).toEqual({
      tally: { linked: 7, already: 2, missing: 1, failed: 0 },
      end: "halted",
    });
  });

  it("counts a throw as a refusal", async () => {
    const { connect, cursors } = scripted([
      new Error("offline"),
      new Error("offline"),
      new Error("offline"),
    ]);
    const out = await runConnect(connect, "ws-1", quiet());
    expect(cursors).toEqual([null, null, null]);
    expect(out).toEqual({
      tally: { linked: 0, already: 0, missing: 0, failed: 0 },
      end: "halted",
    });
  });

  it("starts the count of refusals again after a step that worked", async () => {
    const { connect } = scripted([
      REFUSED,
      REFUSED,
      step("a"),
      REFUSED,
      REFUSED,
      step(null),
    ]);
    const out = await runConnect(connect, "ws-1", quiet());
    expect(connect).toHaveBeenCalledTimes(6);
    expect(out.end).toBe("finished");
  });

  it("stops between refusals when asked", async () => {
    const { connect } = scripted([REFUSED, REFUSED]);
    const out = await runConnect(connect, "ws-1", {
      progress: () => {},
      stop: () => true,
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(out.end).toBe("stopped");
  });

  it("ends when a step read nothing, whatever cursor it names", async () => {
    const { connect } = scripted([
      step("a"),
      step("b", { scanned: 0, linked: 0, already: 0, missing: 0 }),
    ]);
    const out = await runConnect(connect, "ws-1", quiet());
    expect(connect).toHaveBeenCalledTimes(2);
    expect(out.end).toBe("finished");
  });

  it("halts when the cursor does not move", async () => {
    const { connect } = scripted([step("a"), step("a")]);
    const out = await runConnect(connect, "ws-1", quiet());
    expect(connect).toHaveBeenCalledTimes(2);
    expect(out.end).toBe("halted");
    expect(out.tally.linked).toBe(14);
  });

  it("counts an answer that is not a result as a refusal", async () => {
    const { connect } = scripted([
      undefined as never,
      { ok: true, next: null } as never,
      null as never,
    ]);
    // `undefined` in the script reads as "called once too often", which throws: also a refusal.
    const out = await runConnect(connect, "ws-1", quiet());
    expect(out).toEqual({
      tally: { linked: 0, already: 0, missing: 0, failed: 0 },
      end: "halted",
    });
  });
});
