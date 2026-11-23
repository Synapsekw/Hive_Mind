import { expect, it } from "vitest";
import { agentShort } from "./agentShort";

const NOW = Date.UTC(2026, 10, 23, 14, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();

it("writes the last use in short form", () => {
  expect(agentShort(ago(10 * 60_000), NOW)).toBe("now");
  expect(agentShort(ago(5 * 3_600_000), NOW)).toBe("5h");
  expect(agentShort(ago(3 * 86_400_000), NOW)).toBe("3d");
  expect(agentShort(null, NOW)).toBe("never");
  expect(agentShort("not a date", NOW)).toBe("never");
});
