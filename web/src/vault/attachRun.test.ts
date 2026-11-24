import { describe, expect, it, vi } from "vitest";
import type { AttachResult } from "../topics/types";
import { runAttach } from "./attachRun";

const step = (
  over: Partial<Extract<AttachResult, { ok: true }>> = {},
): AttachResult => ({
  ok: true,
  next: null,
  total: 90,
  scanned: 40,
  attached: 30,
  already: 5,
  none: 5,
  failed: 0,
  topics: 12,
  ...over,
});
const on = () => ({ progress: vi.fn(), stop: vi.fn(() => false) });

describe("runAttach", () => {
  it("walks the cursor to the end and adds the counts up", async () => {
    const attach = vi
      .fn()
      .mockResolvedValueOnce(step({ next: "b.md" }))
      .mockResolvedValueOnce(
        step({ next: null, scanned: 10, attached: 4, already: 1, none: 5 }),
      );
    const o = on();
    expect(await runAttach(attach, "w", o)).toEqual({
      tally: { attached: 34, already: 6, none: 10, failed: 0, topics: 12 },
      end: "finished",
    });
    expect(attach.mock.calls).toEqual([
      ["w", null],
      ["w", "b.md"],
    ]);
    expect(o.progress.mock.calls).toEqual([
      [40, 90],
      [50, 90],
    ]);
  });

  it("ends at once, finished, when the hive has no topics", async () => {
    const attach = vi.fn().mockResolvedValue(
      step({
        topics: 0,
        scanned: 0,
        total: 0,
        attached: 0,
        already: 0,
        none: 0,
      }),
    );
    expect(await runAttach(attach, "w", on())).toEqual({
      tally: { attached: 0, already: 0, none: 0, failed: 0, topics: 0 },
      end: "finished",
    });
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("tries a refused step again and gives up after three in a row", async () => {
    const attach = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValueOnce(step());
    expect((await runAttach(attach, "w", on())).end).toBe("finished");
    const never = vi.fn().mockResolvedValue({ ok: false });
    expect((await runAttach(never, "w", on())).end).toBe("halted");
    expect(never).toHaveBeenCalledTimes(3);
  });

  it("stops between steps when asked, and halts on a cursor that does not move", async () => {
    const attach = vi.fn().mockResolvedValue(step({ next: "b.md" }));
    const o = on();
    o.stop.mockReturnValue(true);
    expect((await runAttach(attach, "w", o)).end).toBe("stopped");
    expect(attach).toHaveBeenCalledTimes(1);
    const stuck = vi.fn().mockResolvedValue(step({ next: "b.md" }));
    expect((await runAttach(stuck, "w", on())).end).toBe("halted");
  });

  it("takes an answer that is not a step as a refusal", async () => {
    const bad = vi.fn().mockResolvedValue({ ok: true, next: 3, total: "x" });
    expect((await runAttach(bad, "w", on())).end).toBe("halted");
  });
});
