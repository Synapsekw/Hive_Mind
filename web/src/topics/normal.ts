// One form of a name for comparing: lower case, no accents, and every run of anything that is
// not a letter, a digit, & or + as one space. "Zain DragonFly", "zain-dragonfly" and
// "ZAIN_dragonfly" are the same name.
export function normal(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&+]+/gu, " ")
    .trim();
}
