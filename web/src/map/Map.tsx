"use client";

// The map screen. The only state holder: view, groups, kinds, people, selection, search text and
// labels. Everything is computed from the payload in memory; nothing here touches the network.
// Every view, Orbit included, is drawn on one canvas (MapCanvas); a visually hidden list of
// real buttons (DotList) carries the keyboard and screen readers. Hover and keyboard focus make a
// dot hot (the peek card, firing links, the soft dim).
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { activity, agentStatus, buildModel } from "./graph";
import {
  layout,
  orbit,
  ringsLayout,
  timelineScale,
  type RingsLayout,
} from "./layouts";
import type { Scale } from "./timescale";
import {
  GROUP_HEADING,
  grouping,
  type Arrange,
  type Grouping,
} from "./arrange";
import { lit, nodeIndex, nodeKey, shown, topicIndexOf } from "./select";
import { buildScene } from "./scene";
import type { MapModel, MapPayload, NodeKind, View } from "./types";
import { TopBar } from "./Controls";
import { TodayButton } from "./TodayButton";
import { DetailRail } from "./DetailRail";
import { DotList } from "./DotList";
import { FilterBar } from "./FilterBar";
import { Legend } from "./Legend";
import { MapCanvas, type CameraApi, type Preview } from "./MapCanvas";
import { Peek } from "./Peek";
import {
  foldKeyIgnored,
  foldWide,
  quietTarget,
  useFold,
  useFoldSidePresent,
} from "../shell/FoldProvider";
import { Shell, type AgentRow } from "../shell/Shell";
import s from "./map.module.css";

const DAY_MS = 86_400_000;

/** A model and the layouts computed for it; kept so going back to it redoes no layout. */
type Entry = {
  model: MapModel;
  timeline: [number, number][] | null;
  timelineAt: number;
  /** The scale `timeline` was laid out on; the scene takes its labels and agent row from it. */
  scale: Scale | null;
  rings: RingsLayout | null;
  orbit: [number, number, number][] | null;
  orbitFlat: [number, number][] | null;
};

const PAN = 60;
/** How long the pointer rests on a dot before it becomes hot. */
const HOT_DELAY_MS = 80;

export function HiveMap({
  payload,
  now,
  inbox,
}: {
  payload: MapPayload;
  now: number;
  /** How much waits in the inbox, for the rail. */
  inbox?: number;
}) {
  const [view, setView] = useState<View>("rings");
  const [arrange, setArrange] = useState<Arrange>("folder");
  // The group filter and the selection are kept by name and by key, not by index, so they
  // follow the same group and node when a refresh shifts the indices (see `nodeKey`); people by id.
  const [topicNames, setTopicNames] = useState<string[]>([]);
  const [kinds, setKinds] = useState<NodeKind[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [names, setNames] = useState(true);
  const [hot, setHotNow] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [focusDot, setFocusDot] = useState<number | null>(null);
  // What the filter bar or the detail rail points at; null = nothing.
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fire, setFire] = useState<{ from: number; at: number } | null>(null);
  const cameraRef = useRef<CameraApi | null>(null);
  const hotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hotRef = useRef<number | null>(null);
  const { fold, togglePanel, openPanel } = useFold();
  const sidePresent = useFoldSidePresent();

  // A refresh that delivers the same payload keeps the model, so no layout runs again.
  const sig = useMemo(() => JSON.stringify(payload), [payload]);
  const parsed = useMemo(() => JSON.parse(sig) as MapPayload, [sig]);
  // Models for this payload, by arrangement. Rings has its own per arrangement; Timeline and
  // Orbit draw the folders capped at 8 groups. With 8 folders or fewer that is the same grouping
  // as Rings by folder, so they share its entry: one model, each view with its own layout. With
  // more, they share an "other" entry of their own. Time groups depend on the UTC day only, so
  // they are not rebuilt every minute. Going back to one already seen returns the same object.
  const entries = useMemo(() => new Map<string, Entry>(), [parsed]);
  const dayNow = Math.floor(now / DAY_MS) * DAY_MS;
  const entryOf = (key: string, groups: () => Grouping): Entry => {
    let e = entries.get(key);
    if (!e) {
      e = {
        model: buildModel(parsed, groups()),
        timeline: null,
        timelineAt: 0,
        scale: null,
        rings: null,
        orbit: null,
        orbitFlat: null,
      };
      entries.set(key, e);
    }
    return e;
  };
  let entry: Entry;
  if (view === "rings")
    entry = entryOf(
      arrange === "time" ? `rings:time:${dayNow}` : `rings:${arrange}`,
      () => grouping(parsed, arrange, dayNow),
    );
  else {
    const folder = entryOf("rings:folder", () =>
      grouping(parsed, "folder", dayNow),
    );
    entry =
      folder.model.topics.length <= 8
        ? folder
        : entryOf("other", () => grouping(parsed, "folder", 0, 8));
  }
  const model = entry.model;
  const act = useMemo(() => activity(model, now), [model, now]);

  const sel = useMemo(() => nodeIndex(model, selKey), [model, selKey]);
  // Groups and people the model does not have are left out here at once, then dropped from state
  // for good once the model changes (another view family or payload), so a filter never comes
  // back on its own when an earlier model returns.
  useEffect(() => {
    setTopicNames((cur) => {
      const next = cur.filter((name) => topicIndexOf(model, name) !== null);
      return next.length === cur.length ? cur : next;
    });
    setMemberIds((cur) => {
      const next = cur.filter((id) => model.members.some((m) => m.id === id));
      return next.length === cur.length ? cur : next;
    });
  }, [model]);
  const topics = useMemo(
    () =>
      topicNames
        .map((name) => topicIndexOf(model, name))
        .filter((i): i is number => i !== null),
    [model, topicNames],
  );
  const members = useMemo(
    () => memberIds.filter((id) => model.members.some((m) => m.id === id)),
    [model, memberIds],
  );
  // Drop a selection the new payload no longer has.
  if (selKey !== null && sel === null) setSelKey(null);

  const lastUsed = useMemo(
    () => new Map(payload.agents.map((a) => [a.id, a.last_used_at] as const)),
    [payload],
  );

  // Layouts are computed the first time a view is opened, then kept for this model. Only the
  // timeline depends on `now`, so only it is redone when `now` moves.
  const cache = entry;
  const isOrbit = view === "orbit";
  if (view === "rings" || isOrbit) {
    if (!cache.rings) cache.rings = ringsLayout(model);
  }
  let flatPos: [number, number][];
  if (view === "timeline") {
    if (!cache.timeline || cache.timelineAt !== now) {
      // One pass over the items for the scale, then the same scale for the positions and, in
      // the scene below, for the column labels and the agent row.
      cache.scale = timelineScale(model, now);
      cache.timeline = layout("timeline", model, now, cache.scale);
      cache.timelineAt = now;
    }
    flatPos = cache.timeline;
  } else {
    flatPos = cache.rings!.pos;
  }
  if (isOrbit && !cache.orbit) cache.orbit = orbit(model);
  // Orbit keeps its own copy of those positions: the canvas and the hidden list tell a view
  // switch by a new positions array, so going back to Rings must hand them a different one.
  if (isOrbit && !cache.orbitFlat) cache.orbitFlat = flatPos.slice();
  const pos = isOrbit ? cache.orbitFlat! : flatPos;

  // The hidden list's positions follow the canvas only once a glide has landed, so a view switch
  // never waits on 5,000 buttons' data-x/data-y before its first frame.
  const [listAt, setListAt] = useState({ pos, view, model });
  const onLanded = useCallback(
    (p: [number, number][], v: View, m: typeof model) =>
      // A transition: React may yield to the canvas's frames while it re-renders the list.
      startTransition(() =>
        setListAt((cur) =>
          cur.pos === p && cur.view === v ? cur : { pos: p, view: v, model: m },
        ),
      ),
    [],
  );
  // The list's own positions and view, so a view switch within one model changes nothing there
  // until the glide lands. A switch to another model (a new arrangement, or Timeline and Orbit
  // when there are more than 8 folders) re-renders the list at once: its indices are the new
  // model's.
  const listPos = listAt.model === model ? listAt.pos : pos;
  const listView = listAt.model === model ? listAt.view : view;

  const scene = useMemo(
    () =>
      buildScene(
        model,
        view,
        pos,
        act,
        now,
        view === "rings" ? cache.rings : null,
        view === "timeline" ? cache.scale : null,
      ),
    [model, view, pos, act, now, cache],
  );

  const agentInfo = useMemo(() => {
    const m = new Map<
      string,
      { status: string; selfHosted: boolean; name: string | null }
    >();
    for (const a of payload.agents)
      m.set(a.id, {
        status: agentStatus(a.last_used_at, now),
        selfHosted: a.trust_tier === "self_hosted",
        name: a.name,
      });
    return m;
  }, [payload, now]);
  const agents: AgentRow[] = useMemo(
    () =>
      model.nodes
        .filter((n) => n.kind === "agent" && n.id !== null)
        .map((n) => {
          const info = agentInfo.get(n.id!);
          const status = info?.status ?? "never used";
          return {
            id: n.id!,
            // The caller's own agents carry their name; a colleague's is "<member>, <provider>".
            name: info?.name || n.title,
            status,
            connected: status === "connected",
            lastUsedAt: lastUsed.get(n.id!) ?? null,
          };
        }),
    [model, agentInfo, lastUsed],
  );
  const query = q.trim();
  // In Rings by Links or Time a group's name is a note's title or a month, not a word the user
  // filed by, so the search does not light whole groups by it.
  const groupNames =
    view !== "rings" ||
    arrange === "folder" ||
    arrange === "category" ||
    arrange === "topic";
  // What the filter and the search light, without the selection. The bar's count follows only
  // this, so selecting a dot runs `lit` once (for `on`) and leaves the count alone.
  const base = useMemo(
    () => lit(model, { topics, kinds, members, q, sel: null, groupNames }),
    [model, topics, kinds, members, q, groupNames],
  );
  const counts = useMemo(() => shown(model, base), [model, base]);
  // With no selection `on` is `base` itself, so the canvas caches keyed on it still hit.
  const on = useMemo(
    () =>
      sel === null
        ? base
        : lit(model, { topics, kinds, members, q, sel, groupNames }),
    [base, model, topics, kinds, members, q, sel, groupNames],
  );
  const hits = query ? on.filter(Boolean).length : 0;
  const selNode = sel !== null ? model.nodes[sel] : undefined;
  const hotNode = hot !== null ? model.nodes[hot] : undefined;

  // Today's label rules; the canvas adds zoom-driven labels on top when Labels is on.
  const labels = useMemo(() => {
    const near = new Set(selNode?.nb ?? []);
    const out = new Set<number>();
    for (const n of model.nodes) {
      const label =
        on[n.i]! &&
        n.kind !== "root" &&
        (sel === n.i ||
          // Rings names its groups outside the circle, so its hubs carry no label of their own.
          (names && n.kind === "hub" && view === "orbit") ||
          (!!selNode && near.has(n.i) && selNode.nb.length <= 14) ||
          (!!query && hits <= 14) ||
          ((view === "timeline" || kinds.includes("agent")) &&
            n.kind === "agent"));
      if (label) out.add(n.i);
    }
    return out;
  }, [model, on, sel, selNode, names, view, query, hits, kinds]);

  // A pick toggles the selection; selecting frames the dot and its neighbours.
  const posRef = useRef(pos);
  posRef.current = pos;
  const selKeyRef = useRef(selKey);
  selKeyRef.current = selKey;
  const pick = useCallback(
    (i: number) => {
      const key = nodeKey(model, i);
      if (selKeyRef.current === key) return setSelKey(null);
      setSelKey(key);
      // A folded panel opens to show what was selected; a narrow window stacks and never folds.
      if (foldWide()) openPanel();
      setFire({ from: i, at: performance.now() });
      const p = posRef.current;
      const n = model.nodes[i];
      if (n && p[i])
        cameraRef.current?.frameOn([
          p[i]!,
          ...n.nb.map((j) => p[j]).filter((v) => v !== undefined),
        ]);
    },
    [model, openPanel],
  );
  const canvasPick = useCallback(
    (i: number | null) => {
      if (i === null) setSelKey(null);
      else pick(i);
    },
    [pick],
  );
  // Hot: after 80 ms on a dot (at once for keyboard focus); leaving clears it at once. A dot
  // that becomes hot fires its links.
  const becomeHot = useCallback(
    (i: number | null, at: { x: number; y: number } | null) => {
      if (hotTimer.current) clearTimeout(hotTimer.current);
      hotTimer.current = null;
      if (hotRef.current === i) return;
      hotRef.current = i;
      setHotNow(i);
      setAnchor(
        i === null ? null : (at ?? cameraRef.current?.screenOf(i) ?? null),
      );
      if (i !== null) setFire({ from: i, at: performance.now() });
    },
    [],
  );
  const setHot = useCallback(
    (i: number | null, at: { x: number; y: number } | null = null) => {
      if (hotTimer.current) clearTimeout(hotTimer.current);
      hotTimer.current = null;
      if (i === null) return becomeHot(null, null);
      hotTimer.current = setTimeout(() => becomeHot(i, at), HOT_DELAY_MS);
    },
    [becomeHot],
  );
  useEffect(
    () => () => {
      if (hotTimer.current) clearTimeout(hotTimer.current);
    },
    [],
  );
  const onFocusDot = useCallback(
    (i: number | null) => {
      setFocusDot(i);
      becomeHot(i, null);
    },
    [becomeHot],
  );
  // A hot dot that a refresh removed is no longer hot.
  if (hot !== null && !model.nodes[hot]) {
    hotRef.current = null;
    setHotNow(null);
  }

  // The soft dim: the hot dot's neighbourhood (no selection), or what a preview points at: the
  // filter with the previewed list as that one entry, the other lists and the search kept.
  const soft = useMemo(() => {
    if (preview) {
      const keep = lit(model, {
        topics: preview.topic != null ? [preview.topic] : topics,
        kinds: preview.kind != null ? [preview.kind] : kinds,
        members: preview.member != null ? [preview.member] : members,
        q,
        sel: null,
        groupNames,
      });
      const out = new Set<number>();
      keep.forEach((v, i) => v && out.add(i));
      return out;
    }
    if (hot !== null && sel === null)
      return new Set([hot, ...(model.nodes[hot]?.nb ?? [])]);
    return null;
  }, [model, preview, hot, sel, topics, kinds, members, q, groupNames]);
  // While a preview is on, the canvas also lights what it points at, so a row the filter leaves
  // out still shows: its dots at full strength, the rest of the filter at the soft dim.
  const drawn = useMemo(
    () => (preview && soft ? on.map((v, i) => v || soft.has(i)) : on),
    [on, preview, soft],
  );

  const switchView = (v: View) => {
    setView(v);
    setHot(null);
    cameraRef.current?.fitView();
  };

  const changeArrange = (a: Arrange) => {
    if (a === arrange) return;
    setArrange(a);
    // The group filter and the preview name groups of the old arrangement.
    setTopicNames([]);
    setPreview(null);
    setHot(null);
    cameraRef.current?.fitView();
  };

  const filter =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setSelKey(null);
    };

  // Keys when focus is not in a text field, and only ones no other component handled (a popover,
  // radio group or dialog keeps its own arrows and Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // `]` follows the fold keys' own rule, which lets AltGr and Option type it.
      if (e.key === "]") {
        if (foldKeyIgnored(e) || !sidePresent("panel") || !foldWide()) return;
        e.preventDefault();
        togglePanel();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (quietTarget(e.target)) return;
      const cam = cameraRef.current;
      switch (e.key) {
        case "+":
        case "=":
          cam?.zoomBy(1.25);
          break;
        case "-":
          cam?.zoomBy(1 / 1.25);
          break;
        case "0":
          cam?.fitView();
          break;
        case "ArrowLeft":
          cam?.panBy(PAN, 0);
          break;
        case "ArrowRight":
          cam?.panBy(-PAN, 0);
          break;
        case "ArrowUp":
          cam?.panBy(0, PAN);
          break;
        case "ArrowDown":
          cam?.panBy(0, -PAN);
          break;
        case "Escape":
          setSelKey(null);
          cam?.fitView();
          break;
        case "/":
          document.getElementById("hv-search")?.focus();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePanel, sidePresent]);

  return (
    <div className={s.root}>
      <Shell current="map" agents={agents} inbox={inbox} now={now} />
      <main aria-label="Hive map" className={s.panel}>
        <TopBar
          view={view}
          onView={switchView}
          arrange={arrange}
          onArrange={changeArrange}
          filter={
            <FilterBar
              model={model}
              heading={view === "rings" ? GROUP_HEADING[arrange] : "Topics"}
              rings={view === "rings"}
              topics={topics}
              onTopics={filter((next: number[]) =>
                setTopicNames(
                  next.flatMap((t) => {
                    const name = model.topics[t]?.name;
                    return name === undefined ? [] : [name];
                  }),
                ),
              )}
              kinds={kinds}
              onKinds={filter(setKinds)}
              members={members}
              onMembers={filter(setMemberIds)}
              q={q}
              onQ={filter(setQ)}
              onClearSearch={() => filter(setQ)("")}
              counts={counts}
              truncated={model.truncated}
              onClearAll={() => {
                setTopicNames([]);
                setKinds([]);
                setMemberIds([]);
                setQ("");
                setSelKey(null);
              }}
              onPreview={setPreview}
            />
          }
          today={
            <TodayButton
              today={act.today}
              needs={inbox ?? 0}
              open={fold.panel === "open"}
              controls="hv-details"
              onToggle={togglePanel}
            />
          }
        />
        <div className={s.stageFit} data-map-stage="">
          <MapCanvas
            model={model}
            scene={scene}
            view={view}
            pos={pos}
            orbit={isOrbit ? cache.orbit : null}
            lit={drawn}
            soft={soft}
            preview={preview}
            hot={hot}
            sel={sel}
            focusRing={focusDot}
            labelsOn={names}
            onNames={() => setNames((v) => !v)}
            legend={
              <Legend
                rings={view === "rings"}
                hubs={view === "rings" ? "Group hub" : "Topic hub"}
              />
            }
            labels={labels}
            onHover={setHot}
            onPick={canvasPick}
            cameraRef={cameraRef}
            fire={fire}
            onLanded={onLanded}
          />
          <DotList
            model={model}
            pos={listPos}
            view={listView}
            lit={on}
            sel={sel}
            onFocusDot={onFocusDot}
            onPick={pick}
          />
        </div>
        {hotNode && anchor && (
          <Peek
            node={hotNode}
            model={model}
            owner={
              model.members.find((m) => m.id === hotNode.member)?.name ?? null
            }
            now={now}
            anchor={anchor}
          />
        )}
      </main>
      <DetailRail
        model={model}
        act={act}
        sel={sel}
        agentInfo={agentInfo}
        now={now}
        inbox={inbox}
        members={members}
        onMembers={filter(setMemberIds)}
        onPick={pick}
        onHot={setHot}
        onPreview={setPreview}
        onClear={() => setSelKey(null)}
      />
    </div>
  );
}
