// purge-hives: once a day, erase the hives whose seven days are over.
//
// The database's scheduler calls this with a shared secret in the header
// `x-purge-secret`; anything without the right secret gets 401 before a single
// call is made. With the project's secret key the function then asks the
// database which hives are due (`hives_due_for_purge`, 20 at most), and for
// each one:
//
//   1. `begin_hive_purge`: the point of no return. Until it the owner can
//      cancel; after it nobody can, so nothing is removed before it.
//   2. `hive_object_paths`, page by page: the names of the hive's stored
//      objects, which are removed from the bucket "files" through Storage.
//      Then the list is asked from the start once more: only when it comes
//      back empty is anything erased.
//   3. `purge_hive`, again and again until it answers true: it erases the
//      hive in steps and writes the permanent record.
//
//   4. `sync_orphan_paths`: once the hives are done, the objects the vault sync
//      no longer uses (a day old or more, at most 1000) are removed from the
//      bucket and forgotten with `sync_orphans_removed`. A failure here leaves
//      them listed for the next run and never fails this one.
//
// A hive whose objects could not all be removed is not erased; it is counted
// as failed and the next run takes it up where this one stopped, since removed
// objects are no longer listed. A hive the run had no time or no steps left
// for is taken up again too, and is not counted as failed.
//
// Which hive is due, which objects are its own and whether it may be erased
// are the database's decisions. The request's body, address and other headers
// are ignored, so a caller has nowhere to name a hive.
//
// Nothing here logs or returns a hive's name, a path, the secret or the key:
// a log line is a fixed phrase with a hive's id and numbers, the answer is three
// counts.
//
// Web platform only (Request, Response, fetch, crypto.subtle), so the same
// file runs in the Edge runtime and under `node --test`.

export type Env = {
  url: string;
  serviceKey: string | undefined;
  purgeSecret: string | undefined;
};

const BUCKET = "files";
const MAX_HIVES = 20;
const PAGE = 1000;
const BATCH = 100;
// A million objects in one hive is not a hive of this product: a list that
// long is a list that does not end.
const MAX_PAGES = 1000;
// The pages are gone through again when Storage left names behind: this many
// times in all, in one run.
const MAX_PASSES = 3;
// purge_hive erases a bounded number of rows at a step and says when it is
// done, so a big hive takes many steps. This many in one run, then the next
// run goes on: a database that never says "done" is not asked for ever.
const MAX_STEPS = 500;
// Per call. Nobody waits for this function, so a call gets longer than in the
// functions a person waits for. A step of the erase is bounded by the
// database's own statement limit and gets twice the usual.
const TIMEOUT_MS = 10_000;
const PURGE_TIMEOUT_MS = 20_000;
// Nothing new is started after this long: no hive, no page, no batch, no
// step. The runtime ends a function at its wall-clock limit, and what was not
// done is done by the next run.
const RUN_BUDGET_MS = 120_000;

// What became of one hive, beside the reason it failed: erased; not finished
// because the run's time was up; not finished because its steps were used up.
// The last two are not failures.
const GONE = "gone";
const LATER = "later";
const MORE = "more";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function answer(
  status: number,
  body: unknown,
  extra?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

// One fixed phrase per line: never a name, a path, a key, another service's
// own words or an exception's message.
function note(reason: string): void {
  console.error(`purge-hives: ${reason}`);
}

function fail(
  status: number,
  error: string,
  reason: string,
  extra?: Record<string, string>,
): Response {
  note(reason);
  return answer(status, { error }, extra);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function drop(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {});
}

async function jsonOf(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

async function sha256(text: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

// Whether what was sent is the secret. Both are hashed first, so the two
// things compared always have the same length and the comparison takes the
// same time whatever was sent: it never stops at the first difference, and a
// value of another length is not refused any sooner.
async function sameSecret(sent: string, secret: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(sent), sha256(secret)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

/**
 * Answer one request.
 */
export async function handle(
  req: Request,
  env: Env,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<Response> {
  if (req.method !== "POST") {
    return fail(405, "use POST", "not a POST", { Allow: "POST" });
  }
  // The body is never read.
  await req.body?.cancel().catch(() => {});

  const base = env.url.replace(/\/+$/, "");
  const { serviceKey, purgeSecret } = env;
  // An empty secret is a missing one: it must never be matched by an empty or
  // absent header.
  if (!purgeSecret) return fail(503, "not set up", "purge secret missing");
  if (!base) return fail(503, "not set up", "project address missing");
  if (!serviceKey) return fail(503, "not set up", "secret key missing");

  const sent = req.headers.get("x-purge-secret") ?? "";
  if (!(await sameSecret(sent, purgeSecret))) {
    return fail(401, "not allowed", "wrong or missing secret");
  }

  const started = now();
  const spent = (): boolean => now() - started >= RUN_BUDGET_MS;

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  // Every call: the secret key, a JSON body, no redirect followed, a time
  // limit. Nothing of a hive is ever part of an address.
  const call = (
    address: string,
    method: string,
    body: unknown,
    timeout = TIMEOUT_MS,
  ): Promise<Response> =>
    fetchFn(address, {
      method,
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
  const rpc = (
    name: string,
    body: unknown,
    timeout?: number,
  ): Promise<Response> =>
    call(`${base}/rest/v1/rpc/${name}`, "POST", body, timeout);

  // 1. Which hives are due. The database gives 20 at most, and puts the ones
  //    it has not tried before first.
  let due: unknown;
  try {
    const res = await rpc("hives_due_for_purge", {});
    if (res.status !== 200) {
      await drop(res);
      return fail(
        502,
        "the due hives could not be read",
        `hives_due_for_purge answered ${res.status}`,
      );
    }
    due = await jsonOf(res);
  } catch {
    return fail(
      502,
      "the due hives could not be read",
      "hives_due_for_purge could not be reached",
    );
  }
  if (!Array.isArray(due)) {
    return fail(
      502,
      "the due hives could not be read",
      "hives_due_for_purge returned no list",
    );
  }

  // 2. One hive. GONE when it is erased, LATER when the run's time ended
  //    before it was, else the reason it failed.
  const purge = async (hive: string): Promise<string> => {
    // 2a. The point of no return. After it the owner can no longer cancel, so
    //     nothing is listed or removed before the database has agreed. A hive
    //     it refuses is left exactly as it was.
    try {
      const res = await rpc("begin_hive_purge", { p_hive: hive });
      await drop(res);
      if (!res.ok) return `begin_hive_purge answered ${res.status}`;
    } catch {
      return "begin_hive_purge could not be reached";
    }

    // 2b. Its stored objects, as the database lists them: a page of names in
    //     the order of the name, starting after the last one seen, until a
    //     page comes back empty. A short page is not the end.
    //
    //     Storage can answer 200 to a removal and still leave some of the
    //     names behind, so its answer is not taken as proof. Once the pages
    //     have ended, the list is asked from the start again, and only an
    //     empty first page lets the erase begin. Names that are still there
    //     are removed once more, three passes at most; after that the hive
    //     has failed, with its objects and its rows still in place.
    let after: string | null = null;
    let removed = 0;
    let pass = 1;
    for (let page = 0; ; page++) {
      if (spent()) return LATER;
      if (page >= MAX_PAGES) return `more than ${MAX_PAGES} pages of objects`;

      let rows: unknown;
      try {
        const res = await rpc("hive_object_paths", {
          p_hive: hive,
          p_after: after,
          p_limit: PAGE,
        });
        if (res.status !== 200) {
          await drop(res);
          return `hive_object_paths answered ${res.status}`;
        }
        rows = await jsonOf(res);
      } catch {
        return "hive_object_paths could not be reached";
      }
      if (!Array.isArray(rows)) return "its objects came back as no list";
      if (rows.length === 0) {
        // Empty from the start: nothing is left. Empty after a name: this
        // pass is over, and the next one starts by looking again.
        if (after === null) break;
        after = null;
        pass += 1;
        continue;
      }
      if (pass > MAX_PASSES) {
        return `stored objects remain after ${MAX_PASSES} passes (${removed} sent for removal)`;
      }

      const names: string[] = [];
      for (const row of rows) {
        const name = isRecord(row) ? row.name : undefined;
        if (typeof name !== "string" || name === "") {
          return "an object came back with no usable name";
        }
        names.push(name);
      }
      // A page that holds the name it was told to start after did not
      // advance: the same objects would be listed for ever. Which of two
      // names comes first is the database's own order and is not judged
      // here; the cap on pages and the run's time bound everything else.
      if (after !== null && names.includes(after)) {
        return `its object list did not advance (${removed} removed before)`;
      }

      for (let i = 0; i < names.length; i += BATCH) {
        if (spent()) return LATER;
        const prefixes = names.slice(i, i + BATCH);
        try {
          const res = await call(
            `${base}/storage/v1/object/${BUCKET}`,
            "DELETE",
            { prefixes },
          );
          await drop(res);
          if (!res.ok) {
            return `removing stored objects answered ${res.status} (${removed} removed before)`;
          }
        } catch {
          return `stored objects could not be removed (${removed} removed before)`;
        }
        removed += prefixes.length;
      }
      after = names[names.length - 1];
    }

    // 2c. The hive itself, erased a bounded number of rows at a step: false
    //     means "call again", true means it is gone. Reached only when the
    //     list of its objects came back empty from the start. (The database
    //     refuses on its own if an object is left; that is a failure like any
    //     other.) A hive that still answers false when the steps of one run
    //     are used up has not failed: every step did its part, and the next
    //     run goes on.
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (spent()) return LATER;
      let done: unknown;
      try {
        const res = await rpc("purge_hive", { p_hive: hive }, PURGE_TIMEOUT_MS);
        if (res.status !== 200) {
          await drop(res);
          return `purge_hive answered ${res.status} at step ${step}`;
        }
        done = await jsonOf(res);
      } catch {
        return `purge_hive could not be reached at step ${step}`;
      }
      if (done === true) return GONE;
      if (done !== false) {
        return `purge_hive answered neither true nor false at step ${step}`;
      }
    }
    return MORE;
  };

  let purged = 0;
  let failed = 0;
  let continuing = 0;
  const hives = due.slice(0, MAX_HIVES);
  for (let i = 0; i < hives.length; i++) {
    // A hive that is not started is not begun either: its owner can still
    // cancel until a later run reaches it.
    if (spent()) {
      note(`out of time, ${hives.length - i} not started`);
      break;
    }
    const entry = hives[i];
    const raw = isRecord(entry) ? entry.id : undefined;
    const id = typeof raw === "string" ? raw.toLowerCase() : "";
    // Only a uuid is ever sent on.
    if (id.length !== 36 || !UUID.test(id)) {
      failed += 1;
      note("a due hive came back with no usable id");
      continue;
    }
    const outcome = await purge(id);
    if (outcome === GONE) {
      purged += 1;
    } else if (outcome === LATER) {
      continuing += 1;
      note(`hive ${id}: out of time, continues on the next run`);
    } else if (outcome === MORE) {
      continuing += 1;
      note(`hive ${id}: ${MAX_STEPS} steps done, continues on the next run`);
    } else {
      failed += 1;
      note(`hive ${id}: ${outcome}`);
    }
  }

  // 3. Objects the vault sync no longer uses: at most one page of 1000, in
  //    batches. A failure leaves them listed for the next run; it never fails
  //    this one.
  let orphans = 0;
  if (!spent()) {
    try {
      const res = await rpc("sync_orphan_paths", { p_limit: 1000 });
      let listed: unknown;
      if (res.status === 200) listed = await jsonOf(res);
      else {
        await drop(res);
        note(`listing orphaned objects answered ${res.status}`);
      }
      const paths = Array.isArray(listed)
        ? listed.filter((p): p is string => typeof p === "string" && p !== "")
        : [];
      for (let i = 0; i < paths.length && !spent(); i += BATCH) {
        const prefixes = paths.slice(i, i + BATCH);
        const gone = await call(
          `${base}/storage/v1/object/${BUCKET}`,
          "DELETE",
          {
            prefixes,
          },
        );
        await drop(gone);
        if (!gone.ok) {
          note(`removing orphaned objects answered ${gone.status}`);
          break;
        }
        const done = await rpc("sync_orphans_removed", { p_paths: prefixes });
        await drop(done);
        orphans += prefixes.length;
      }
    } catch {
      note("orphaned objects could not be removed");
    }
  }

  note(
    `purged ${purged}, failed ${failed}, continuing ${continuing}, orphans ${orphans}`,
  );
  return answer(200, { ok: true, purged, failed, orphans });
}
