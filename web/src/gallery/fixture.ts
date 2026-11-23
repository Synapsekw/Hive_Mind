// A deterministic sample gallery for the dev page and the tests: 14 files of three people on the
// first page and 4 older ones behind "Load more". Every kind is there, along with the edges the
// screen has to show: a PDF too large for the viewer, an image too large for a thumbnail, an SVG
// (which is `other`), a file of unknown size. Dates are relative to `now`; nothing is random.
//
// `kind` is worked out from the name and the declared type the way the loader does it, and
// thumbnails are 1 × 1 PNG data links, so nothing here needs storage or the network.
import { fileKind, THUMB_MAX } from "./kind";
import type { GalleryData, GalleryFile, GalleryPage, Sharing } from "./types";

const HOUR = 3_600_000;
const KB = 1024;
const MB = 1024 * 1024;

const OWNERS = { me: "Danijel", ahmed: "Ahmed", sara: "Sara" } as const;
type Owner = keyof typeof OWNERS;

/** One pixel each, in a few quiet tones, so neighbouring thumbnails differ. */
const PIXELS = [
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOomrQAAAM2Aa03DvZDAAAAAElFTkSuQmCC",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPY0JsHAAOcAaz46HpeAAAAAElFTkSuQmCC",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPI6SkBAALUAW2FT4TWAAAAAElFTkSuQmCC",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOY1rACAANuAb9PnGprAAAAAElFTkSuQmCC",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4sqoCAAQcAeeTJdgHAAAAAElFTkSuQmCC",
].map((data) => `data:image/png;base64,${data}`);

const NOTES = {
  harbour: {
    id: "00000000-0000-4000-8000-000000000d01",
    title: "Harbour Logistics proposal",
  },
  siteVisit: {
    id: "00000000-0000-4000-8000-000000000d02",
    title: "Site visit, 18 November",
  },
  northwindDraft: {
    id: "00000000-0000-4000-8000-000000000d03",
    title: "Northwind renewal, draft terms",
  },
  pricing: {
    id: "00000000-0000-4000-8000-000000000d04",
    title: "Pricing 2026",
  },
  northwind: {
    id: "00000000-0000-4000-8000-000000000d05",
    title: "Northwind renewal",
  },
  leads: {
    id: "00000000-0000-4000-8000-000000000d06",
    title: "Lead review, November",
  },
} as const;

type Row = {
  name: string;
  mime: string;
  size: number;
  hoursAgo: number;
  owner: Owner;
  note?: keyof typeof NOTES;
  /** For the caller's own file: whether its note is shared with a group or the hive. */
  noteShared?: boolean;
};

const PDF = "application/pdf";
const PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Newest first.
const FIRST: Row[] = [
  {
    name: "site-photo-north-elevation.png",
    mime: "image/png",
    size: 482 * KB,
    hoursAgo: 2,
    owner: "me",
    note: "siteVisit",
    noteShared: true,
  },
  {
    name: "Proposal - Harbour Logistics v3.pdf",
    mime: PDF,
    size: 1_258_291,
    hoursAgo: 5,
    owner: "me",
    note: "harbour",
    noteShared: true,
  },
  {
    name: "Kickoff deck - Harbour Logistics.pptx",
    mime: PPTX,
    size: 6.4 * MB,
    hoursAgo: 9,
    owner: "me",
  },
  {
    name: "Pricing sheet 2026.xlsx",
    mime: XLSX,
    size: 348_160,
    hoursAgo: 21,
    owner: "ahmed",
    note: "pricing",
  },
  {
    name: "site-photo-loading-bay.jpg",
    mime: "image/jpeg",
    size: 1.6 * MB,
    hoursAgo: 26,
    owner: "sara",
    note: "siteVisit",
  },
  {
    name: "Statement of work - Northwind.docx",
    mime: DOCX,
    size: 84 * KB,
    hoursAgo: 30,
    owner: "me",
    note: "northwindDraft",
  },
  {
    name: "Site survey - full scan.pdf",
    mime: PDF,
    size: 31 * MB,
    hoursAgo: 49,
    owner: "me",
  },
  {
    name: "leads-export-november.csv",
    mime: "text/csv",
    size: 12 * KB,
    hoursAgo: 53,
    owner: "ahmed",
    note: "leads",
  },
  {
    name: "kickoff-meeting-notes.md",
    mime: "text/markdown",
    size: 512,
    hoursAgo: 74,
    owner: "me",
    note: "harbour",
    noteShared: true,
  },
  {
    name: "brand-assets.zip",
    mime: "application/zip",
    size: 18.2 * MB,
    hoursAgo: 98,
    owner: "me",
  },
  {
    name: "floor-plan-level-2.webp",
    mime: "image/webp",
    size: 3.4 * MB,
    hoursAgo: 122,
    owner: "me",
    note: "siteVisit",
    noteShared: true,
  },
  {
    name: "Proposal - Northwind renewal.pdf",
    mime: PDF,
    size: 940 * KB,
    hoursAgo: 170,
    owner: "sara",
    note: "northwind",
  },
  {
    name: "process-diagram.svg",
    mime: "image/svg+xml",
    size: 38 * KB,
    hoursAgo: 218,
    owner: "ahmed",
    note: "pricing",
  },
  {
    name: "team-photo-offsite.jpeg",
    mime: "image/jpeg",
    size: 1.1 * MB,
    hoursAgo: 290,
    owner: "me",
  },
];

const MORE: Row[] = [
  {
    name: "Quarterly report Q3.pdf",
    mime: PDF,
    size: 2.3 * MB,
    hoursAgo: 720,
    owner: "me",
  },
  {
    name: "site-photo-entrance.png",
    mime: "image/png",
    size: 760 * KB,
    hoursAgo: 890,
    owner: "sara",
    note: "siteVisit",
  },
  {
    name: "Budget 2025.xlsx",
    mime: XLSX,
    size: 96 * KB,
    hoursAgo: 9_600, // more than a year back, so its date carries the year
    owner: "me",
  },
  {
    name: "handover-readme.txt",
    mime: "text/plain",
    size: 0, // unknown
    hoursAgo: 9_700,
    owner: "ahmed",
    note: "pricing",
  },
];

function sharingOf(row: Row): Sharing {
  if (row.owner !== "me") return "shared-with-me";
  return row.note && row.noteShared ? "through-note" : "private";
}

/** `offset` keeps ids and thumbnails distinct between the first page and the rest. */
function build(rows: Row[], now: number, offset: number): GalleryFile[] {
  return rows.map((row, i) => {
    const n = offset + i + 1;
    const kind = fileKind(row.name, row.mime);
    const size = Math.round(row.size);
    return {
      id: `00000000-0000-4000-8000-000000000f${String(n).padStart(2, "0")}`,
      name: row.name,
      kind,
      size,
      created_at: new Date(now - row.hoursAgo * HOUR).toISOString(),
      owner: OWNERS[row.owner],
      mine: row.owner === "me",
      note: row.note ? { ...NOTES[row.note] } : null,
      sharing: sharingOf(row),
      thumb:
        kind === "image" && size <= THUMB_MAX
          ? PIXELS[n % PIXELS.length]!
          : null,
    };
  });
}

/** The first page: 14 files, with more to come. */
export function fixtureGallery(now: number): GalleryData {
  const files = build(FIRST, now, 0);
  const last = files[files.length - 1]!;
  return { files, next: { created_at: last.created_at, id: last.id } };
}

/** What "Load more" brings: 4 older files, and the end of the list. */
export function fixtureMore(now: number): GalleryPage {
  return { files: build(MORE, now, FIRST.length), next: null };
}
