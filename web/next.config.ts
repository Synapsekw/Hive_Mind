import type { NextConfig } from "next";

/**
 * Sent with every answer of the site: no page of it may be shown inside a frame, on any site.
 * The approval window and Settings carry buttons a hidden frame could trick a person into
 * pressing. `frame-ancestors` is the rule browsers follow today; `X-Frame-Options` says the same
 * to older ones.
 */
export const FRAME_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
];

/**
 * The Join page is opened from an emailed link whose address carries a sign-in token. Nothing
 * the page leads to, or loads, is told that address. The password page under it gets the same
 * rule: nothing it leads to is told a person was just there.
 */
export const JOIN_HEADERS = [{ key: "Referrer-Policy", value: "no-referrer" }];

/**
 * The largest request a server action takes. A folder import sends its notes in batches of at
 * most 3 MB (`BATCH_BYTES` in `src/import/plan.ts`); the default of 1 MB would refuse them.
 */
export const ACTION_BODY_LIMIT = "4mb";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: ACTION_BODY_LIMIT },
  },
  async headers() {
    // `/:path*` is every path, the root included. A path that matches both rules gets both
    // sets of headers; the second rule names no header of the first, so it undoes nothing.
    return [
      { source: "/:path*", headers: FRAME_HEADERS },
      { source: "/join", headers: JOIN_HEADERS },
      { source: "/join/password", headers: JOIN_HEADERS },
    ];
  },
};

export default nextConfig;
