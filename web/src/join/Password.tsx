"use client";

// The optional step after a new person joins: choosing a password, inside the sign-in card.
// Skipping is always possible; an emailed link keeps working either way.
//
// The two fields are the browser's own: what is typed is checked here, sent once to the server
// action and never comes back. The answer is only whether it worked and one of a few fixed
// reasons. After a refusal by the server the fields are emptied.
import { useRef, useState, type FormEvent } from "react";
import { Logo } from "../brand/Logo";
import card from "../app/login/login.module.css";
import s from "./join.module.css";
import { checkPassword } from "./rules";
import type { PasswordSaved } from "./types";
import {
  PASSWORD,
  PASSWORD_OPTIONAL,
  PASSWORD_TITLE,
  REPEAT_PASSWORD,
  SAVE_PASSWORD,
  SKIP,
  WORKING,
  passwordMessage,
} from "./text";

export function Password({
  email,
  save,
  skip,
  after = "/",
}: {
  /** The signed-in person's own address, so a password manager files the password under it. */
  email: string;
  /** Saves the password and answers whether it worked. */
  save: (formData: FormData) => Promise<PasswordSaved>;
  /** Skip for now: the step is not offered again. */
  skip: () => Promise<void>;
  /** Where the browser goes afterwards: the map. A fixed address. */
  after?: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [wrong, setWrong] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const fault = checkPassword(data.get("password"), data.get("repeat"));
    if (fault) {
      setWrong(true);
      setMessage(passwordMessage(fault));
      return;
    }
    setBusy(true);
    setWrong(false);
    setMessage(WORKING);
    let saved: PasswordSaved;
    try {
      saved = await save(data);
    } catch {
      saved = { ok: false, reason: "failed" };
    }
    if (saved.ok) {
      // Stays busy: the browser is leaving for the map.
      window.location.assign(after);
      return;
    }
    form.current?.reset();
    setWrong(true);
    setMessage(passwordMessage(saved.reason));
    setBusy(false);
    first.current?.focus();
  }

  async function skipIt() {
    if (busy) return;
    setBusy(true);
    setWrong(false);
    setMessage(WORKING);
    try {
      await skip();
    } catch {
      // Skipping only stops the offer; the map is the place to go either way.
    }
    window.location.assign(after);
  }

  return (
    <main className={card.page} aria-label={PASSWORD_TITLE}>
      <div className={card.panel}>
        <div className={card.brand}>
          <h1 className={card.name}>
            <Logo />
          </h1>
        </div>
        <form ref={form} className={card.form} onSubmit={submit} noValidate>
          <h2 className={s.title}>{PASSWORD_TITLE}</h2>
          <p className={s.lead}>{PASSWORD_OPTIONAL}</p>
          {email && (
            <input
              type="email"
              name="username"
              autoComplete="username"
              value={email}
              readOnly
              hidden
            />
          )}
          <label className={card.field}>
            <span className={card.label}>{PASSWORD}</span>
            <input
              ref={first}
              className={card.input}
              type="password"
              name="password"
              autoComplete="new-password"
              aria-invalid={wrong || undefined}
              aria-describedby="password-status"
            />
          </label>
          <label className={card.field}>
            <span className={card.label}>{REPEAT_PASSWORD}</span>
            <input
              className={card.input}
              type="password"
              name="repeat"
              autoComplete="new-password"
              aria-invalid={wrong || undefined}
              aria-describedby="password-status"
            />
          </label>
          <button className={card.primary} type="submit" disabled={busy}>
            {SAVE_PASSWORD}
          </button>
          <button
            className={card.quiet}
            type="button"
            disabled={busy}
            onClick={() => void skipIt()}
          >
            {SKIP}
          </button>
          <p className={card.status} role="status" id="password-status">
            {message}
          </p>
        </form>
      </div>
    </main>
  );
}
