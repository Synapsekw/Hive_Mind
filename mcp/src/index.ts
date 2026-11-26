#!/usr/bin/env node
// Hive Mind MCP server (local, stdio).
// Exchanges the agent token for the member's identity, then talks to Supabase
// as that member. Every permission is enforced by the database, not here.
import { readFile, realpath, stat } from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { SESSION_HEADER, sessionKey } from "./session-key.js";
import { signIn, type Session } from "./sign-in.js";
import { done, fail, registerTools } from "./tools.js";

const env = (name: string): string => {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. See README.md.`);
    process.exit(1);
  }
  return v;
};
const SUPABASE_URL = env("SUPABASE_URL");
const SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY");
const HIVE_AGENT_TOKEN = env("HIVE_AGENT_TOKEN");

let session: Session | undefined;
let client: SupabaseClient | undefined;
let expiresAt = 0;
let signingIn: Promise<{ db: SupabaseClient; me: Session }> | undefined;

// Sign in again when the hour-long identity is close to running out. This also
// picks up a revoked token within the hour. The identity comes from the
// agent-session function; this machine holds the agent token and nothing else.
// Calls that arrive while a sign-in is under way share it.
function db(): Promise<{ db: SupabaseClient; me: Session }> {
  if (client && session && Date.now() < expiresAt - 60_000)
    return Promise.resolve({ db: client, me: session });

  signingIn ??= signIn({
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    token: HIVE_AGENT_TOKEN,
  })
    .then(({ accessToken, expiresAt: expiresAtSeconds, me }) => {
      const fresh: SupabaseClient = createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              [SESSION_HEADER]: sessionKey(),
            },
            // A 401 means the identity is no longer accepted (expired early,
            // signing key rotated). That call fails; the next one signs in
            // again instead of failing until a restart.
            fetch: async (input, init) => {
              const res = await fetch(input, init);
              if (res.status === 401 && client === fresh) expiresAt = 0;
              return res;
            },
          },
        },
      );
      client = fresh;
      session = me;
      expiresAt = expiresAtSeconds * 1000;
      return { db: fresh, me };
    })
    .finally(() => {
      signingIn = undefined;
    });
  return signingIn;
}

const server = new McpServer({ name: "hive-mind", version: "0.1.0" });

// The tools that work the same over any connection live in tools.ts.
registerTools(server, db);

// The folder this server may read files from. It is a guard on the local disk,
// not a hive permission: without it, a note that fools the agent could have any
// file on the machine copied into the hive.
const FILES_ROOT = process.env.HIVE_FILES_ROOT || process.cwd();
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".json": "application/json",
  ".zip": "application/zip",
};
// One safe path segment: letters, digits, dot, dash, underscore; never hidden.
const segment = (s: string) =>
  s
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");

server.tool(
  "hive_save_file",
  "Save a file you produced (PDF, document, spreadsheet, image) into the hive under outputs/<type>/<customer>/. The file must be inside the folder you are working in. It is private unless attached to a note the person has shared.",
  {
    local_path: z
      .string()
      .min(1)
      .describe("Path of the file on this machine, inside the working folder"),
    type: z.string().min(1).describe("Kind of deliverable, e.g. proposal"),
    customer: z.string().min(1).describe("Client or project it is for"),
    name: z
      .string()
      .optional()
      .describe("File name to store it under; defaults to the local name"),
    note_path: z
      .string()
      .optional()
      .describe("A note in your workspace to attach the file to"),
    references: z
      .array(z.string().min(1))
      .max(20)
      .optional()
      .describe("Other notes in your workspace that mention this file"),
  },
  async ({ local_path, type, customer, name, note_path, references }) => {
    let root: string, file: string;
    try {
      root = await realpath(FILES_ROOT);
      file = await realpath(resolve(root, local_path));
    } catch {
      return fail(`No file at ${local_path}.`);
    }
    const rel = relative(root, file);
    if (!rel || rel.startsWith("..") || isAbsolute(rel))
      return fail(`${local_path} is outside the working folder ${root}.`);
    if (rel.split(sep).some((part) => part.startsWith(".")))
      return fail("Hidden files and folders cannot be saved to the hive.");
    const info = await stat(file);
    if (!info.isFile()) return fail(`${local_path} is not a file.`);
    if (info.size > MAX_FILE_BYTES)
      return fail(`${local_path} is larger than 50 MB.`);

    const parts = [type, customer, name ?? basename(file)].map(segment);
    if (parts.some((p) => !p))
      return fail("The type, customer and file name must contain letters.");
    const hivePath = `outputs/${parts.join("/")}`;

    const { db: s, me } = await db();
    let noteId: string | null = null;
    if (note_path) {
      const note = await s
        .from("notes")
        .select("id")
        .eq("workspace_id", me.workspace_id)
        .eq("path", note_path)
        .maybeSingle();
      if (note.error) return fail(note.error.message);
      if (!note.data) return fail(`No note at ${note_path}.`);
      noteId = note.data.id;
    }

    const storagePath = `${me.member_id}/${me.workspace_id}/${hivePath}`;
    const mime =
      MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
    const up = await s.storage
      .from("files")
      .upload(storagePath, await readFile(file), {
        contentType: mime,
        upsert: false,
      });
    if (up.error)
      return fail(
        /exist|duplicate/i.test(up.error.message)
          ? `A file is already saved at ${hivePath}. Give it another name.`
          : `Upload failed: ${up.error.message}`,
      );

    const row = await s
      .from("files")
      .insert({
        hive_id: me.hive_id,
        member_id: me.member_id,
        workspace_id: me.workspace_id,
        note_id: noteId,
        storage_path: storagePath,
        name: parts[2],
        mime,
        size_bytes: info.size,
      })
      .select("id, session_id, sessions(title)")
      .single();
    if (row.error)
      return fail(
        `The file was uploaded to ${hivePath} but could not be recorded: ${row.error.message}`,
      );
    const saved = row.data as { id: string };
    let refNote = "";
    for (const p of references ?? []) {
      const n = await s
        .from("notes")
        .select("id")
        .eq("workspace_id", me.workspace_id)
        .eq("path", p)
        .maybeSingle();
      if (n.error || !n.data) {
        refNote += ` No note at ${p}, so no reference from it.`;
        continue;
      }
      const r = await s
        .from("file_references")
        .insert({ file_id: saved.id, note_id: n.data.id });
      if (r.error) refNote += ` Could not reference it from ${p}.`;
    }
    return done(
      `Saved ${hivePath}` +
        (note_path ? `, attached to ${note_path}.` : ".") +
        " It belongs to your current session; close the session with hive_end_session when the work is done." +
        refNote,
    );
  },
);

await db();
await server.connect(new StdioServerTransport());
