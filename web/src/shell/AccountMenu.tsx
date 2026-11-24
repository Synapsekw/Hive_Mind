"use client";

// The account button at the foot of the rail and the disclosure popover it opens upwards:
// Appearance (an inline panel), Settings and Sign out. Plain Tab order; Escape, an outside press
// and focus leaving all close it. On dev pages there is no session, so the button is plain.
import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { AppearancePanel, useCurrentTheme } from "./Appearance";
import { useAccount } from "./AccountContext";
import { useFold } from "./FoldProvider";
import s from "./shell.module.css";

const CHEVRON = (
  <svg
    aria-hidden="true"
    className={s.chevron}
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m3 4.5 3 3 3-3" />
  </svg>
);

export function AccountMenu() {
  const account = useAccount();
  const theme = useCurrentTheme();
  const [open, setOpen] = useState(false);
  const [look, setLook] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const folded = useFold().fold.rail === "shut";

  const close = (refocus: boolean) => {
    setOpen(false);
    setLook(false);
    if (refocus) button.current?.focus();
  };

  // An outside press closes the popover; focus stays wherever the press put it.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      close(true);
    }
  };

  // Focus moving to something outside the button and the popover closes it. A null target (a
  // press on a non-focusable spot inside) is left to the outside-press handler.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget as Node | null;
    if (open && to && !root.current?.contains(to)) close(false);
  };

  return (
    <div ref={root} className={s.account} onKeyDown={onKeyDown} onBlur={onBlur}>
      {open && (
        <div
          id={`${id}-popover`}
          role="group"
          aria-label="Account"
          data-popover=""
          className={s.menu}
        >
          <button
            type="button"
            className={s.menuItem}
            aria-expanded={look}
            aria-controls={look ? `${id}-panel` : undefined}
            onClick={() => setLook((v) => !v)}
          >
            <span
              aria-hidden="true"
              className={s.current}
              data-keep-colours=""
              style={{ background: theme.colour }}
            />
            <span className={s.menuLabel}>Appearance</span>
            <span className={s.themeName}>{theme.label}</span>
          </button>
          {look && <AppearancePanel id={id} />}
          <Link
            href="/settings"
            className={s.menuItem}
            onClick={() => close(false)}
          >
            <span className={s.menuLabel}>Settings</span>
          </Link>
          <form method="post" action="/auth/signout" className={s.signOutForm}>
            <button type="submit" className={s.menuItem}>
              <span className={s.menuLabel}>Sign out</span>
            </button>
          </form>
        </div>
      )}
      <button
        ref={button}
        type="button"
        className={`${s.accountButton} ${s.control}`}
        aria-expanded={open}
        aria-controls={open ? `${id}-popover` : undefined}
        aria-label={account ? `Account, ${account.name}` : "Account"}
        title={folded ? (account?.name ?? "Account") : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        {account ? (
          <>
            <span aria-hidden="true" className={s.avatar}>
              {account.initials}
            </span>
            <span aria-hidden="true" className={s.accountText}>
              <span className={s.accountName}>{account.name}</span>
              <span className={s.accountMeta}>
                {account.hive} · {account.role}
              </span>
            </span>
          </>
        ) : (
          <>
            <span aria-hidden="true" className={`${s.avatar} ${s.avatarBlank}`}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              >
                <circle cx="8" cy="5.5" r="2.5" />
                <path d="M3 13.5c.8-2.4 2.7-3.5 5-3.5s4.2 1.1 5 3.5" />
              </svg>
            </span>
            <span aria-hidden="true" className={s.accountName}>
              Account
            </span>
          </>
        )}
        {CHEVRON}
      </button>
    </div>
  );
}
