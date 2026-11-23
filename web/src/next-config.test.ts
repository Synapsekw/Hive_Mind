import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("next.config: no page of the site may be framed", () => {
  it("adds both headers to every route", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ]);
  });

  it("has no rule that narrows or undoes them", async () => {
    const rules = await nextConfig.headers!();
    for (const rule of rules) {
      expect(rule).not.toHaveProperty("has");
      expect(rule).not.toHaveProperty("missing");
    }
    const keys = rules.flatMap((r) =>
      r.headers.map((h) => h.key.toLowerCase()),
    );
    expect(keys.filter((k) => k === "content-security-policy")).toHaveLength(1);
    expect(keys.filter((k) => k === "x-frame-options")).toHaveLength(1);
  });
});
