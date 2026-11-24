// The legend: what each shape means. It opens from the zoom control's "?" button. Text only;
// brightness is explained only in Rings.
import type { CSSProperties } from "react";
import type { NodeKind } from "./types";
import s from "./map.module.css";

/** A node's mark at legend size, in the quiet text colour unless a colour is given. */
export function Mark({
  kind,
  locked = false,
  c = "var(--fg2)",
}: {
  kind: NodeKind;
  locked?: boolean;
  c?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`${s.shape} ${s.filterMark}`}
      style={{ "--c": c, "--d": "9px" } as CSSProperties}
      data-kind={kind}
      data-locked={locked || undefined}
    />
  );
}

export function Legend({
  rings,
  hubs,
}: {
  rings: boolean;
  hubs: "Topic hub" | "Group hub";
}) {
  return (
    <ul className={s.legendList}>
      <li>
        <Mark kind="note" />
        Note
      </li>
      <li>
        <Mark kind="file" />
        File
      </li>
      <li>
        <Mark kind="note" locked />
        Not shared with you
      </li>
      <li>
        <Mark kind="hub" c="var(--fg)" />
        {hubs}
      </li>
      <li>
        <Mark kind="agent" />
        Agent
      </li>
      {rings && (
        <li>
          <span aria-hidden="true" className={s.legendRamp} />
          Brighter means changed more recently
        </li>
      )}
    </ul>
  );
}
