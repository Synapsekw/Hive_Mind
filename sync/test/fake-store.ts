import type {
  Counts,
  FileUp,
  ManifestEntry,
  Moved,
  NoteUp,
  PlanResult,
  PutResult,
  Store,
} from "../src/store.ts";

type Kept = { sha: string; note: boolean; home?: string };

export class FakeStore implements Store {
  kept = new Map<string, Kept>();
  objects = new Map<string, Uint8Array>();
  notes = new Map<string, NoteUp>();
  calls: string[] = [];
  runs: {
    confirmable: string[];
    refused: string[];
    finished?: { counts: Counts; error: string | null };
  }[] = [];
  private manifest: ManifestEntry[] = [];
  failUploadOnce = new Set<string>();

  async openRun(confirm: boolean) {
    const prev = this.runs[this.runs.length - 1];
    this.runs.push({
      confirmable: confirm && prev ? prev.refused : [],
      refused: [],
    });
    this.manifest = [];
    return { runId: String(this.runs.length - 1), storagePrefix: "m/w/vault/" };
  }

  async plan(
    _run: string,
    page: ManifestEntry[],
    last: boolean,
  ): Promise<PlanResult | null> {
    this.calls.push("plan");
    this.manifest.push(...page);
    if (!last) return null;
    const isNote = (p: string) => /\.md$/i.test(p);
    const m = new Map(this.manifest.map((e) => [e.path, e]));
    const fresh = this.manifest.filter((e) => !this.kept.has(e.path));
    const lost = [...this.kept].filter(([p]) => !m.has(p));
    const moved: Moved[] = [];
    for (const [from, k] of lost) {
      const to = fresh.filter(
        (f) => f.sha256 === k.sha && isNote(f.path) === k.note,
      );
      const twins = lost.filter(
        ([, l]) => l.sha === k.sha && l.note === k.note,
      );
      if (to.length === 1 && twins.length === 1)
        moved.push({ from, to: to[0]!.path });
    }
    const movedTo = new Set(moved.map((x) => x.to));
    const movedFrom = new Set(moved.map((x) => x.from));
    return {
      new: fresh
        .map((e) => e.path)
        .filter((p) => !movedTo.has(p))
        .sort(),
      changed: this.manifest
        .filter(
          (e) =>
            this.kept.has(e.path) && this.kept.get(e.path)!.sha !== e.sha256,
        )
        .map((e) => e.path)
        .sort(),
      moved,
      gone: lost
        .map(([p]) => p)
        .filter((p) => !movedFrom.has(p))
        .sort(),
      rehome: this.manifest
        .filter((e) => {
          const k = this.kept.get(e.path);
          return (
            k && !k.note && k.sha === e.sha256 && e.home && e.home !== k.home
          );
        })
        .map((e) => ({ path: e.path, home: e.home! })),
      kept: this.kept.size,
    };
  }

  async putNotes(_run: string, notes: NoteUp[]): Promise<PutResult> {
    this.calls.push("putNotes");
    for (const n of notes) {
      if (n.from) this.kept.delete(n.from);
      this.kept.set(n.path, { sha: n.sha256, note: true });
      this.notes.set(n.path, n);
    }
    return {
      written: notes.map((n) => ({ path: n.path, id: n.path })),
      failed: [],
    };
  }

  async linkNotes(_run: string, pairs: Moved[]) {
    this.calls.push("linkNotes");
    return pairs.length;
  }

  async upload(path: string, bytes: Uint8Array, _contentType?: string) {
    this.calls.push("upload");
    if (this.failUploadOnce.delete(path)) throw new Error("network");
    this.objects.set(path, bytes);
  }

  async putFiles(_run: string, files: FileUp[]): Promise<PutResult> {
    this.calls.push("putFiles");
    for (const f of files) {
      const was = this.kept.get(f.from ?? f.path);
      if (f.from) this.kept.delete(f.from);
      this.kept.set(f.path, {
        sha: f.storage_path ? f.sha256 : was!.sha,
        note: false,
        home: f.home,
      });
    }
    return {
      written: files.map((f) => ({ path: f.path, id: f.path })),
      failed: [],
    };
  }

  async deletePaths(_run: string, paths: string[]) {
    this.calls.push("deletePaths");
    const run = this.runs[this.runs.length - 1]!;
    const mine = paths.filter((p) => this.kept.has(p));
    const n = mine.length;
    const trips = n > 25 || (n > 1 && n * 50 > this.kept.size);
    if (trips && !paths.every((p) => run.confirmable.includes(p))) {
      run.refused = paths;
      return { deleted: 0, refused: paths.length };
    }
    for (const p of mine) this.kept.delete(p);
    return { deleted: n, refused: 0 };
  }

  async finish(
    _run: string,
    counts: Counts,
    _tooBig: string[],
    error: string | null,
  ) {
    this.calls.push("finish");
    this.runs[this.runs.length - 1]!.finished = { counts, error };
  }
}
