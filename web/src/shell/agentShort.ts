// How long ago an agent last connected, in the few characters the rail has room for.
export function agentShort(lastUsedAt: string | null, now: number): string {
  if (lastUsedAt === null) return "never";
  const t = Date.parse(lastUsedAt);
  if (!Number.isFinite(t)) return "never";
  const ms = Math.max(0, now - t);
  if (ms <= 3_600_000) return "now";
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}
