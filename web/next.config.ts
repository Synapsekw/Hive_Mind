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

const nextConfig: NextConfig = {
  async headers() {
    // `/:path*` is every path, the root included.
    return [{ source: "/:path*", headers: FRAME_HEADERS }];
  },
};

export default nextConfig;
