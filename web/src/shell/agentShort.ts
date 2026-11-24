import { CONNECTED_MS } from "../map/graph";

// How long ago an agent last connected, in the few characters the rail and the Hive's presence
// panel have room for: `now` while it is live (the map's own window), then `2h`, `3d`.
export function agentShort(lastUsedAt: string | null, now: number): string {
  if (lastUsedAt === null) return "never";
  const t = Date.parse(lastUsedAt);
  if (!Number.isFinite(t)) return "never";
  const ms = Math.max(0, now - t);
  if (ms <= CONNECTED_MS) return "now";
  if (ms < 86_400_000) return `${Math.max(1, Math.floor(ms / 3_600_000))}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}
