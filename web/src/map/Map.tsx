"use client";

// The map screen. The only state holder: view, topic, kind, person, selection, search text and
// labels. Everything is computed from the payload in memory; nothing here touches the network.
// Every view, Orbit included, is drawn on one canvas (MapCanvas); a visually hidden list of
// real buttons (DotList) carries the keyboard and screen readers. Hover and keyboard focus make a
// dot hot (the peek card, firing links, the soft dim); the Hive's agent marks move (useMarks).
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { activity, agentStatus, buildModel } from "./graph";
import { hiveComb } from "./hive";
import { layout, orbit } from "./layouts";
import { lit, nodeIndex, nodeKey, topicIndexOf } from "./select";
import { buildScene } from "./scene";
import type { MapPayload, NodeKind, View } from "./types";
import { TopBar } from "./Controls";
import { Dock } from "./Dock";
import { DetailRail } from "./DetailRail";
import { DotList } from "./DotList";
import { MapCanvas, type CameraApi, type Preview } from "./MapCanvas";
import { Peek } from "./Peek";
import { Presence } from "./Presence";
import { useMarks } from "./useMarks";
import { Shell, type AgentRow } from "../shell/Shell";
import s from "./map.module.css";

type Flat = Exclude<View, "orbit" | "hive">;

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
  const [view, setView] = useState<View>("hive");
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
  const model = useMemo(() => buildModel(JSON.parse(sig) as MapPayload), [sig]);
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

  // The comb moves only with the model and the minute (agent marks are live/today/idle).
  const minuteNow = Math.floor(now / 60_000) * 60_000;
  const lastUsed = useMemo(
    () => new Map(payload.agents.map((a) => [a.id, a.last_used_at] as const)),
    [payload],
  );
  const comb = useMemo(
    () => hiveComb(model, minuteNow, lastUsed),
    [model, minuteNow, lastUsed],
  );
  const markStates = useMemo(
    () => new Map(comb.marks.map((m) => [m.node, { state: m.state }] as const)),
    [comb],
  );
  const agentMarks = useMarks(
    comb,
    model,
    now,
    view === "hive" && hot === null,
  );

  // Layouts are computed the first time a view is opened, then kept for this model. Only the
  // timeline depends on `now`, so only it is redone when `now` moves.
  const cache = useMemo(
    () => ({
      flat: new Map<Flat, [number, number][]>(),
      timelineAt: 0,
      orbit: null as [number, number, number][] | null,
    }),
    [model],
  );
  const flatView: Flat = view === "orbit" || view === "hive" ? "topics" : view;
  if (flatView === "timeline" && cache.timelineAt !== now) {
    cache.flat.delete("timeline");
    cache.timelineAt = now;
  }
  let flatPos = cache.flat.get(flatView);
  if (!flatPos) {
    flatPos = layout(flatView, model, now);
    cache.flat.set(flatView, flatPos);
  }
  const basePos = view === "hive" ? comb.pos : flatPos;
  const isOrbit = view === "orbit";
  if (isOrbit && !cache.orbit) cache.orbit = orbit(model);
  const pos = basePos;
  // In the Hive the agents sit where their marks are now. The marks move, the comb does not: the
  // canvas reads the marks as a small override, so a move never touches the cached dot batches.
  const markPos = useMemo(
    () =>
      new Map(
        agentMarks.marks.map(
          (m) => [m.node, m.pos] as [number, [number, number]],
        ),
      ),
    [agentMarks.marks],
  );
  const moved = view === "hive" ? markPos : null;

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
  const listBase = listAt.model === model ? listAt.pos : pos;
  const listView = listAt.model === model ? listAt.view : view;
  // Keyed on the list's own positions and view, so a view switch changes nothing here until the
  // glide lands.
  const listPos = useMemo(() => {
    if (listView !== "hive") return listBase;
    const out = listBase.slice();
    for (const [i, at] of markPos) out[i] = at;
    return out;
  }, [listBase, listView, markPos]);

  // The scene is built from the comb's own positions, so a mark's move never rebuilds it.
  const scene = useMemo(
    () =>
      buildScene(model, view, basePos, act, now, view === "hive" ? comb : null),
    [model, view, basePos, act, now, comb],
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
  // The same names for "At the hive", by node.
  const agentNames = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a] as const));
    const m = new Map<number, { name: string; lastUsedAt: string | null }>();
    for (const n of model.nodes) {
      const a =
        n.kind === "agent" && n.id !== null ? byId.get(n.id) : undefined;
      if (a) m.set(n.i, { name: a.name, lastUsedAt: a.lastUsedAt ?? null });
    }
    return m;
  }, [agents, model]);

  const query = q.trim();
  const on = useMemo(
    () => lit(model, { topic, kind, member, q, sel }),
    [model, topic, kind, member, q, sel],
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
          (names && n.kind === "hub" && view !== "timeline") ||
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
        topic: preview.topic ?? null,
        kind: preview.kind ?? null,
        member: preview.member ?? null,
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
            marks={markStates}
            onHover={setHot}
            onPick={canvasPick}
            cameraRef={cameraRef}
            fire={fire}
            flare={agentMarks.flare}
            moved={moved}
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
          {view === "hive" && (
            <Presence
              marks={agentMarks.marks}
              names={agentNames}
              now={now}
              onHot={setHot}
            />
          )}
          <Dock
            model={model}
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
