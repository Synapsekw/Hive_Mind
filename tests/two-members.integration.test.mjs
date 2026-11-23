// Live proof with two members of one hive, each with their own agent: private
// stays private, sharing opens a note, and a link opens two private notes only
// after both people accept. Run it with `pnpm test:live`; without a second
// agent token (HIVE_AGENT_TOKEN_2) in the environment it skips itself.
//
// The agents act through two real MCP servers. Sharing a note and accepting a
// link are people's decisions, so the test makes them signed in as each person
// (HIVE_PERSON_EMAIL, HIVE_PERSON_PASSWORD and the same with _2), and only on
// notes it created under `_integration-test/<run id>/`. Only a person can
// delete a note, so without both people every check that writes is skipped.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const NEEDED = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "HIVE_AGENT_TOKEN",
  "HIVE_AGENT_TOKEN_2",
];
const SERVER = fileURLToPath(new URL("../mcp/dist/index.js", import.meta.url));
const missing = NEEDED.filter((n) => !process.env[n]);
const skip = missing.length
  ? `no second member configured (missing ${missing.join(", ")})`
  : !existsSync(SERVER)
    ? "mcp/dist/index.js is missing; run pnpm build"
    : false;

const PREFIX = "_integration-test/";
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const DIR = `${PREFIX}two-${RUN}/`;
const WORD = `hivepair${RUN}`;
const { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON } = process.env;

const fromMcp = createRequire(new URL("../mcp/package.json", import.meta.url));
const load = (id) => import(pathToFileURL(fromMcp.resolve(id)).href);

async function rest(path, { jwt, method = "GET", body, prefer } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${jwt ?? ANON}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON; the status is what the caller checks.
  }
  return { status: res.status, json, text };
}

// An agent's identity: the function checks the token and signs the JWT. The
// answer carries the JWT, so a failure reports the status and the reason only.
async function agentSession(body) {
  const res = await fetch(`${URL_}/functions/v1/agent-session`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // Not JSON; the status is what the caller checks.
  }
  return { status: res.status, json };
}
async function agentSignIn(token) {
  const r = await agentSession({ token });
  assert.equal(
    r.status,
    200,
    `agent-session answered ${r.status}: ${r.json?.error ?? "no reason given"}${
      r.status === 404 ? " (is the function deployed?)" : ""
    }`,
  );
  assert.equal(typeof r.json?.access_token, "string", "no access_token");
  const { access_token: jwt, ...me } = r.json;
  return { jwt, me };
}

// A person's identity: Supabase Auth, email and password.
async function personSignIn(email, password) {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // Not JSON; the status is what the caller checks.
  }
  assert.equal(
    res.status,
    200,
    `person sign-in answered ${res.status}: ${json?.error_code ?? "no reason given"}`,
  );
  assert.equal(typeof json?.access_token, "string", "no access_token");
  return { jwt: json.access_token, userId: json.user?.id };
}

const text = (result) => result.content.map((c) => c.text).join("\n");
const data = (result) => {
  const t = text(result);
  assert.ok(!result.isError, `tool failed: ${t}`);
  return JSON.parse(
    t.slice(t.indexOf("<hive-data>\n") + 12, t.lastIndexOf("\n</hive-data>")),
  );
};

describe("two members and their agents on a live database", { skip }, () => {
  // a is the hive's owner, b the second member.
  const a = {
    token: process.env.HIVE_AGENT_TOKEN,
    names: ["HIVE_PERSON_EMAIL", "HIVE_PERSON_PASSWORD"],
  };
  const b = {
    token: process.env.HIVE_AGENT_TOKEN_2,
    names: ["HIVE_PERSON_EMAIL_2", "HIVE_PERSON_PASSWORD_2"],
  };
  const ids = {};
  // Skips a check that needs both people signed in; true when it did.
  const noPeople = (t) => {
    const absent = [a, b].filter((who) => !who.person);
    if (!absent.length) return false;
    t.skip(
      `no person credentials: set ${absent
        .map((who) => who.names.join(" and "))
        .join(", ")}`,
    );
    return true;
  };

  const paths = async (who, query) =>
    data(await who.call("hive_search", { query })).map((n) => n.path);
  const cleanUp = async (who) => {
    const r = await rest(
      `notes?select=id,path&workspace_id=eq.${who.me.workspace_id}&path=like.*integration-test*`,
      { jwt: who.person },
    );
    assert.equal(r.status, 200, r.text);
    const mine = r.json.filter((n) => n.path.startsWith(`${PREFIX}two-`));
    if (!mine.length) return;
    const gone = await rest(
      `notes?id=in.(${mine.map((n) => n.id).join(",")})`,
      {
        jwt: who.person,
        method: "DELETE",
      },
    );
    assert.ok(gone.status < 300, `cleanup failed: ${gone.text}`);
  };

  before(async () => {
    const { Client } = await load("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await load(
      "@modelcontextprotocol/sdk/client/stdio.js",
    );

    // The servers get the agent tokens only, never a person's password.
    const serverEnv = { ...process.env };
    for (const who of [a, b]) for (const n of who.names) delete serverEnv[n];

    for (const who of [a, b]) {
      ({ jwt: who.agent, me: who.me } = await agentSignIn(who.token));
      const [email, password] = who.names.map((n) => process.env[n]);
      if (email && password) {
        const person = await personSignIn(email, password);
        assert.equal(
          person.userId,
          who.me.user_id,
          `${who.names[0]} is not the account behind this member's agent token`,
        );
        who.person = person.jwt;
        await cleanUp(who);
      }

      who.client = new Client({
        name: "hive-two-member-test",
        version: "0.0.0",
      });
      await who.client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [SERVER],
          env: { ...serverEnv, HIVE_AGENT_TOKEN: who.token },
          stderr: "pipe",
        }),
      );
      who.call = (name, args = {}) =>
        who.client.callTool({ name, arguments: args });
    }
    assert.equal(a.me.hive_id, b.me.hive_id, "both agents must be in one hive");
    assert.notEqual(a.me.member_id, b.me.member_id, "two different members");
  });

  after(async () => {
    for (const who of [a, b]) {
      await who.client?.close();
      if (who.person) await cleanUp(who);
    }
  });

  test("a private note stays private to the other member and their agent", async (t) => {
    if (noPeople(t)) return;
    for (const [who, name] of [
      [a, "a-private"],
      [b, "b-private"],
    ]) {
      const w = await who.call("hive_write", {
        path: `${DIR}${name}.md`,
        title: name,
        body: `${name} ${WORD}`,
      });
      assert.ok(!w.isError, text(w));
      ids[name] = data(
        await who.call("hive_read", { path: `${DIR}${name}.md` }),
      ).id;
    }

    assert.deepEqual(await paths(a, WORD), [`${DIR}a-private.md`]);
    assert.deepEqual(await paths(b, WORD), [`${DIR}b-private.md`]);
    const peek = await b.call("hive_read", { id: ids["a-private"] });
    assert.equal(peek.isError, true, "b's agent read a's private note");
    const direct = await rest(`notes?select=id&id=eq.${ids["a-private"]}`, {
      jwt: b.person,
    });
    assert.deepEqual(direct.json, [], "b read a's private note directly");
  });

  test("the map shows each member the other's private note as a stub", async (t) => {
    if (noPeople(t)) return;
    const mapOf = async (who) => {
      const r = await rest("rpc/map_graph", {
        jwt: who.person,
        method: "POST",
        body: { p_hive: who.me.hive_id },
      });
      assert.equal(r.status, 200, r.text);
      return r.json;
    };
    for (const [who, own, other] of [
      [a, "a-private", "b-private"],
      [b, "b-private", "a-private"],
    ]) {
      const m = await mapOf(who);
      const mine = m.nodes.find((n) => n.id === ids[own]);
      assert.equal(mine.locked, false);
      assert.equal(mine.path, `${DIR}${own}.md`);
      const stub = m.nodes.find((n) => n.id === ids[other]);
      assert.ok(stub, `${other} is missing from the map`);
      assert.equal(stub.locked, true);
      for (const k of [
        "title",
        "path",
        "workspace_id",
        "by_agent",
        "agent_id",
        "note_id",
      ])
        assert.equal(stub[k], null, k);
      const raw = JSON.stringify(m);
      assert.ok(!raw.includes(`${other} ${WORD}`), "the map carries a body");
      assert.ok(!raw.includes(`${DIR}${other}.md`), "the map carries a path");
    }
    // An agent cannot draw the map.
    const byAgent = await rest("rpc/map_graph", {
      jwt: a.agent,
      method: "POST",
      body: { p_hive: a.me.hive_id },
    });
    assert.equal(byAgent.status, 400, byAgent.text);
    assert.match(byAgent.text, /map_graph is for people/);
  });

  test("an agent cannot share a note; once its owner does, the other member reads it", async (t) => {
    if (noPeople(t)) return;
    const w = await a.call("hive_write", {
      path: `${DIR}a-shared.md`,
      title: "a-shared",
      body: `for the group ${WORD}`,
    });
    assert.ok(!w.isError, text(w));
    ids["a-shared"] = data(
      await a.call("hive_read", { path: `${DIR}a-shared.md` }),
    ).id;
    const share = (jwt) =>
      rest(`notes?id=eq.${ids["a-shared"]}`, {
        jwt,
        method: "PATCH",
        prefer: "return=representation",
        body: { visibility: "group" },
      });

    const byAgent = await share(a.agent);
    assert.equal(byAgent.status, 400, byAgent.text);
    assert.match(byAgent.text, /agents cannot change sharing/);
    assert.equal(
      (await b.call("hive_read", { id: ids["a-shared"] })).isError,
      true,
    );

    const byPerson = await share(a.person);
    assert.equal(byPerson.status, 200, byPerson.text);
    assert.equal(byPerson.json[0].visibility, "group");

    assert.deepEqual((await paths(b, WORD)).sort(), [
      `${DIR}a-shared.md`,
      `${DIR}b-private.md`,
    ]);
    const read = data(await b.call("hive_read", { id: ids["a-shared"] }));
    assert.equal(read.body, `for the group ${WORD}`);

    // Reading is not writing: b cannot change a's shared note.
    const edit = await rest(`notes?id=eq.${ids["a-shared"]}`, {
      jwt: b.person,
      method: "PATCH",
      prefer: "return=representation",
      body: { body: "changed by b" },
    });
    assert.deepEqual(edit.json, []);
  });

  test("a link opens two private notes only after both people accept", async (t) => {
    if (noPeople(t)) return;
    const proposed = await a.call("hive_propose_link", {
      from_path: `${DIR}a-private.md`,
      to_id: ids["b-private"],
      tier: 1,
    });
    assert.ok(!proposed.isError, text(proposed));
    const link = (
      await rest(`links?select=id,status&from_note=eq.${ids["a-private"]}`, {
        jwt: a.person,
      })
    ).json[0];
    assert.equal(link.status, "proposed");

    const respond = (jwt) =>
      rest("rpc/respond_to_link", {
        jwt,
        method: "POST",
        body: { p_link: link.id, p_accept: true },
      });
    const closed = async () => {
      assert.equal(
        (await a.call("hive_read", { id: ids["b-private"] })).isError,
        true,
      );
      assert.equal(
        (await b.call("hive_read", { id: ids["a-private"] })).isError,
        true,
      );
    };

    // The proposal waits in the other person's inbox, without the proposer's title or body.
    const inbox = (jwt) =>
      rest("rpc/inbox", {
        jwt,
        method: "POST",
        body: { p_hive: a.me.hive_id },
      });
    const waiting = await inbox(b.person);
    const item = waiting.json.links.find((l) => l.id === link.id);
    assert.ok(item, waiting.text);
    assert.equal(item.proposed_by, "theirs");
    assert.equal(item.theirs.title, null);
    assert.ok(
      !waiting.text.includes(`a-private ${WORD}`),
      "a body in the inbox",
    );
    assert.ok(
      !waiting.text.includes(`${DIR}a-private.md`),
      "a path in the inbox",
    );
    // An agent cannot read the inbox.
    const byAgent = await inbox(b.agent);
    assert.equal(byAgent.status, 400, byAgent.text);
    assert.match(byAgent.text, /inbox is for people/);

    // Proposing is not accepting, and no agent can accept.
    await closed();
    for (const agent of [a.agent, b.agent]) {
      const r = await respond(agent);
      assert.equal(r.status, 400, r.text);
      assert.match(r.text, /only a person/);
    }
    await closed();

    // One side is not enough.
    const first = await respond(a.person);
    assert.equal(first.json, "proposed", first.text);
    await closed();

    const second = await respond(b.person);
    assert.equal(second.json, "accepted", second.text);
    assert.equal(
      data(await a.call("hive_read", { id: ids["b-private"] })).body,
      `b-private ${WORD}`,
    );
    assert.equal(
      data(await b.call("hive_read", { id: ids["a-private"] })).body,
      `a-private ${WORD}`,
    );
    // The link opens those two notes and nothing else.
    assert.deepEqual((await paths(b, WORD)).sort(), [
      `${DIR}a-private.md`,
      `${DIR}a-shared.md`,
      `${DIR}b-private.md`,
    ]);
    assert.deepEqual((await paths(a, WORD)).sort(), [
      `${DIR}a-private.md`,
      `${DIR}a-shared.md`,
      `${DIR}b-private.md`,
    ]);
  });

  test("neither agent can write in the other member's workspace", async () => {
    for (const [who, other] of [
      [a, b],
      [b, a],
    ]) {
      const r = await rest("notes", {
        jwt: who.agent,
        method: "POST",
        body: {
          hive_id: other.me.hive_id,
          member_id: other.me.member_id,
          workspace_id: other.me.workspace_id,
          path: `${DIR}forged.md`,
          title: "forged",
        },
      });
      if (r.status < 400) {
        // Only a person can delete it; say where it is when none is signed in.
        if (other.person) await cleanUp(other);
        assert.fail(
          `a forged note was accepted (${r.status}). ` +
            (other.person
              ? "It was deleted again."
              : `It is still there: a person must delete the note at ` +
                `${DIR}forged.md in workspace ${other.me.workspace_id}; ` +
                `set ${other.names.join(" and ")} to have the test do it.`),
        );
      }
    }
  });

  test("the rest of each member's hive stays out of the other's reach", async (t) => {
    if (noPeople(t)) return;
    // b sees none of a's real notes: only what this test shared or linked.
    const seen = await rest(
      `notes?select=path&member_id=eq.${a.me.member_id}`,
      { jwt: b.person },
    );
    assert.equal(seen.status, 200, seen.text);
    assert.deepEqual(seen.json.map((n) => n.path).sort(), [
      `${DIR}a-private.md`,
      `${DIR}a-shared.md`,
    ]);
  });

  test("a folder shared by its owner shares the note an agent writes there", async (t) => {
    if (noPeople(t)) return;
    const folder = `${DIR}shared-folder`;
    const notePath = `${folder}/by-agent.md`;
    let folderId;
    try {
      const rule = await rest("folders?on_conflict=workspace_id,path", {
        jwt: a.person,
        method: "POST",
        prefer: "resolution=merge-duplicates,return=representation",
        body: {
          workspace_id: a.me.workspace_id,
          member_id: a.me.member_id,
          path: folder,
          visibility: "group",
        },
      });
      assert.equal(rule.status, 201, rule.text);
      folderId = rule.json[0].id;

      const w = await a.call("hive_write", {
        path: notePath,
        title: "in a shared folder",
        body: `written after the folder was shared ${WORD}`,
      });
      assert.ok(!w.isError, text(w));
      const id = data(await a.call("hive_read", { path: notePath })).id;

      const r = await rest(
        `notes?select=id,effective:note_visibility,rule_folder:note_rule_folder,access:note_access&id=eq.${id}`,
        { jwt: b.person },
      );
      assert.equal(r.status, 200, r.text);
      assert.deepEqual(r.json, [
        { id, effective: "group", rule_folder: folder, access: "shared" },
      ]);
    } finally {
      if (folderId) {
        const gone = await rest(`folders?id=eq.${folderId}`, {
          jwt: a.person,
          method: "DELETE",
        });
        assert.ok(gone.status < 300, `folder cleanup failed: ${gone.text}`);
      }
      await cleanUp(a);
    }
  });
});
