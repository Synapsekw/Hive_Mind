// Live proof with two members of one hive, each with their own agent: private
// stays private, sharing opens a note, and a link opens two private notes only
// after both people accept. Run it with `pnpm test:live`; without a second
// agent token (HIVE_AGENT_TOKEN_2) in the environment it skips itself.
//
// The agents act through two real MCP servers. Sharing a note and accepting a
// link are people's decisions, so the test makes them signed in as each person,
// and only on notes it created under `_integration-test/<run id>/`.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const NEEDED = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_JWT_SECRET",
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
  const a = { token: process.env.HIVE_AGENT_TOKEN };
  const b = { token: process.env.HIVE_AGENT_TOKEN_2 };
  const ids = {};

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
    const { SignJWT } = await load("jose");

    for (const who of [a, b]) {
      const login = await rest("rpc/agent_login", {
        method: "POST",
        body: { p_token: who.token },
      });
      assert.equal(login.status, 200, `agent_login failed: ${login.text}`);
      who.me = login.json[0];
      const sign = (claims) => {
        const now = Math.floor(Date.now() / 1000);
        return new SignJWT({ role: "authenticated", ...claims })
          .setProtectedHeader({ alg: "HS256", typ: "JWT" })
          .setSubject(who.me.user_id)
          .setAudience("authenticated")
          .setIssuedAt(now)
          .setExpirationTime(now + 600)
          .sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET));
      };
      who.person = await sign({});
      who.agent = await sign({
        agent_id: who.me.agent_id,
        workspace_id: who.me.workspace_id,
        trust_tier: who.me.trust_tier,
      });
      await cleanUp(who);

      who.client = new Client({
        name: "hive-two-member-test",
        version: "0.0.0",
      });
      await who.client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [SERVER],
          env: { ...process.env, HIVE_AGENT_TOKEN: who.token },
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

  test("a private note stays private to the other member and their agent", async () => {
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

  test("the map shows each member the other's private note as a stub", async () => {
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
      for (const k of ["title", "path", "workspace_id", "by_agent", "agent_id"])
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

  test("an agent cannot share a note; once its owner does, the other member reads it", async () => {
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

  test("a link opens two private notes only after both people accept", async () => {
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
      assert.ok(r.status >= 400, `a forged note was accepted: ${r.text}`);
    }
  });

  test("the rest of each member's hive stays out of the other's reach", async () => {
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
});
