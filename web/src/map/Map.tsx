"use client";

// The map screen. The only state holder: view, topic, kind, person, selection, search text and
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
import { layout, orbit, ringsLayout, type RingsLayout } from "./layouts";
import {
  GROUP_HEADING,
  grouping,
  type Arrange,
  type Grouping,
} from "./arrange";
import { lit, nodeIndex, nodeKey, topicIndexOf } from "./select";
import { buildScene } from "./scene";
import type { MapModel, MapPayload, NodeKind, View } from "./types";
import { TopBar } from "./Controls";
import { Dock } from "./Dock";
import { DetailRail } from "./DetailRail";
import { DotList } from "./DotList";
import { MapCanvas, type CameraApi, type Preview } from "./MapCanvas";
import { Peek } from "./Peek";
import { Shell, type AgentRow } from "../shell/Shell";
import s from "./map.module.css";

const DAY_MS = 86_400_000;

/** A model and the layouts computed for it; kept so going back to it redoes no layout. */
type Entry = {
  model: MapModel;
  timeline: [number, number][] | null;
  timelineAt: number;
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
  // The topic filter and the selection are kept by name and by key, not by index, so they
  // follow the same topic and node when a refresh shifts the indices (see `nodeKey`).
  const [topicName, setTopicName] = useState<string | null>(null);
  const [kind, setKind] = useState<NodeKind | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [names, setNames] = useState(true);
  const [hot, setHotNow] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [focusDot, setFocusDot] = useState<number | null>(null);
  // What the legend dock points at (the dock calls setPreview); null = nothing.
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fire, setFire] = useState<{ from: number; at: number } | null>(null);
  const cameraRef = useRef<CameraApi | null>(null);
  const hotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hotRef = useRef<number | null>(null);

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
  const topic = topicIndexOf(model, topicName);
  const member =
    memberId !== null && model.members.some((m) => m.id === memberId)
      ? memberId
      : null;
  // Drop what the new payload no longer has.
  if (selKey !== null && sel === null) setSelKey(null);
  if (topicName !== null && topic === null) setTopicName(null);
  if (memberId !== null && member === null) setMemberId(null);

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
      cache.timeline = layout("timeline", model, now);
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
  const groupNames = view !== "rings" || arrange === "folder";
  const on = useMemo(
    () =>
      lit(model, {
        topics: topic === null ? [] : [topic],
        kinds: kind === null ? [] : [kind],
        members: member === null ? [] : [member],
        q,
        sel,
        groupNames,
      }),
    [model, topic, kind, member, q, sel, groupNames],
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
          ((view === "timeline" || kind === "agent") && n.kind === "agent"));
      if (label) out.add(n.i);
    }
    return out;
  }, [model, on, sel, selNode, names, view, query, hits, kind]);

  const items = useMemo(
    () =>
      model.nodes.filter((n) => n.kind === "note" || n.kind === "file").length,
    [model],
  );
  const stats = query
    ? `${hits} ${hits === 1 ? "match" : "matches"}`
    : `${items} ${items === 1 ? "item" : "items"}, ${model.linkCount} ${model.linkCount === 1 ? "link" : "links"}` +
      (model.truncated ? ". Showing the 5,000 most recent items" : "");

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
      setFire({ from: i, at: performance.now() });
      const p = posRef.current;
      const n = model.nodes[i];
      if (n && p[i])
        cameraRef.current?.frameOn([
          p[i]!,
          ...n.nb.map((j) => p[j]).filter((v) => v !== undefined),
        ]);
    },
    [model],
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

  // The soft dim: the hot dot's neighbourhood (no selection), or what the dock points at.
  const soft = useMemo(() => {
    if (preview) {
      const keep = lit(model, {
        topics: preview.topic != null ? [preview.topic] : [],
        kinds: preview.kind != null ? [preview.kind] : [],
        members: preview.member != null ? [preview.member] : [],
        q: "",
        sel: null,
      });
      const out = new Set<number>();
      keep.forEach((v, i) => v && out.add(i));
      return out;
    }
    if (hot !== null && sel === null)
      return new Set([hot, ...(model.nodes[hot]?.nb ?? [])]);
    return null;
  }, [model, preview, hot, sel]);

  const switchView = (v: View) => {
    setView(v);
    setHot(null);
    cameraRef.current?.fitView();
  };

  const changeArrange = (a: Arrange) => {
    if (a === arrange) return;
    setArrange(a);
    // The group filter and the dock preview name groups of the old arrangement.
    setTopicName(null);
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
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable ||
          t.closest(
            'input, textarea, select, [data-popover], [role="radiogroup"], [role="dialog"]',
          ))
      )
        return;
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
  }, []);

  return (
    <div className={s.root}>
      <Shell current="map" agents={agents} inbox={inbox} now={now} />
      <main aria-label="Hive map" className={s.panel}>
        <TopBar
          stats={stats}
          view={view}
          onView={switchView}
          arrange={arrange}
          onArrange={changeArrange}
          names={names}
          onNames={() => setNames((v) => !v)}
          q={q}
          onQ={filter(setQ)}
        />
        <div className={s.stageFit} data-map-stage="">
          <MapCanvas
            model={model}
            scene={scene}
            view={view}
            pos={pos}
            orbit={isOrbit ? cache.orbit : null}
            lit={on}
            soft={soft}
            preview={preview}
            hot={hot}
            sel={sel}
            focusRing={focusDot}
            labelsOn={names}
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
          <Dock
            model={model}
            heading={view === "rings" ? GROUP_HEADING[arrange] : "Topics"}
            topic={topic}
            onTopic={filter((t: number | null) =>
              setTopicName(t === null ? null : (model.topics[t]?.name ?? null)),
            )}
            kind={kind}
            onKind={filter(setKind)}
            member={member}
            onMember={filter(setMemberId)}
            onPreview={setPreview}
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
        onPick={pick}
        onHot={setHot}
        onPreview={setPreview}
        onClear={() => setSelKey(null)}
      />
    </div>
  );
}
