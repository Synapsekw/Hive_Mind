// Argument checks for the settings server actions, which are public endpoints: every value from
// the browser passes through here before any query. Pure, no I/O. These only reject malformed
// input; whether a person may create an agent or invite a member is the database's answer.
import { PROVIDERS } from "../../settings/types";
import type { NewAgent, Provider, TrustTier } from "../../settings/types";
import { isUuid } from "../vault/validate";

const TIERS: readonly TrustTier[] = ["vendor", "self_hosted"];

/** An agent's name or an invited person's display name: trimmed, 1..60 characters. */
export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.trim();
  return name.length >= 1 && name.length <= 60 ? name : null;
}

/**
 * An email address, trimmed and lower-cased: at most 254 characters, no whitespace, exactly one
 * `@` with something on each side. Whether anyone has that address is the database's answer.
 */
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const email = v.trim().toLowerCase();
  if (email.length > 254 || /\s/.test(email)) return null;
  const parts = email.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return email;
}

/** The agent to connect, rebuilt from known keys only. */
export function cleanNewAgent(v: unknown): NewAgent | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const { workspaceId, provider, trustTier } = v as Record<string, unknown>;
  const name = cleanName((v as Record<string, unknown>).name);
  if (name === null || !isUuid(workspaceId)) return null;
  if (!PROVIDERS.includes(provider as Provider)) return null;
  if (!TIERS.includes(trustTier as TrustTier)) return null;
  return {
    name,
    workspaceId,
    provider: provider as Provider,
    trustTier: trustTier as TrustTier,
  };
}
