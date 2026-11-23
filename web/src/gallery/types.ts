// Shapes shared by the gallery screen, its loader and its actions. The database decides which
// files a person may read and delete; these only carry what it returned. A file's place in
// storage is not here on purpose: it never leaves the server.
export type Kind = "image" | "pdf" | "slides" | "sheet" | "doc" | "other";
export type Sharing = "private" | "through-note" | "shared-with-me";
export type Tab = "mine" | "shared" | "all";
export type GalleryFile = {
  id: string;
  name: string;
  kind: Kind;
  size: number; // bytes; 0 when unknown
  created_at: string; // ISO
  owner: string; // display name
  mine: boolean;
  note: { id: string; title: string } | null; // only a note the caller may read
  sharing: Sharing;
  thumb: string | null; // signed link, images up to 2 MB only
};
export type Cursor = { created_at: string; id: string };
export type GalleryPage = { files: GalleryFile[]; next: Cursor | null };
export type GalleryData = GalleryPage; // first page
export type Result = { ok: true } | { ok: false };
export type GalleryActions = {
  openFile(id: string): Promise<{ url: string; kind: Kind } | null>;
  downloadFile(id: string): Promise<{ url: string } | null>;
  deleteFile(id: string): Promise<Result>;
  loadMore(cursor: Cursor): Promise<GalleryPage | null>;
};
