// Shapes shared by the gallery screen, its loader and its actions. The database decides which
// files a person may read and delete; these only carry what it returned. A file's place in
// storage is not here on purpose: it never leaves the server.
import type React from "react";

export type Kind =
  "image" | "pdf" | "slides" | "sheet" | "doc" | "text" | "csv" | "other";
export type Scope = "all" | "mine" | "shared";
export type View = "session" | "grid";
export type DatePreset = "any" | "today" | "week" | "month" | "range";
export type Sharing = "private" | "through-note" | "shared-with-me";

export type NoteRef = { id: string; title: string };

export type GalleryFile = {
  id: string;
  name: string;
  kind: Kind;
  size: number;
  created_at: string;
  owner: string; // display name
  owner_id: string; // member id, for the Owner chip
  mine: boolean;
  note: NoteRef | null; // home note, only when the caller may read it
  sharing: Sharing;
  thumb: string | null; // signed link: images ≤ 2 MB, PDFs ≤ 5 MB
  session_id: string | null;
  refs: NoteRef[]; // notes that reference it and the caller may read
  folders: string[]; // ids of the caller's folders holding it
};

export type GallerySession = {
  id: string;
  title: string; // "Open session" while open
  agent: string; // agent_name
  started_at: string;
  ended_at: string | null;
  note: NoteRef | null;
  mine: boolean;
};

export type GalleryFolder = {
  id: string;
  name: string;
  parent_id: string | null;
};

export type Filters = {
  view: View;
  scope: Scope;
  folder: string | null;
  kinds: Kind[];
  date: DatePreset;
  from: string | null; // YYYY-MM-DD, only with date = "range"
  to: string | null;
  session: string | null;
  agent: string | null;
  owner: string | null; // member id
  q: string;
};

/** The subset of filters the server can apply on indexed columns. */
export type ServerFilter = {
  kinds: Kind[];
  session: string | null;
  owner: string | null;
  from: string | null; // ISO instant, inclusive
  to: string | null; // ISO instant, exclusive
  ids: string[] | null; // at most 200; for a folder's files not loaded yet
};

export type Cursor = { created_at: string; id: string };
export type GalleryPage = {
  files: GalleryFile[];
  sessions: GallerySession[];
  next: Cursor | null;
};
export type GalleryData = GalleryPage & {
  folders: GalleryFolder[];
  members: { id: string; name: string }[];
};
export type Result = { ok: true } | { ok: false };
export type NoteChoice = { id: string; title: string; path: string };
export type UploadStart = {
  batch: string;
  slots: ({ name: string; url: string } | null)[];
};

export type GalleryActions = {
  openFile(id: string): Promise<{ url: string; kind: Kind } | null>;
  downloadFile(id: string): Promise<{ url: string } | null>;
  deleteFile(id: string): Promise<Result>;
  loadPage(
    filter: ServerFilter,
    cursor: Cursor | null,
  ): Promise<GalleryPage | null>;
  setHome(fileId: string, noteId: string | null): Promise<Result>;
  findMyNotes(query: string): Promise<NoteChoice[]>;
  createFolder(
    name: string,
    parentId: string | null,
  ): Promise<GalleryFolder | null>;
  renameFolder(id: string, name: string): Promise<Result>;
  deleteFolder(id: string): Promise<Result>;
  addToFolder(folderId: string, fileIds: string[]): Promise<Result>;
  removeFromFolder(folderId: string, fileId: string): Promise<Result>;
  startUpload(req: {
    files: { name: string; size: number }[];
    noteId: string | null; // null: the person's private Uploads note
    folderId: string | null;
  }): Promise<UploadStart | null>;
  finishUpload(batch: string, name: string): Promise<GalleryFile | null>;
  endUpload(batch: string): Promise<Result>;
};

export type ViewerProps = {
  files: GalleryFile[]; // the current view, in order
  index: number;
  actions: Pick<GalleryActions, "openFile" | "downloadFile">;
  onMove(index: number): void;
  onClose(): void;
  aside: React.ReactNode; // the info strip (rendered by the screen)
  toolbar: React.ReactNode; // extra top-bar buttons, e.g. Add to folder
};

// Gallery v2: replaced in Task 8 (the v1 screen still loads more by cursor).
export type LegacyActions = Pick<
  GalleryActions,
  "openFile" | "downloadFile" | "deleteFile"
> & { loadMore(cursor: Cursor): Promise<GalleryPage | null> };
