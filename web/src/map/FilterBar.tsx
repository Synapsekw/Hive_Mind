// The filter, in the map's top bar: the search field with a Filter button at its end, one popover
// under it with three columns (the groups, Kind, People), the chips that name what is active, one
// count and Clear all. Pointing at or focusing a row previews it on the map: that list as just
// the row, the other lists and the search kept. Names are text nodes only.
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
import { countText } from "./countText";
import type { Preview } from "./MapCanvas";
import { Mark } from "./Legend";
import { useDismiss } from "./useDismiss";
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

/** The popover's width with three columns side by side. */
const POP_WIDTH = 600;
/** Narrower than this, the three columns stack and the popover scrolls as one. */
const POP_STACK = 520;
/** The least gap, in px, the popover keeps from the card's edge. */
const POP_EDGE = 12;

type Which = "topics" | "kinds" | "members";
const COLUMNS: Which[] = ["topics", "kinds", "members"];

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

/** Where the open popover sits: right-aligned to the search field when the card has room to its
 * left, else left-aligned to it; never wider than the card allows, never taller than 60% of the
 * stage. */
type Place = {
  side: "left" | "right";
  width?: number;
  stack: boolean;
  height: string;
};

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
    <path d="m2 3.5 3 3 3-3" />
  </svg>
);

const SEARCH_ICON = (
  <svg
    aria-hidden="true"
    className={s.searchIcon}
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <circle cx="6" cy="6" r="4.25" />
    <path d="m9.2 9.2 3.3 3.3" />
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
  onQ,
  onClearSearch,
  counts,
  truncated,
  onClearAll,
  onPreview,
}: {
  model: MapModel;
  heading: string; // Folders | Clusters | Months | Topics
  rings: boolean; // in Rings every group is drawn alike
  topics: number[];
  onTopics(next: number[]): void;
  kinds: NodeKind[];
  onKinds(next: NodeKind[]): void;
  members: string[];
  onMembers(next: string[]): void;
  q: string;
  onQ(q: string): void;
  onClearSearch(): void;
  counts: { shown: number; total: number };
  /** The map was cut to its newest items. */
  truncated: boolean;
  onClearAll(): void;
  onPreview(p: Preview | null): void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place>({
    side: "right",
    stack: false,
    height: "60vh",
  });

  const close = (refocus: boolean) => {
    const was = open;
    setOpen(false);
    onPreview(null);
    if (refocus && was) button.current?.focus();
  };

  // A press outside, Escape (wherever focus is), focus leaving the filter, or another popover
  // opening closes the list; Escape gives focus back to the Filter button.
  useDismiss({ open, root, button, onClose: close });

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
  // the row takes the width they need and the filter shrinks it when room runs out.
  const measure = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const clear = useRef<HTMLButtonElement>(null);
  const [need, setNeed] = useState(0);
  // The "+N" chip's width: the row never shrinks below it, so what is hidden is always counted.
  const [least, setLeast] = useState(0);
  const [fit, setFit] = useState(Infinity);
  const chipSig = chips.map((c) => c.key + c.name).join("\n");
  const barShown = model.nodes.length > 1;
  useLayoutEffect(() => {
    const m = measure.current;
    const r = row.current;
    const wrap = root.current;
    const field = box.current;
    const n = count.current;
    if (!m || !r || !wrap || !field || !n) return;
    /** The width the row may take: the filter's width less the search field, the count, Clear
     * all and the gaps between them. Not the row's own width, which is small while its chips are
     * hidden. */
    const roomAtCap = () => {
      const gap = parseFloat(getComputedStyle(wrap).columnGap) || 0;
      const c = clear.current;
      const others =
        field.getBoundingClientRect().width +
        n.getBoundingClientRect().width +
        (c ? c.getBoundingClientRect().width + gap : 0) +
        gap * 2;
      return Math.max(0, Math.floor(wrap.clientWidth - others));
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
    // The bar (a fold, a window resize, a wrap), the count's text and the search field change room.
    const ro = new ResizeObserver(compute);
    ro.observe(wrap);
    ro.observe(n);
    ro.observe(field);
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
    (next ?? button.current ?? input.current)?.focus();
  });

  /** Where the popover goes, read once as it opens: the card's room beside the search field and
   * the stage's height. */
  const measurePlace = (): Place => {
    const field = box.current?.getBoundingClientRect();
    const card = root.current?.closest("main");
    const stage = card?.querySelector<HTMLElement>("[data-map-stage]");
    const height = stage ? `${Math.round(stage.clientHeight * 0.6)}px` : "60vh";
    if (!field || !card) return { side: "right", stack: false, height };
    const c = card.getBoundingClientRect();
    const leftward = Math.floor(field.right - (c.left + POP_EDGE));
    const rightward = Math.floor(c.right - POP_EDGE - field.left);
    if (leftward >= POP_WIDTH) return { side: "right", stack: false, height };
    const side = rightward > leftward ? "left" : "right";
    const width = Math.min(POP_WIDTH, side === "left" ? rightward : leftward);
    return { side, width, stack: width < POP_STACK, height };
  };

  const toggleOpen = () => {
    if (open) return close(false);
    onPreview(null);
    setPlace(measurePlace());
    setOpen(true);
  };

  // Focus moving within the filter but off the popover and its button (to the search field, a
  // chip) closes the list and leaves focus where it went. Leaving the filter is useDismiss's.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget as Node | null;
    if (!open || !to) return;
    if (!button.current?.contains(to) && !pop.current?.contains(to))
      close(false);
  };

  // Arrow keys and Home/End move between a column's rows; Tab goes on as usual, into the next
  // column.
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

  const labels: Record<Which, string> = {
    topics: heading,
    kinds: "Kind",
    members: "People",
  };
  const chosen = topics.length + kinds.length + members.length;

  const columnOf = (w: Which) => {
    const list = lists[w];
    const on = list.filter((e) => e.on).length;
    return (
      <div
        key={w}
        role="group"
        aria-label={labels[w]}
        className={s.filterCol}
        onKeyDown={onListKey}
      >
        <div aria-hidden="true" className={s.filterPopHead}>
          <span>{labels[w]}</span>
          <span>{on ? `${on} chosen` : "All"}</span>
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
    );
  };

  return (
    <div
      ref={root}
      className={s.filterGroup}
      data-filter-bar=""
      onBlur={onBlur}
    >
      <div ref={box} className={s.searchBox} data-search-box="">
        {SEARCH_ICON}
        <label htmlFor="hv-search" className={s.srOnly}>
          Search notes and files
        </label>
        <input
          ref={input}
          id="hv-search"
          type="search"
          placeholder="Search notes and files"
          autoComplete="off"
          className={s.searchInput}
          value={q}
          onChange={(e) => onQ(e.target.value)}
        />
        {barShown && (
          <button
            ref={button}
            type="button"
            className={s.filterToggle}
            // Named outright: the badge's box would otherwise put a space before the comma.
            aria-label={chosen > 0 ? `Filter, ${chosen} chosen` : "Filter"}
            aria-expanded={open}
            aria-controls={open ? `${id}-filter` : undefined}
            onClick={toggleOpen}
          >
            Filter
            {chosen > 0 && (
              <span aria-hidden="true" className={s.filterBadge}>
                {chosen}
              </span>
            )}
            {CHEVRON}
          </button>
        )}
        {barShown && open && (
          <div
            ref={pop}
            id={`${id}-filter`}
            role="group"
            aria-label="Filter"
            data-popover=""
            className={s.filterPop}
            data-side={place.side}
            data-stack={place.stack ? "" : undefined}
            style={{
              maxHeight: place.height,
              width: place.width !== undefined ? `${place.width}px` : undefined,
            }}
            onPointerLeave={() => onPreview(null)}
          >
            <div className={s.filterCols}>{COLUMNS.map(columnOf)}</div>
          </div>
        )}
      </div>
      {barShown && (
        <div
          ref={row}
          className={s.filterChips}
          data-chips=""
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
      )}
      {/* Every chip at its natural width, for measuring; never seen or read. */}
      {barShown && (
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
      )}
      <span ref={count} role="status" className={s.filterCount}>
        {countText({ ...counts, active, truncated })}
      </span>
      {active && (
        <button
          ref={clear}
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
