import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(fileURLToPath(new URL(".", import.meta.url)));
const SELF = fileURLToPath(import.meta.url);

// Built from parts so this file does not contain the strings it forbids.
const FORBIDDEN = [
  ["SUPABASE", "JWT", "SECRET"].join("_"),
  ["service", "role"].join("_"),
  ["..", ".env"].join("/"),
];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe("web/src holds no server-only secrets", () => {
  it("never mentions the JWT secret, the service role or a parent .env", () => {
    const hits = files(SRC)
      .filter((f) => f !== SELF)
      .flatMap((f) => {
        const text = readFileSync(f, "utf8");
        return FORBIDDEN.filter((s) => text.includes(s)).map(
          (s) => `${f}: ${s}`,
        );
      });
    expect(hits).toEqual([]);
  });
});
