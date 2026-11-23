"use client";

// The account button at the foot of the rail and the menu it opens upwards: Appearance (an inline
// panel), Settings and Sign out. On dev pages there is no session, so the button is plain.
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { AppearancePanel, useCurrentTheme } from "./Appearance";
import { useAccount } from "./AccountContext";
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
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    setLook(false);
    if (refocus) button.current?.focus();
  };

  // An outside press closes the menu; focus stays wherever the press put it.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);

  useEffect(() => {
    if (open)
      menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
      return;
    }
    const target = e.target as HTMLElement;
    if (target.getAttribute("role") !== "menuitem") return;
    const items = Array.from(
      menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [],
    );
    const at = items.indexOf(target);
    let to: number | null = null;
    if (e.key === "ArrowDown") to = (at + 1) % items.length;
    else if (e.key === "ArrowUp") to = (at - 1 + items.length) % items.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = items.length - 1;
    if (to === null) return;
    e.preventDefault();
    items[to]?.focus();
  };

  const first = account?.name.trim().split(/\s+/)[0] ?? "";
  return (
    <div ref={root} className={s.account} onKeyDown={onKeyDown}>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Account"
          className={s.menu}
          data-scope="reset"
        >
          <button
            type="button"
            role="menuitem"
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
            role="menuitem"
            className={s.menuItem}
            onClick={() => close(false)}
          >
            <span className={s.menuLabel}>Settings</span>
          </Link>
          <form method="post" action="/auth/signout" className={s.signOutForm}>
            <button type="submit" role="menuitem" className={s.menuItem}>
              <span className={s.menuLabel}>Sign out</span>
            </button>
          </form>
        </div>
      )}
      <button
        ref={button}
        type="button"
        className={`${s.accountButton} ${s.control}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={account ? `Account, ${first}` : "Account"}
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
          <span aria-hidden="true" className={s.accountName}>
            Account
          </span>
        )}
        {CHEVRON}
      </button>
    </div>
  );
}
