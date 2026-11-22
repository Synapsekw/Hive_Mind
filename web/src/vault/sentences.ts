// The sentences that tell a person what a sharing choice will change. Copy is fixed; the numbers
// come from the database's preview and the names from the member list.
import type { Mark } from "./marks";
import type { Choice, SharePreview } from "./types";

/** "Ahmed", "Ahmed and Sara", "Ahmed, Sara and Lina". */
export function people(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const ONLY_MEMBER = "You are the only member so far.";

export function noteSentence(a: {
  choice: Choice;
  hive: string;
  hiveSize: number;
  names: string[];
  folderRule: Mark | null;
}): string {
  const { choice } = a;
  if (choice.visibility === null) {
    return `This note will follow its folder: ${a.folderRule?.label ?? "Private"}.`;
  }
  if (choice.visibility === "group") {
    return a.hiveSize <= 1
      ? `Everyone in ${a.hive} will be able to read this note. ${ONLY_MEMBER}`
      : `Everyone in ${a.hive} (${a.hiveSize} people) will be able to read this note.`;
  }
  if (choice.visibility === "members" && a.names.length > 0) {
    return `${people(a.names)} will be able to read this note.`;
  }
  return "Only you will be able to read this note, and anyone whose link to it you accepted.";
}

function tails(p: SharePreview): string {
  let s = "";
  if (p.own_setting === 1) {
    s += " 1 note with its own setting is not affected.";
  } else if (p.own_setting > 1) {
    s += ` ${p.own_setting} notes with their own setting are not affected.`;
  }
  if (p.under_nested_rule === 1) {
    s += " 1 note in a folder with its own rule is not affected.";
  } else if (p.under_nested_rule > 1) {
    s += ` ${p.under_nested_rule} notes in folders with their own rule are not affected.`;
  }
  if (p.held === 1) {
    s += " 1 held note stays hidden until you release it.";
  } else if (p.held > 1) {
    s += ` ${p.held} held notes stay hidden until you release them.`;
  }
  return s;
}

export function folderSentence(a: {
  folder: string;
  choice: Choice;
  hive: string;
  hiveSize: number;
  names: string[];
  preview: SharePreview;
}): string {
  const { folder, preview: p } = a;
  const noun = p.follows === 1 ? "note" : "notes";
  const readers = (subject: string) =>
    `${subject} will be able to read the ${p.follows} ${noun} in ${folder}, and any note added there later, including by your agent.`;
  switch (a.choice.visibility) {
    case null:
      return p.follows === 1
        ? `${folder} will have no rule of its own. Its 1 note follows the folder above, or your default setting.`
        : `${folder} will have no rule of its own. Its ${p.follows} notes follow the folder above, or your default setting.`;
    case "private":
      return `The ${p.follows} ${noun} in ${folder} will be readable only by you, and so will any note added there later. A note linked with a colleague's note stays readable to that colleague.${tails(p)}`;
    case "members":
      return `${readers(people(a.names))}${tails(p)}`;
    case "group":
      return a.hiveSize <= 1
        ? `${readers(`Everyone in ${a.hive}`)} ${ONLY_MEMBER}${tails(p)}`
        : `${readers(`Everyone in ${a.hive} (${a.hiveSize} people)`)}${tails(p)}`;
  }
}

export function releaseSentence(mark: Mark): string {
  return `This note was written by a self-hosted agent. Releasing it makes it follow its sharing setting: ${mark.label}.`;
}
