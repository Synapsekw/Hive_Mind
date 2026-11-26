// Signs in at sync-session with the key and keeps the one-hour identity, asking again five
// minutes before it ends, so a long first run never sends an expired one. The key goes only to
// that address; nothing here logs it or the token.
import { KeyRefused, Unreachable } from "./store.ts";

const EARLY_MS = 300_000;

export function syncSession(
  cfg: { url: string; anonKey: string; key: string },
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): { token(): Promise<string> } {
  const base = cfg.url.replace(/\/+$/, "");
  let held: { token: string; until: number } | null = null;
  return {
    async token() {
      if (held && held.until - EARLY_MS > now()) return held.token;
      let res: Response;
      try {
        res = await fetchFn(`${base}/functions/v1/sync-session`, {
          method: "POST",
          headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
          body: JSON.stringify({ key: cfg.key }),
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new Unreachable("sync-session could not be reached");
      }
      if (res.status === 401) throw new KeyRefused("the sync key was refused");
      if (res.status !== 200)
        throw new Unreachable(`sync-session answered ${res.status}`);
      let body: { access_token?: unknown; expires_at?: unknown };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        throw new Unreachable("sync-session answered something else");
      }
      if (
        typeof body.access_token !== "string" ||
        typeof body.expires_at !== "number"
      ) {
        throw new Unreachable("sync-session answered something else");
      }
      held = { token: body.access_token, until: body.expires_at * 1000 };
      return held.token;
    },
  };
}
