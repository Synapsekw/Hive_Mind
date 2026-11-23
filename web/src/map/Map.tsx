"use client";

// The map screen. The only state holder: view, topic, kind, person, selection, search text and
// labels. Everything is computed from the payload in memory; nothing here touches the network.
// The flat views and the Hive are drawn on one canvas (MapCanvas); a visually hidden list of
// real buttons (DotList) carries the keyboard and screen readers.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activity, agentStatus, buildModel } from "./graph";
import { hiveComb } from "./hive";
import { layout, orbit } from "./layouts";
import { lit, nodeIndex, nodeKey, topicIndexOf } from "./select";
import { buildScene } from "./scene";
import type { MapPayload, NodeKind, View } from "./types";
import { Chips, TopBar } from "./Controls";
import { DetailRail } from "./DetailRail";
import { DotList } from "./DotList";
import { MapCanvas, type CameraApi } from "./MapCanvas";
import { Orbit, type DotState } from "./Orbit";
import { Shell, type AgentRow } from "../shell/Shell";
import s from "./map.module.css";

type Flat = Exclude<View, "orbit" | "hive">;

const PAN = 60;

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
  const [hover, setHover] = useState<number | null>(null);
  const [focusDot, setFocusDot] = useState<number | null>(null);
  const cameraRef = useRef<CameraApi | null>(null);

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
  const marks = useMemo(
    () => new Map(comb.marks.map((m) => [m.node, { state: m.state }] as const)),
    [comb],
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
  const pos = view === "hive" ? comb.pos : flatPos;
  const isOrbit = view === "orbit";
  if (isOrbit && !cache.orbit) cache.orbit = orbit(model);

  const scene = useMemo(
    () => buildScene(model, view, pos, act, now, view === "hive" ? comb : null),
    [model, view, pos, act, now, comb],
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
          };
        }),
    [model, agentInfo],
  );

  const query = q.trim();
  const on = useMemo(
    () => lit(model, { topic, kind, member, q, sel }),
    [model, topic, kind, member, q, sel],
  );
  const hits = query ? on.filter(Boolean).length : 0;
  const selNode = sel !== null ? model.nodes[sel] : undefined;

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

  const states: DotState[] = isOrbit
    ? model.nodes.map((n) => ({
        on: on[n.i]!,
        sel: sel === n.i,
        label: labels.has(n.i),
      }))
    : [];

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
  const onHover = useCallback((i: number | null) => setHover(i), []);
  const hot = focusDot ?? hover;

  const switchView = (v: View) => {
    setView(v);
    setHover(null);
    cameraRef.current?.fitView();
  };

  const filter =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setSelKey(null);
    };

  // Keys when focus is not in a text field, and only ones no other component handled (a menu,
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
            'input, textarea, select, [role="menu"], [role="radiogroup"], [role="dialog"]',
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
      <Shell current="map" agents={agents} inbox={inbox} />
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
          {!isOrbit && (
            <>
              <MapCanvas
                model={model}
                scene={scene}
                view={view}
                pos={pos}
                lit={on}
                soft={null}
                hot={hot}
                sel={sel}
                focusRing={focusDot}
                labelsOn={names}
                labels={labels}
                marks={marks}
                onHover={onHover}
                onPick={canvasPick}
                cameraRef={cameraRef}
                fire={null}
                flare={null}
              />
              <DotList
                model={model}
                pos={pos}
                lit={on}
                sel={sel}
                onFocusDot={setFocusDot}
                onPick={pick}
              />
            </>
          )}
          {isOrbit && cache.orbit && (
            <div className={s.stage}>
              <Orbit
                model={model}
                pos={cache.orbit}
                states={states}
                onPick={pick}
              />
            </div>
          )}
        </div>
        <Chips
          model={model}
          topic={topic}
          onTopic={filter((t: number | null) =>
            setTopicName(t === null ? null : (model.topics[t]?.name ?? null)),
          )}
          kind={kind}
          onKind={filter(setKind)}
          member={member}
          onMember={filter(setMemberId)}
        />
      </main>
      <DetailRail
        model={model}
        act={act}
        sel={sel}
        agentInfo={agentInfo}
        now={now}
        onPick={(i) => setSelKey(nodeKey(model, i))}
        onClear={() => setSelKey(null)}
      />
    </div>
  );
}
