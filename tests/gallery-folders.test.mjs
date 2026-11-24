import { test } from "node:test";
import assert from "node:assert/strict";
import { setupHive } from "./helpers/hive.mjs";

const h = await setupHive();
const dani = () => h.person("dani");
const folder = async (who, member, name, parent = null) =>
  (
    await h.as(
      who,
      `insert into public.gallery_folders (member_id, parent_id, name) values ($1, $2, $3) returning id`,
      [member, parent, name],
    )
  )[0].id;

test("folders are seen and changed by their owner only", async () => {
  const id = await folder(dani(), h.members.dani, "Acme Inc");
  assert.equal(
    (
      await h.as(
        h.person("ahmed"),
        `select id from public.gallery_folders where id = $1`,
        [id],
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await h.as(
        h.person("ahmed"),
        `update public.gallery_folders set name = 'x' where id = $1 returning id`,
        [id],
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await h.as(
        h.person("ahmed"),
        `delete from public.gallery_folders where id = $1 returning id`,
        [id],
      )
    ).length,
    0,
  );
  await assert.rejects(
    folder(h.person("ahmed"), h.members.dani, "Sneaky"),
    /row-level security/,
  );
});

test("agents cannot see or touch folders", async () => {
  const id = await folder(dani(), h.members.dani, "Agentless");
  const agent = await h.agentFor("dani");
  assert.equal(
    (
      await h.as(agent, `select id from public.gallery_folders where id = $1`, [
        id,
      ])
    ).length,
    0,
  );
  await assert.rejects(
    folder(agent, h.members.dani, "By agent"),
    /row-level security/,
  );
});

test("two levels at most, and names are unique per level", async () => {
  const top = await folder(dani(), h.members.dani, "Clients");
  const sub = await folder(dani(), h.members.dani, "Acme", top);
  await assert.rejects(
    folder(dani(), h.members.dani, "Too deep", sub),
    /two levels/,
  );
  await assert.rejects(
    folder(dani(), h.members.dani, "clients"),
    /duplicate key/,
  );
  await folder(dani(), h.members.dani, "Acme"); // same name, other level: fine
  await assert.rejects(
    folder(dani(), h.members.dani, "   "),
    /check constraint/,
  );
  await assert.rejects(
    folder(dani(), h.members.dani, "x".repeat(61)),
    /check constraint/,
  );
});

test("a parent must be your own folder; a folder with children cannot be moved under another", async () => {
  const theirs = await folder(h.person("ahmed"), h.members.ahmed, "Ahmed top");
  await assert.rejects(
    folder(dani(), h.members.dani, "Under theirs", theirs),
    /your own folder/,
  );
  const a = await folder(dani(), h.members.dani, "Move A");
  await folder(dani(), h.members.dani, "Child", a);
  const b = await folder(dani(), h.members.dani, "Move B");
  await assert.rejects(
    h.as(
      dani(),
      `update public.gallery_folders set parent_id = $2 where id = $1`,
      [a, b],
    ),
    /two levels/,
  );
});

test("you add a file you can read; it stays a file you can read, no more", async () => {
  const agent = await h.agentFor("ahmed");
  const home = await h.addNote("ahmed", "gf home", { visibility: "group" });
  const shared = await h.saveFile(agent, "ahmed", "gf-shared.pdf", {
    note_id: home.id,
  });
  const secret = await h.saveFile(agent, "ahmed", "gf-secret.pdf");
  const id = await folder(dani(), h.members.dani, "Inbox of things");
  await h.as(
    dani(),
    `insert into public.gallery_folder_files (folder_id, file_id) values ($1, $2)`,
    [id, shared.id],
  );
  await assert.rejects(
    h.as(
      dani(),
      `insert into public.gallery_folder_files (folder_id, file_id) values ($1, $2)`,
      [id, secret.id],
    ),
    /row-level security/,
  );
  // Putting it in a folder shared nothing: sara still cannot see the secret, and the folder is dani's.
  assert.equal(
    (
      await h.as(
        h.person("sara"),
        `select folder_id from public.gallery_folder_files where folder_id = $1`,
        [id],
      )
    ).length,
    0,
  );
  // When the home note goes private, the membership stays but the file is not readable.
  await h.as(
    h.person("ahmed"),
    `update public.notes set visibility = 'private' where id = $1`,
    [home.id],
  );
  const rows = await h.as(
    dani(),
    `select ff.file_id, f.id as readable from public.gallery_folder_files ff
       left join public.files f on f.id = ff.file_id where ff.folder_id = $1`,
    [id],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].readable, null);
});

test("you cannot put files into someone else's folder", async () => {
  const agent = await h.agentFor("dani");
  const f = await h.saveFile(agent, "dani", "gf-x.pdf");
  const theirs = await folder(h.person("ahmed"), h.members.ahmed, "Ahmed only");
  await assert.rejects(
    h.as(
      dani(),
      `insert into public.gallery_folder_files (folder_id, file_id) values ($1, $2)`,
      [theirs, f.id],
    ),
    /row-level security/,
  );
});

test("deleting a folder removes sub-folders and memberships, never files", async () => {
  const agent = await h.agentFor("dani");
  const f = await h.saveFile(agent, "dani", "gf-keep.pdf");
  const top = await folder(dani(), h.members.dani, "Doomed");
  const sub = await folder(dani(), h.members.dani, "Doomed child", top);
  await h.as(
    dani(),
    `insert into public.gallery_folder_files (folder_id, file_id) values ($1, $2)`,
    [sub, f.id],
  );
  await h.as(dani(), `delete from public.gallery_folders where id = $1`, [top]);
  assert.equal(
    (
      await h.as(
        dani(),
        `select id from public.gallery_folders where id = any($1)`,
        [[top, sub]],
      )
    ).length,
    0,
  );
  assert.equal(
    (await h.as(dani(), `select id from public.files where id = $1`, [f.id]))
      .length,
    1,
  );
});

test("a file goes only into a folder of the hive it lives in", async () => {
  // The outsider also joins dani's hive, so they have a member in each hive.
  const inDani = await h.addMember(h.hive, h.users.outsider, "Outsider in A");
  const agent = await h.agentFor("ahmed");
  const home = await h.addNote("ahmed", "gf cross home", {
    visibility: "group",
  });
  const f = await h.saveFile(agent, "ahmed", "gf-cross.pdf", {
    note_id: home.id,
  });
  const out = h.person("outsider");
  // The file is readable to the outsider (they are a member of its hive now).
  assert.equal(
    (await h.as(out, `select id from public.files where id = $1`, [f.id]))
      .length,
    1,
  );
  // Their folder in their own (other) hive refuses a file of dani's hive.
  const other = await folder(out, h.members.outsider, "Other hive folder");
  await assert.rejects(
    h.as(
      out,
      `insert into public.gallery_folder_files (folder_id, file_id) values ($1, $2)`,
      [other, f.id],
    ),
    /row-level security/,
  );
  // Their folder in the file's hive takes it.
  const here = await folder(out, inDani, "Same hive folder");
  await h.as(
    out,
    `insert into public.gallery_folder_files (folder_id, file_id) values ($1, $2)`,
    [here, f.id],
  );
});

test("a hive that is being deleted takes no new folders or memberships", async () => {
  const lone = { sub: h.users.sara, role: "authenticated" };
  const hive = (
    await h.as(lone, `select public.create_hive('Closing hive', 'Sara2') as id`)
  )[0].id;
  const me = (
    await h.as(lone, `select id from public.members where hive_id = $1`, [hive])
  )[0].id;
  const fid = await folder(lone, me, "Before");
  const wsId = (
    await h.as(lone, `select id from public.workspaces where member_id = $1`, [
      me,
    ])
  )[0].id;
  const path = `${me}/${wsId}/outputs/closing.pdf`;
  await h.as(
    lone,
    `insert into storage.objects (bucket_id, name) values ('files', $1)`,
    [path],
  );
  const file = await h.as(
    lone,
    `insert into public.files (hive_id, member_id, workspace_id, storage_path, name, mime, size_bytes)
     values ($1, $2, $3, $4, 'closing.pdf', 'application/pdf', 1) returning id`,
    [hive, me, wsId, path],
  );
  await h.as(lone, `select public.request_hive_deletion($1, 'Closing hive')`, [
    hive,
  ]);
  await assert.rejects(folder(lone, me, "After"), /being deleted/);
  await assert.rejects(
    h.as(
      lone,
      `insert into public.gallery_folder_files (folder_id, file_id) values ($1, $2)`,
      [fid, file[0].id],
    ),
    /being deleted/,
  );
});

test("a folder cannot be its own parent", async () => {
  const top = await folder(dani(), h.members.dani, "Self parent");
  await assert.rejects(
    h.as(
      dani(),
      `update public.gallery_folders set parent_id = id where id = $1`,
      [top],
    ),
    /two levels/,
  );
});
