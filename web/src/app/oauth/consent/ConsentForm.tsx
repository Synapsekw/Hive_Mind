"use client";

// The approval window's form: which app asks, where it returns to, the workspace it will write
// into, and the two answers. Choosing a workspace is this screen's own state. A decision is one
// call; the answer is the address to go to, and the browser goes there.
import { useState } from "react";
import styles from "../../login/login.module.css";
import type { Decision, Outcome } from "./decide";
import {
  APPROVE,
  ASKS,
  CHECK,
  DENY,
  FAILED,
  WHAT_IT_MAY_DO,
  WORKING,
  WORKSPACE,
  returnsTo,
} from "./text";

export type Workspace = { id: string; name: string };

export function ConsentForm({
  authorizationId,
  appName,
  host,
  workspaces,
  initialWorkspaceId,
  decide,
}: {
  authorizationId: string;
  /** The name the app gave itself. Shown as text, never as markup. */
  appName: string;
  /** The host the app returns to; empty when it could not be read. */
  host: string;
  workspaces: Workspace[];
  initialWorkspaceId: string;
  decide: (
    authorizationId: string,
    decision: Decision,
    workspaceId: string,
  ) => Promise<Outcome>;
}) {
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function answer(decision: Decision) {
    if (busy) return;
    setBusy(true);
    setMessage(WORKING);
    let outcome: Outcome;
    try {
      outcome = await decide(authorizationId, decision, workspaceId);
    } catch {
      outcome = { ok: false };
    }
    if (outcome.ok) {
      // Stays busy: the browser is leaving for the app.
      window.location.assign(outcome.redirect);
      return;
    }
    setMessage(FAILED);
    setBusy(false);
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void answer("approve");
      }}
    >
      <p className={styles.status}>
        <strong data-testid="app-name">{appName}</strong> {ASKS}
      </p>
      <p className={styles.status} data-testid="returns-to">
        {returnsTo(host)}
      </p>
      <label className={styles.field}>
        <span className={styles.label}>{WORKSPACE}</span>
        <select
          className={styles.input}
          name="workspace"
          value={workspaceId}
          disabled={busy}
          onChange={(e) => setWorkspaceId(e.target.value)}
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <button className={styles.primary} type="submit" disabled={busy}>
        {APPROVE}
      </button>
      <button
        className={styles.quiet}
        type="button"
        disabled={busy}
        onClick={() => void answer("deny")}
      >
        {DENY}
      </button>
      <p className={styles.status} role="status">
        {message}
      </p>
      <p className={styles.hint}>
        {WHAT_IT_MAY_DO} {CHECK}
      </p>
    </form>
  );
}
