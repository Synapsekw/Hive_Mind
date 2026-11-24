// One hive with three members (dani owns it, ahmed and sara joined) and an
// outsider in a hive of their own, over the real migrations in PGlite. For the
// test files that do not need the whole of sharing-rules.test.mjs.
import { openDb } from "../../scripts/local-db.mjs";

export async function setupHive() {
  const { db, as, addMember } = await openDb();
  const users = {};
  const members = {};
  const ws = {};
  for (const name of ["dani", "ahmed", "sara", "outsider"]) {
    const r = await db.query(
      `insert into auth.users (email) values ($1) returning id`,
      [`${name}@example.com`],
    );
    users[name] = r.rows[0].id;
  }
  const person = (name) => ({ sub: users[name], role: "authenticated" });
  const hive = (
    await as(
      person("dani"),
      `select public.create_hive('Test hive', 'Dani') as id`,
    )
  )[0].id;
  await addMember(hive, users.ahmed, "Ahmed");
  await addMember(hive, users.sara, "Sara");
  await as(
    person("outsider"),
    `select public.create_hive('Other hive', 'Outsider')`,
  );
  for (const name of ["dani", "ahmed", "sara", "outsider"]) {
    const m = await as(
      person(name),
      `select m.id, w.id as ws from public.members m
         join public.workspaces w on w.member_id = m.id
        where m.user_id = $1 order by w.created_at limit 1`,
      [users[name]],
    );
    members[name] = m[0].id;
    ws[name] = m[0].ws;
  }

  const agentFor = async (name, tier = "vendor") => {
    const made = (
      await as(
        person(name),
        `select * from public.create_agent($1, 'Test agent', 'other', $2)`,
        [ws[name], tier],
      )
    )[0];
    const login = (
      await as(null, `select * from public.agent_login($1)`, [made.token])
    )[0];
    return {
      sub: login.user_id,
      role: "authenticated",
      agent_id: login.agent_id,
      workspace_id: login.workspace_id,
      trust_tier: login.trust_tier,
    };
  };

  const addNote = async (name, title, extra = {}) =>
    (
      await as(
        extra.as ?? person(name),
        `insert into public.notes (hive_id, member_id, workspace_id, path, title, body, visibility, shared_with)
         values ($1, $2, $3, $4, $5, 'body', $6, $7) returning id, session_id`,
        [
          hive,
          members[name],
          ws[name],
          extra.path ?? `${title}.md`,
          title,
          extra.visibility ?? null,
          extra.shared_with ?? [],
        ],
        { headers: extra.headers },
      )
    )[0];

  // A stored object plus its files row, as hive_save_file makes them.
  const saveFile = async (who, owner, file, opts = {}) => {
    const path = `${members[owner]}/${ws[owner]}/outputs/proposal/acme/${file}`;
    const mime =
      opts.mime ?? (file.endsWith(".pdf") ? "application/pdf" : null);
    await as(
      who,
      `insert into storage.objects (bucket_id, name) values ('files', $1)`,
      [path],
      { headers: opts.headers },
    );
    return (
      await as(
        who,
        `insert into public.files (hive_id, member_id, workspace_id, note_id, storage_path, name, mime, size_bytes)
         values ($1, $2, $3, $4, $5, $6, $7, 100) returning id, session_id`,
        [
          hive,
          members[owner],
          ws[owner],
          opts.note_id ?? null,
          path,
          file,
          mime,
        ],
        { headers: opts.headers },
      )
    )[0];
  };

  return {
    db,
    as,
    person,
    agentFor,
    members,
    ws,
    hive,
    users,
    addNote,
    saveFile,
  };
}
