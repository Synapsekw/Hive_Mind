import type { ReactNode } from "react";
import { Logo } from "../../../brand/Logo";
import styles from "../../login/login.module.css";
import { TITLE } from "./text";

/** The sign-in screen's card, around the approval window or one line that stands in for it. */
export function Frame({ children }: { children: ReactNode }) {
  return (
    <main className={styles.page} aria-label={TITLE}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <h1 className={styles.name}>
            <Logo />
          </h1>
        </div>
        {children}
      </div>
    </main>
  );
}

/** One sentence in place of the form: nothing to approve, not in a hive, could not load. */
export function Line({ children }: { children: ReactNode }) {
  return (
    <Frame>
      <p className={styles.status} role="status">
        {children}
      </p>
    </Frame>
  );
}
