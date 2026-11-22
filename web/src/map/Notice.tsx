// The rail and an otherwise empty panel, for the two states where there is no map to draw.
import type { ReactNode } from "react";
import { Shell } from "./Shell";
import s from "./map.module.css";

export function Notice({
  children,
  tryAgain,
}: {
  children: ReactNode;
  tryAgain?: boolean;
}) {
  return (
    <div className={s.root}>
      <Shell agents={[]} />
      <main aria-label="Hive map" className={s.panel}>
        <div className={s.notice}>
          <p className={s.noticeText}>{children}</p>
          {tryAgain && (
            <a href="/" className={s.pillLink}>
              Try again
            </a>
          )}
        </div>
      </main>
    </div>
  );
}
