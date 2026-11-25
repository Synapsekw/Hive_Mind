"use client";

// The Join page inside the sign-in card: the Continue button for an emailed link, the expired
// line, or the invitations waiting for the signed-in person, each with Join.
//
// A hive's name and an inviter's name are other people's words. They are drawn as text and
// nothing else: never markup, never part of a link, never an attribute.
import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Logo } from "../brand/Logo";
import card from "../app/login/login.module.css";
import s from "./join.module.css";
import type { Joined, JoinView } from "./types";
import {
  CHECK,
  CONTINUE,
  CONTINUE_HINT,
  COULD_NOT_LOAD,
  EXPIRED,
  EXPIRED_NEXT,
  FAILED,
  IN_THIS_BROWSER,
  JOIN,
  NONE,
  NOT_YOU,
  OPENED,
  SIGNED_IN_AS,
  SIGNED_IN_NOW,
  SIGN_OUT,
  SIGN_OUT_AND_CONTINUE,
  STAY_AS,
  SWITCHED,
  SWITCH_WARNING,
  TITLE,
  TO_MAP,
  TO_SIGN_IN,
  TRY_AGAIN,
  WAITING,
  WORKING,
  invitedBy,
  openUntil,
} from "./text";

/** Where the expired line sends a person: sign-in, returning here. A fixed address. */
const SIGN_IN = "/login?next=%2Fjoin";
/** The app's sign-out, which then leads to sign-in and back here. A fixed address. */
const SIGN_OUT_TO = "/auth/signout?next=%2Fjoin";

export function Join({
  view,
  continueWithLink,
  join,
  after = "/",
  afterNew = "/join/password",
}: {
  view: JoinView;
  /** Spends the emailed link. The form posts it, so it works before any script has loaded. */
  continueWithLink: (formData: FormData) => void | Promise<void>;
  /** Joins one hive and answers whether it worked. */
  join: (id: string) => Promise<Joined>;
  /** Where the browser goes once joined: the map. A fixed address, never one from the data. */
  after?: string;
  /** Where a new person goes once joined: the optional password page. Fixed, as above. */
  afterNew?: string;
}) {
  return (
    <main className={card.page} aria-label={TITLE}>
      <div className={card.panel}>
        <div className={card.brand}>
          <h1 className={card.name}>
            <Logo />
          </h1>
        </div>
        {view.kind === "continue" && (
          <form className={card.form} action={continueWithLink}>
            <input type="hidden" name="token_hash" value={view.tokenHash} />
            <input type="hidden" name="type" value={view.type} />
            <p className={card.status}>{OPENED}</p>
            {view.email && (
              <p className={s.warning} data-testid="switch-warning">
                {SIGNED_IN_NOW}{" "}
                <span className={s.email} data-testid="signed-in-now">
                  {view.email}
                </span>{" "}
                {IN_THIS_BROWSER} {SWITCH_WARNING}
              </p>
            )}
            <ContinueButton
              label={view.email ? SIGN_OUT_AND_CONTINUE : CONTINUE}
            />
            {view.email && (
              // Leaves the link unused: a plain visit to the map, as the person signed in now.
              <a
                className={`${card.quiet} ${s.stay}`}
                href="/"
                data-testid="stay"
              >
                {`${STAY_AS} ${view.email}`}
              </a>
            )}
            <p className={card.hint}>{CONTINUE_HINT}</p>
          </form>
        )}
        {view.kind === "expired" && (
          <Lines status={EXPIRED} hint={EXPIRED_NEXT}>
            <a className={`${card.quiet} ${s.link}`} href={SIGN_IN}>
              {TO_SIGN_IN}
            </a>
          </Lines>
        )}
        {view.kind === "error" && (
          <Lines status={COULD_NOT_LOAD}>
            <a className={`${card.quiet} ${s.link}`} href="/join">
              {TRY_AGAIN}
            </a>
          </Lines>
        )}
        {view.kind === "list" && view.waiting.length === 0 && (
          <Lines status={NONE}>
            <a className={`${card.quiet} ${s.link}`} href="/">
              {TO_MAP}
            </a>
            <Account email={view.email} switched={view.switched} />
          </Lines>
        )}
        {view.kind === "list" && view.waiting.length > 0 && (
          <Waiting
            waiting={view.waiting}
            email={view.email}
            switched={view.switched}
            join={join}
            after={after}
            afterNew={afterNew}
          />
        )}
      </div>
    </main>
  );
}

/** One sentence, the one thing to do next, and an optional line of explanation. */
function Lines({
  status,
  hint,
  children,
}: {
  status: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className={card.form}>
      <p className={card.status} role="status">
        {status}
      </p>
      {children}
      {hint && <p className={card.hint}>{hint}</p>}
    </div>
  );
}

/**
 * Whose invitations these are, and the way out for someone else. Continue signs in whoever
 * holds the emailed link, replacing a session the browser already had; this line makes that
 * visible. The address is drawn as text only.
 */
function Account({ email, switched }: { email: string; switched: boolean }) {
  return (
    <>
      {switched && (
        <p className={s.switched} role="status" data-testid="switched">
          {SWITCHED}
        </p>
      )}
      {email && (
        <form className={s.account} method="post" action={SIGN_OUT_TO}>
          {SIGNED_IN_AS}{" "}
          <span className={s.email} data-testid="signed-in-as">
            {email}
          </span>
          . {NOT_YOU}{" "}
          <button className={s.signOut} type="submit">
            {SIGN_OUT}
          </button>
        </form>
      )}
    </>
  );
}

function ContinueButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={card.primary} type="submit" disabled={pending}>
      {label}
    </button>
  );
}

function Waiting({
  waiting,
  email,
  switched,
  join,
  after,
  afterNew,
}: {
  waiting: Extract<JoinView, { kind: "list" }>["waiting"];
  email: string;
  switched: boolean;
  join: (id: string) => Promise<Joined>;
  after: string;
  afterNew: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function accept(id: string) {
    if (busy) return;
    setBusy(true);
    setMessage(WORKING);
    let joined: Joined;
    try {
      joined = await join(id);
    } catch {
      joined = { ok: false };
    }
    if (joined.ok) {
      // Stays busy: the browser is leaving for the map, which is read again from the database,
      // or first for the password page. Only ever one of these two fixed addresses.
      window.location.assign(
        joined.next === "/join/password" ? afterNew : after,
      );
      return;
    }
    setMessage(FAILED);
    setBusy(false);
  }

  return (
    <div className={card.form}>
      <h2 className={s.heading}>{WAITING}</h2>
      <ul className={s.list}>
        {waiting.map((w, i) => {
          const until = openUntil(w.expiresAt);
          return (
            <li key={w.id} className={s.item}>
              <div className={s.who} id={`invitation-${i}`}>
                <p className={s.hive} data-testid="hive-name">
                  {w.hiveName}
                </p>
                {w.invitedBy && (
                  <p className={s.by} data-testid="invited-by">
                    {invitedBy(w.invitedBy)}
                  </p>
                )}
                {until && <p className={s.by}>{until}</p>}
              </div>
              <button
                className={`${card.primary} ${s.join}`}
                type="button"
                disabled={busy}
                aria-describedby={`invitation-${i}`}
                onClick={() => void accept(w.id)}
              >
                {JOIN}
              </button>
            </li>
          );
        })}
      </ul>
      <p className={card.status} role="status">
        {message}
      </p>
      <p className={card.hint}>{CHECK}</p>
      <Account email={email} switched={switched} />
    </div>
  );
}
