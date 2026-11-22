// Which nodes are lit for a filter, a search and a selection. Pure; the prototype's `lit` rule.
import type { Filter, MapModel } from "./types";

export function lit(model: MapModel, f: Filter): boolean[] {
  const q = f.q.trim().toLowerCase();
  const sel = f.sel !== null ? (model.nodes[f.sel] ?? null) : null;
  const near = new Set<number>(sel ? sel.nb : []);
  const topicName = model.topics.map((t) => t.name.toLowerCase());
  return model.nodes.map((n) => {
    let ok = true;
    if (f.topic !== null) ok = n.topic === f.topic;
    if (f.kind !== null) ok = ok && n.kind === f.kind;
    if (f.member !== null) ok = ok && n.member === f.member;
    // `n.title` is already the shown title ("Private note" when locked), so a locked node can
    // never match on its real one.
    if (q)
      ok =
        ok &&
        (n.title.toLowerCase().includes(q) ||
          (n.topic >= 0 && topicName[n.topic]!.includes(q)));
    if (sel) ok = ok && (n.i === sel.i || near.has(n.i));
    if (n.kind === "root" && !sel && !q) ok = true;
    return ok;
  });
}
