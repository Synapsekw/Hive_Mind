// The rail and an empty card with a quiet pulse: what a route shows while its server render is
// on its way (each route's `loading.tsx`). The same outer grid as a notice, so the layout does
// not jump when the screen arrives. Nothing here waits for data: the rail reads the account the
// root layout already holds.
import { Shell } from "./Shell";
import { LOADING } from "./hiveText";
import n from "./notice.module.css";
import s from "./loading.module.css";

export type Destination = "map" | "vault" | "gallery" | "inbox" | "settings";

export function Loading({ current }: { current: Destination }) {
  return (
    <div className={n.root}>
      <Shell current={current} />
      <div className={n.card}>
        <div
          role="status"
          aria-label={LOADING}
          className={`${s.status} ${s.pulse}`}
        >
          <span className={s.bar} />
          <span className={s.bar} />
          <span className={s.bar} />
        </div>
      </div>
    </div>
  );
}
