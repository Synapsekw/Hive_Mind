"use client";

// The vault over the fixture with stand-in actions: each records its call on
// `window.__vaultCalls` (for the browser tests) and answers as the database would. With
// `fail`, every write is refused and the folder count is unavailable.
import { fixturePreview } from "../../../vault/fixture";
import type { VaultActions, VaultData } from "../../../vault/types";
import { Vault } from "../../../vault/Vault";

declare global {
  interface Window {
    __vaultCalls?: { name: string; args: unknown[] }[];
  }
}

function record(name: string, args: unknown[]) {
  (window.__vaultCalls ??= []).push({ name, args });
}

export function DevVault({
  data,
  now,
  fail,
}: {
  data: VaultData;
  now: number;
  fail: boolean;
}) {
  const answer = async () =>
    fail ? { ok: false as const } : { ok: true as const };
  const actions: VaultActions = {
    saveNote: (noteId, choice) => {
      record("saveNote", [noteId, choice]);
      return answer();
    },
    saveFolder: (workspaceId, path, choice) => {
      record("saveFolder", [workspaceId, path, choice]);
      return answer();
    },
    release: (noteId) => {
      record("release", [noteId]);
      return answer();
    },
    preview: async (workspaceId, path) => {
      record("preview", [workspaceId, path]);
      return fail ? null : fixturePreview(data, path);
    },
  };
  return <Vault data={data} now={now} actions={actions} />;
}
