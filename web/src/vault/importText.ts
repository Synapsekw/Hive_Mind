// Every sentence of the import panel. Copy is fixed; the numbers come from the picked folder
// and from what the server answered.

export const IMPORT = "Import a folder";
/** The bar's one menu of the rare ways in, and the import's line in it. */
export const ADD_NOTES = "Add notes";
export const IMPORT_LINE =
  "Markdown notes from your computer. Each arrives private.";
export const CLOSE = "Close";
export const CHOOSE = "Choose a folder";
export const CHOOSE_ANOTHER = "Choose another folder";
export const FOLDER_INPUT = "Folder to import";
export const INTRO =
  "Choose a folder of markdown notes. Each note arrives private, at its path inside the folder. Other files are left out.";
export const UNSUPPORTED =
  "This browser did not say where the files sit inside the folder, so the folder cannot be imported here. Try another browser.";
export const NO_NOTES = "There are no markdown notes in that folder.";
export const TOO_MANY =
  "That folder holds more than 2,000 notes. Choose one of its subfolders and import them one at a time.";

export const READY = "Ready to import";
export const DESTINATION = "Where the notes go";
export const NEW_WORKSPACE = "New workspace";
export const EXISTING_WORKSPACE = "Existing workspace";
export const WORKSPACE_NAME = "Workspace name";
export const WORKSPACE = "Workspace";
export const START = "Import";

export const NAME_PROBLEM = "A workspace needs a name of 1 to 60 characters.";
export const NAME_TAKEN =
  "You already have a workspace with that name. Choose it under Existing workspace, or change the name.";
export const WORKSPACE_LIMIT =
  "You already have 20 workspaces. Import into one of them.";
export const WORKSPACE_FAILED =
  "The workspace could not be made. Nothing was imported. Try again.";

export const RUNNING = "Importing";
export const STOP = "Stop";
export const STOPPING = "Stopping after this batch";
export const KEEPS = "What is already saved stays.";

export const FINISHED = "Import finished";
export const STOPPED = "Import stopped";
export const HALTED =
  "Three batches in a row could not be saved, so the import stopped. What was saved stays. Import the folder again to finish the rest.";
export const SKIPPED_PATHS = "Skipped: over 1 MB";
export const FAILED_PATHS = "Failed";
export const AGAIN =
  "Importing the same folder into the same workspace again saves only what is missing or changed.";

/** How many paths a list shows before "and N more". */
export const SHOWN = 50;

/** 1 to 60 characters after trimming. */
export const MAX_NAME = 60;

export const num = (n: number) =>
  String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const notes = (n: number) => `${num(n)} ${n === 1 ? "note" : "notes"}`;

/** The name a new workspace would get, or null when it cannot be one. */
export function workspaceName(typed: string): string | null {
  const name = typed.trim();
  return name.length >= 1 && name.length <= MAX_NAME ? name : null;
}

export const found = (n: number) => `${notes(n)} found`;

export const otherSkipped = (n: number) =>
  n === 1
    ? "1 other file left out (not markdown)"
    : `${num(n)} other files left out (not markdown)`;

export const hiddenSkipped = (n: number) =>
  n === 1
    ? "1 hidden file left out (a name that begins with a dot)"
    : `${num(n)} hidden files left out (a name that begins with a dot)`;

export const tooLargeSkipped = (n: number) =>
  n === 1 ? "1 note skipped: over 1 MB" : `${notes(n)} skipped: over 1 MB`;

/** "120 of 480 notes" */
export const progress = (done: number, total: number) =>
  `${num(done)} of ${notes(total)}`;

export const notSent = (n: number) =>
  n === 1 ? "1 note was not sent." : `${notes(n)} were not sent.`;

export const unreadFrontmatter = (n: number) =>
  n === 1
    ? "1 note had frontmatter that could not be read. It was kept as text."
    : `${notes(n)} had frontmatter that could not be read. It was kept as text.`;

export const openWorkspace = (name: string) => `Open ${name}`;

export const andMore = (n: number) => `and ${num(n)} more`;

/** The first `SHOWN` paths, and how many are left unsaid. */
export function shownPaths(paths: readonly string[]): {
  shown: string[];
  more: number;
} {
  return {
    shown: paths.slice(0, SHOWN),
    more: Math.max(0, paths.length - SHOWN),
  };
}

/** The five counts of the result, in the order they are shown. */
export function resultCounts(a: {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
}): { label: string; value: string }[] {
  return [
    { label: "Created", value: num(a.created) },
    { label: "Updated", value: num(a.updated) },
    { label: "Unchanged", value: num(a.unchanged) },
    { label: "Skipped", value: num(a.skipped) },
    { label: "Failed", value: num(a.failed) },
  ];
}
