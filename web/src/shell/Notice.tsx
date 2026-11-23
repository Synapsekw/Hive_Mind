// The rail and an otherwise empty card, for the states where there is no screen to draw.
import type { ReactNode } from "react";
import { Shell } from "./Shell";
import s from "./notice.module.css";

/** Each destination's name for the card and where "Try again" leads. */
const SCREENS = {
  map: { label: "Hive map", href: "/" },
  vault: { label: "Vault", href: "/vault" },
  gallery: { label: "Gallery", href: "/gallery" },
} as const;

export function Notice({
  children,
  tryAgain,
  current = "map",
}: {
  children: ReactNode;
  tryAgain?: boolean;
  current?: "map" | "vault" | "gallery";
}) {
  const screen = SCREENS[current];
  return (
    <div className={s.root}>
      <Shell current={current} />
      <main aria-label={screen.label} className={s.card}>
        <div className={s.notice}>
          <p className={s.text}>{children}</p>
          {tryAgain && (
            <a href={screen.href} className={s.action}>
              Try again
            </a>
          )}
        </div>
      </main>
    </div>
  );
}
