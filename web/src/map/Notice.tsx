// The rail and an otherwise empty panel, for the states where there is no screen to draw.
import type { ReactNode } from "react";
import { Shell } from "./Shell";
import s from "./map.module.css";

export function Notice({
  children,
  tryAgain,
  current = "map",
}: {
  children: ReactNode;
  tryAgain?: boolean;
  current?: "map" | "vault";
}) {
  return (
    <div className={s.root}>
      <Shell current={current} />
      <main
        aria-label={current === "vault" ? "Vault" : "Hive map"}
        className={s.panel}
      >
        <div className={s.notice}>
          <p className={s.noticeText}>{children}</p>
          {tryAgain && (
            <a
              href={current === "vault" ? "/vault" : "/"}
              className={s.pillLink}
            >
              Try again
            </a>
          )}
        </div>
      </main>
    </div>
  );
}
