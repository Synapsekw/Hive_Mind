"use client";

// The map screen. The only state holder: view, topic, kind, person, selection, search text and
// labels. Everything is computed from the payload in memory; nothing here touches the network.
import { useCallback, useMemo, useState } from "react";
import { activity, agentStatus, buildModel } from "./graph";
import { layout, orbit } from "./layouts";
import { lit, nodeIndex, nodeKey, topicIndexOf } from "./select";
import type { MapPayload, NodeKind, View } from "./types";
import { Chips, TopBar } from "./Controls";
import { DetailRail } from "./DetailRail";
import { FlatDots, type DotState } from "./Dots";
import { Backdrop, edgePaths, GuideLabels } from "./Edges";
import { Orbit } from "./Orbit";
import { Shell, type AgentRow } from "./Shell";
import s from "./map.module.css";

type Flat = Exclude<View, "orbit">;

export function HiveMap({
  payload,
  now,
}: {
  payload: MapPayload;
  now: number;
}) {
  const [view, setView] = useState<View>("rings");
  // The topic filter and the selection are kept by name and by key, not by index, so they
  // follow the same topic and node when a refresh shifts the indices (see `nodeKey`).
  const [topicName, setTopicName] = useState<string | null>(null);
  const [kind, setKind] = useState<NodeKind | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [names, setNames] = useState(true);

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
  const flatView: Flat = view === "orbit" ? "topics" : view;
  if (flatView === "timeline" && cache.timelineAt !== now) {
    cache.flat.delete("timeline");
    cache.timelineAt = now;
  }
  let pos = cache.flat.get(flatView);
  if (!pos) {
    pos = layout(flatView, model, now);
    cache.flat.set(flatView, pos);
  }
  const isOrbit = view === "orbit";
  if (isOrbit && !cache.orbit) cache.orbit = orbit(model);

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
  const agents: AgentRow[] = model.nodes
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
    });

  const query = q.trim();
  const on = useMemo(
    () => lit(model, { topic, kind, member, q, sel }),
    [model, topic, kind, member, q, sel],
  );
  const hits = query ? on.filter(Boolean).length : 0;
  const filtered =
    topic !== null || kind !== null || member !== null || !!query;
  const selNode = sel !== null ? model.nodes[sel] : undefined;
  const near = new Set(selNode?.nb ?? []);

  const states: DotState[] = model.nodes.map((n) => {
    const isSel = sel === n.i;
    const label =
      on[n.i]! &&
      n.kind !== "root" &&
      (isSel ||
        (names && n.kind === "hub" && view !== "timeline") ||
        (!!selNode && near.has(n.i) && selNode.nb.length <= 14) ||
        (!!query && hits <= 14) ||
        ((view === "timeline" || kind === "agent") && n.kind === "agent"));
    return { on: on[n.i]!, sel: isSel, label };
  });

  const edges = useMemo(
    () => edgePaths(model, pos, on, sel, view, filtered),
    [model, pos, on, sel, view, filtered],
  );
  const baseOpacity =
    sel !== null || filtered ? 0.1 : view === "links" ? 0.55 : 0.3;

  const items = model.nodes.filter(
    (n) => n.kind === "note" || n.kind === "file",
  ).length;
  const stats = query
    ? `${hits} ${hits === 1 ? "match" : "matches"}`
    : `${items} ${items === 1 ? "item" : "items"}, ${model.linkCount} ${model.linkCount === 1 ? "link" : "links"}` +
      (model.truncated ? ". Showing the 5,000 most recent items" : "");

  // Stable for a model, so the memoised dots do not redraw on every keystroke or click.
  const pick = useCallback(
    (i: number) => {
      const key = nodeKey(model, i);
      setSelKey((cur) => (cur === key ? null : key));
    },
    [model],
  );
  const filter =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setSelKey(null);
    };

  return (
    <div className={s.root}>
      <Shell agents={agents} />
      <main aria-label="Hive map" className={s.panel}>
        <TopBar
          stats={stats}
          view={view}
          onView={setView}
          names={names}
          onNames={() => setNames((v) => !v)}
          q={q}
          onQ={filter(setQ)}
        />
        <div className={s.stageFit}>
          <div className={s.stage}>
            <Backdrop
              model={model}
              pos={pos}
              view={view}
              act={act}
              edges={{ ...edges, baseOpacity }}
            />
            <GuideLabels view={view} now={now} />
            {!isOrbit && (
              <FlatDots model={model} pos={pos} states={states} onPick={pick} />
            )}
            {isOrbit && cache.orbit && (
              <Orbit
                model={model}
                pos={cache.orbit}
                states={states}
                onPick={pick}
              />
            )}
          </div>
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
