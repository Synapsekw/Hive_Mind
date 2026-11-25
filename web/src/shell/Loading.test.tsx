import { existsSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK } from "../theme/look";
import { DEFAULT_FOLD } from "./fold";
import { FoldProvider } from "./FoldProvider";
import { LOADING } from "./hiveText";
import { Loading } from "./Loading";
import { LookProvider } from "./LookProvider";
import s from "./loading.module.css";
import MapLoading from "../app/(map)/loading";
import VaultLoading from "../app/vault/loading";
import GalleryLoading from "../app/gallery/loading";
import InboxLoading from "../app/inbox/loading";
import SettingsLoading from "../app/settings/loading";

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <LookProvider initial={DEFAULT_LOOK}>
      <FoldProvider initial={DEFAULT_FOLD}>{node}</FoldProvider>
    </LookProvider>,
  );

describe("Loading", () => {
  it("draws the rail and a card that says it is loading", () => {
    const html = render(<Loading current="vault" />);
    expect(html).toContain('role="status"');
    expect(html).toContain(`aria-label="${LOADING}"`);
    // The rail is there, with the vault as the current destination.
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/vault"');
  });

  it("pulses quietly, and not at all for a person who asks for less motion", () => {
    expect(typeof s.pulse).toBe("string");
    const html = render(<Loading current="map" />);
    expect(html).toContain(s.pulse);
    const css = readFileSync(
      new URL("./loading.module.css", import.meta.url),
      "utf8",
    );
    const reduced = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(reduced).not.toBeNull();
    expect(reduced![1]).toMatch(/animation:\s*none/);
  });

  it.each([
    ["/", MapLoading, "/"],
    ["/vault", VaultLoading, "/vault"],
    ["/gallery", GalleryLoading, "/gallery"],
    ["/inbox", InboxLoading, "/inbox"],
    ["/settings", SettingsLoading, "/settings"],
  ])("is the loading screen of %s", (_route, Screen, href) => {
    const html = render(<Screen />);
    expect(html).toContain('role="status"');
    // The current destination is the route's own.
    const current = html.match(/<a[^>]*aria-current="page"[^>]*>/)?.[0] ?? "";
    expect(current).toContain(`href="${href}"`);
  });

  it("is not drawn over the sign-in, join or consent pages", () => {
    // A root loading.tsx would wrap every route, the rail and all; the map's lives in a group.
    expect(existsSync(new URL("../app/loading.tsx", import.meta.url))).toBe(
      false,
    );
  });
});
