"use client";

import { useState, type FormEvent } from "react";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createBrowserSupabase } from "../../lib/supabase/browser";
import styles from "./login.module.css";
import { afterSignIn, confirmAddress } from "./next";

const COPY = {
  notConfigured:
    "Sign-in isn't configured. Add the project URL and key to web/.env.local.",
  wrongCredentials: "That email and password don't match.",
  unreachable: "Couldn't reach the server. Try again.",
  linkSent: "Check your email for a sign-in link.",
  linkFailed:
    "Couldn't send the link. Try again in a few minutes, or use your password.",
  linkExpired: "That link has expired. Request a new one.",
  invited:
    "Invited? Enter the email the invitation was sent to and choose Email me a link.",
};

export function LoginForm({
  configured,
  linkExpired,
  next = "/",
}: {
  configured: boolean;
  linkExpired: boolean;
  /** Where to go once signed in: a path on this site, checked again before it is followed. */
  next?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(
    !configured ? COPY.notConfigured : linkExpired ? COPY.linkExpired : null,
  );

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!configured || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await createBrowserSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        // supabase-js returns a network failure as an error rather than throwing it.
        setMessage(
          isAuthRetryableFetchError(error)
            ? COPY.unreachable
            : COPY.wrongCredentials,
        );
        setBusy(false);
        return;
      }
      window.location.assign(afterSignIn(next));
    } catch {
      setMessage(COPY.unreachable);
      setBusy(false);
    }
  }

  async function emailLink() {
    if (!configured || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await createBrowserSupabase().auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: confirmAddress(window.location.origin, next),
        },
      });
      setMessage(error ? COPY.linkFailed : COPY.linkSent);
    } catch {
      setMessage(COPY.linkFailed);
    }
    setBusy(false);
  }

  return (
    <form className={styles.form} onSubmit={signIn}>
      <label className={styles.field}>
        <span className={styles.label}>Email</span>
        <input
          className={styles.input}
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Password</span>
        <input
          className={styles.input}
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button
        className={styles.primary}
        type="submit"
        disabled={busy || !configured}
      >
        Sign in
      </button>
      <button
        className={styles.quiet}
        type="button"
        onClick={emailLink}
        disabled={busy || !configured || email.trim() === ""}
      >
        Email me a link instead
      </button>
      <p className={styles.status} role="status">
        {message}
      </p>
      <p className={styles.hint}>{COPY.invited}</p>
    </form>
  );
}
