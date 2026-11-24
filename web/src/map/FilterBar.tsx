// The filter bar: a glass bar at the stage's bottom-left. Three buttons (the groups, Kind, People)
// each open a checkbox list above the bar; chips name what is active; a count says how much shows;
// and Clear all. Pointing at or focusing a row previews it on the map: that list as just
// the row, the other lists and the search kept. Only one list is open at a time. Names are text
// nodes only.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { chipFit } from "./chipFit";
import type { Preview } from "./MapCanvas";
import { Mark } from "./Legend";
import type { MapModel, NodeKind } from "./types";
import s from "./map.module.css";

const KINDS: [NodeKind, string][] = [
  ["note", "Notes"],
  ["file", "Files"],
  ["hub", "Groups"],
  ["agent", "Agents"],
];

/** The least room, in px, a chip with a shortened name is shown in rather than counted in "+N". */
const MIN_CHIP = 64;

type Which = "topics" | "kinds" | "members";

/** One entry in a list: what it previews, its row and its chip. */
type Entry = {
  key: string;
  name: string;
  count: number;
  on: boolean;
  mark: ReactNode;
  preview: Preview;
  toggle(): void;
};

/** One chip: an active entry or the search text. */
type Chip = { key: string; name: string; mark?: ReactNode; remove(): void };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "?";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (a + b).toUpperCase();
}

function toggled<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

const CHEVRON = (
  <svg
    aria-hidden="true"
    className={s.filterChevron}
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m2 6.5 3-3 3 3" />
  </svg>
);

export function FilterBar({
  model,
  heading,
  rings,
  topics,
  onTopics,
  kinds,
  onKinds,
  members,
  onMembers,
  q,
  onClearSearch,
  counts,
  onClearAll,
  onPreview,
}: {
  model: MapModel;
  heading: string; // Folders | Clusters | Months | Topics
  rings: boolean; // legend mentions brightness only in Rings
  topics: number[];
  onTopics(next: number[]): void;
  kinds: NodeKind[];
  onKinds(next: NodeKind[]): void;
  members: string[];
  onMembers(next: string[]): void;
  q: string;
  onClearSearch(): void;
  counts: { shown: number; total: number };
  onClearAll(): void;
  onPreview(p: Preview | null): void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const buttons = useRef<Partial<Record<Which, HTMLButtonElement | null>>>({});
  const [open, setOpen] = useState<Which | null>(null);

  const close = (refocus: boolean) => {
    const was = open;
    setOpen(null);
    onPreview(null);
    if (refocus && was) buttons.current[was]?.focus();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  // A press outside closes the list. Focus goes back to its button unless the press landed on
  // something that takes focus itself (the search field, another control).
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element) || root.current?.contains(t)) return;
      const takesFocus = !!t.closest(
        "button, a, input, textarea, select, [tabindex]",
      );
      const btn = buttons.current[open];
      closeRef.current(false);
      // After the press's own focus change, which would otherwise blur the button again.
      if (!takesFocus) setTimeout(() => btn?.focus({ preventScroll: true }), 0);
    };
    // Escape closes the list wherever focus is, <body> included (Safari does not focus a button
    // on click). Caught first, so the map's own Escape does not also clear the selection.
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current(true);
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  // A list that loses its entries (another arrangement) or the bar going away ends the preview.
  useEffect(() => () => onPreview(null), [onPreview]);

  // Counts per row, from the model alone: a filter change recomputes nothing here.
  const kindCount = useMemo(() => {
    const c = new Map<NodeKind, number>();
    for (const n of model.nodes) c.set(n.kind, (c.get(n.kind) ?? 0) + 1);
    return c;
  }, [model]);
  const memberCount = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of model.nodes)
      if ((n.kind === "note" || n.kind === "file") && n.member !== null)
        c.set(n.member, (c.get(n.member) ?? 0) + 1);
    return c;
  }, [model]);

  const swatch = (hue: number): CSSProperties =>
    ({
      // In Rings every group is drawn alike, as its hubs are.
      "--c": rings ? "var(--hub)" : `var(--hue-${hue + 1})`,
    }) as CSSProperties;

  const hubName = heading === "Topics" ? "Topics" : "Groups";
  const lists: Record<Which, Entry[]> = {
    topics: model.topics.map((t, i) => ({
      key: `t${i}`,
      name: t.name,
      count: t.count,
      on: topics.includes(i),
      mark: (
        <span
          aria-hidden="true"
          className={s.filterSwatch}
          style={swatch(t.hue)}
        />
      ),
      preview: { topic: i },
      toggle: () => onTopics(toggled(topics, i)),
    })),
    kinds: KINDS.map(([k, kindName]) => ({
      key: k,
      name: k === "hub" ? hubName : kindName,
      count: kindCount.get(k) ?? 0,
      on: kinds.includes(k),
      mark: <Mark kind={k} />,
      preview: { kind: k },
      toggle: () => onKinds(toggled(kinds, k)),
    })),
    members: model.members.map((m) => ({
      key: m.id,
      name: m.isMe ? `${m.name} (you)` : m.name,
      count: memberCount.get(m.id) ?? 0,
      on: members.includes(m.id),
      mark: (
        <span aria-hidden="true" className={s.filterAvatar}>
          {initials(m.name)}
        </span>
      ),
      preview: { member: m.id },
      toggle: () => onMembers(toggled(members, m.id)),
    })),
  };

  // Chips in the order the lists come, then the search text.
  const query = q.trim();
  const chips: Chip[] = [];
  for (const i of topics) {
    const t = model.topics[i];
    if (t)
      chips.push({
        key: `t${i}`,
        name: t.name,
        mark: (
          <span
            aria-hidden="true"
            className={s.filterSwatch}
            style={swatch(t.hue)}
          />
        ),
        remove: () => onTopics(topics.filter((x) => x !== i)),
      });
  }
  for (const k of kinds) {
    const e = lists.kinds.find((x) => x.key === k);
    if (e)
      chips.push({
        key: k,
        name: e.name,
        remove: () => onKinds(kinds.filter((x) => x !== k)),
      });
  }
  for (const mid of members) {
    const e = lists.members.find((x) => x.key === mid);
    if (e)
      chips.push({
        key: `m${mid}`,
        name: e.name,
        remove: () => onMembers(members.filter((x) => x !== mid)),
      });
  }
  if (query)
    chips.push({ key: "q", name: `“${query}”`, remove: onClearSearch });
  const active = chips.length > 0;

  // Chips that do not fit give way to a "+N" chip. A hidden copy of every chip gives their widths;
  // the row takes the width they need and the bar shrinks it when room runs out.
  const measure = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [need, setNeed] = useState(0);
  // The "+N" chip's width: the row never shrinks below it, so what is hidden is always counted.
  const [least, setLeast] = useState(0);
  const [fit, setFit] = useState(Infinity);
  const chipSig = chips.map((c) => c.key + c.name).join("\n");
  const barShown = model.nodes.length > 1;
  useLayoutEffect(() => {
    const m = measure.current;
    const r = row.current;
    const bar = root.current;
    if (!m || !r || !bar) return;
    // The stage the bar is placed in: its cap is the stage's width less the gutter.
    const stage =
      bar.offsetParent instanceof HTMLElement ? bar.offsetParent : null;
    /** The width the row may take: the bar at its cap, less everything else in the bar. Not the
     * row's own width, which is small while its chips are hidden. */
    const roomAtCap = () => {
      const barW = bar.getBoundingClientRect().width;
      const others = barW - r.getBoundingClientRect().width;
      const gutter =
        parseFloat(getComputedStyle(bar).getPropertyValue("--filter-gutter")) ||
        0;
      const cap = stage ? stage.clientWidth - gutter : barW;
      return Math.max(0, Math.floor(cap - others));
    };
    const compute = () => {
      const all = [...m.children] as HTMLElement[];
      const plus = all.pop();
      const gap = parseFloat(getComputedStyle(m).columnGap) || 0;
      const widths = all.map((el) => el.getBoundingClientRect().width);
      const full =
        widths.reduce((a, w) => a + w, 0) + gap * (widths.length - 1);
      const plusW = plus?.getBoundingClientRect().width ?? 0;
      setNeed(Math.max(0, Math.ceil(full)));
      setLeast(widths.length ? Math.ceil(plusW) : 0);
      setFit(
        chipFit({
          widths,
          gap,
          room: roomAtCap(),
          plus: plusW,
          min: MIN_CHIP,
        }),
      );
    };
    compute();
    // The stage (a fold, a window resize) and the rest of the bar (the count's text) change room.
    const ro = new ResizeObserver(compute);
    ro.observe(r);
    ro.observe(bar);
    if (stage) ro.observe(stage);
    // A web font that arrives late changes every chip's width.
    let gone = false;
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    fonts?.ready?.then(
      () => {
        if (!gone) compute();
      },
      () => {},
    );
    return () => {
      gone = true;
      ro.disconnect();
    };
  }, [chipSig, barShown]);
  const shownChips = fit >= chips.length ? chips : chips.slice(0, fit);
  const hidden = chips.length - shownChips.length;

  // After a chip's remove button or Clear all takes itself away, focus lands on its neighbour.
  const pending = useRef<number | null>(null);
  useEffect(() => {
    const at = pending.current;
    if (at === null) return;
    pending.current = null;
    const rest =
      row.current?.querySelectorAll<HTMLButtonElement>("[data-chip-remove]");
    const next =
      rest && rest.length ? rest[Math.min(at, rest.length - 1)] : null;
    (next ?? buttons.current.topics)?.focus();
  });

  const toggleOpen = (w: Which) => {
    if (open === w) return close(false);
    onPreview(null);
    setOpen(w);
  };

  // Focus moving anywhere but the open list and its own button (another list's button, a chip,
  // out of the bar) closes the list and leaves focus where it went. A null target (a press on a
  // non-focusable spot) is left to the outside-press handler.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget as Node | null;
    if (!open || !to) return;
    const slot = buttons.current[open]?.parentElement;
    if (!slot?.contains(to)) close(false);
  };

  // Arrow keys and Home/End move between a list's rows; Tab goes on as usual.
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const rows = [
      ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="checkbox"]',
      ),
    ];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    let to: number | null = null;
    if (e.key === "ArrowDown")
      to = at < 0 ? 0 : Math.min(at + 1, rows.length - 1);
    else if (e.key === "ArrowUp")
      to = at < 0 ? rows.length - 1 : Math.max(at - 1, 0);
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = rows.length - 1;
    if (to === null || !rows[to]) return;
    e.preventDefault();
    rows[to].focus();
  };

  if (model.nodes.length <= 1) return null;

  const labels: Record<Which, string> = {
    topics: heading,
    kinds: "Kind",
    members: "People",
  };

  const listButton = (w: Which) => {
    const list = lists[w];
    const chosen = list.filter((e) => e.on).length;
    return (
      <div className={s.filterSlot} key={w}>
        <button
          ref={(el) => {
            buttons.current[w] = el;
          }}
          type="button"
          className={s.filterButton}
          aria-expanded={open === w}
          aria-controls={open === w ? `${id}-${w}` : undefined}
          onClick={() => toggleOpen(w)}
        >
          {labels[w]}
          {chosen > 0 && (
            <>
              <span aria-hidden="true" className={s.filterBadge}>
                {chosen}
              </span>
              <span className={s.srOnly}>, {chosen} chosen</span>
            </>
          )}
          {CHEVRON}
        </button>
        {open === w && (
          <div
            id={`${id}-${w}`}
            role="group"
            aria-label={labels[w]}
            data-popover=""
            className={s.filterPop}
            onKeyDown={onListKey}
            onPointerLeave={() => onPreview(null)}
          >
            <div aria-hidden="true" className={s.filterPopHead}>
              <span>{labels[w]}</span>
              <span>{chosen ? `${chosen} chosen` : "All"}</span>
            </div>
            {list.map((e) => (
              <button
                key={e.key}
                type="button"
                role="checkbox"
                aria-checked={e.on}
                className={s.filterRow}
                onClick={e.toggle}
                onPointerEnter={() => onPreview(e.preview)}
                onFocus={() => onPreview(e.preview)}
                onBlur={() => onPreview(null)}
              >
                <span aria-hidden="true" className={s.filterBox}>
                  {e.on && (
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 10 10"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m2 5.2 2 2 4-4.4" />
                    </svg>
                  )}
                </span>
                {e.mark}
                <span className={s.filterRowName}>{e.name}</span>
                <span aria-hidden="true" className={s.filterRowCount}>
                  {e.count}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={root} className={s.filterBar} data-map-overlay="" onBlur={onBlur}>
      {listButton("topics")}
      {listButton("kinds")}
      {listButton("members")}
      <span aria-hidden="true" className={s.filterRule} />
      <div
        ref={row}
        className={s.filterChips}
        style={{ width: `${need}px`, minWidth: `${least}px` }}
      >
        {shownChips.map((c, i) => (
          <span key={c.key} className={s.filterChip}>
            {c.mark}
            <span className={s.filterChipName}>{c.name}</span>
            <button
              type="button"
              data-chip-remove=""
              className={s.filterChipRemove}
              aria-label={`Remove ${c.name}`}
              onClick={() => {
                pending.current = i;
                c.remove();
              }}
            >
              <svg
                aria-hidden="true"
                width="8"
                height="8"
                viewBox="0 0 8 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="m1.5 1.5 5 5m0-5-5 5" />
              </svg>
            </button>
          </span>
        ))}
        {hidden > 0 && (
          <span
            className={`${s.filterChip} ${s.filterMore}`}
            title={chips
              .slice(shownChips.length)
              .map((c) => c.name)
              .join(", ")}
          >
            +{hidden}
            <span className={s.srOnly}> more</span>
          </span>
        )}
      </div>
      {/* Every chip at its natural width, for measuring; never seen or read. */}
      <div ref={measure} aria-hidden="true" className={s.filterMeasure}>
        {chips.map((c) => (
          <span key={c.key} className={s.filterChip}>
            {c.mark}
            <span className={s.filterChipName}>{c.name}</span>
            <span className={s.filterChipRemove} />
          </span>
        ))}
        <span className={`${s.filterChip} ${s.filterMore}`}>
          +{chips.length}
        </span>
      </div>
      <span role="status" className={s.filterCount}>
        {active
          ? `${counts.shown} of ${counts.total} shown`
          : `All ${counts.total} shown`}
      </span>
      {active && (
        <button
          type="button"
          className={s.filterClear}
          onClick={() => {
            pending.current = 0;
            onClearAll();
          }}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
