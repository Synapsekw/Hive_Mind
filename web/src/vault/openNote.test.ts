import { describe, expect, it } from "vitest";
import { fixtureVault } from "./fixture";
import { noteOfClick, openFrom, reduceOpen, type OpenState } from "./openNote";
import type { VaultData } from "./types";

const DATA = fixtureVault(0);
const [A, B] = DATA.notes;
const openOf = (id: string): VaultData["open"] =>
  fixtureVault(0, { note: id }).open;

const start = (): OpenState => openFrom(openOf(A!.id));

describe("reduceOpen", () => {
  it("starts from the served note", () => {
    expect(start()).toMatchObject({
      seq: 0,
      wanted: A!.id,
      pending: false,
      failed: false,
    });
    expect(openFrom(null).wanted).toBeNull();
    expect(openFrom({ missing: true }).wanted).toBeNull();
  });

  it("keeps the shown note while a request is on its way", () => {
    const s = reduceOpen(start(), { type: "request", id: B!.id, seq: 1 });
    expect(s).toMatchObject({ seq: 1, wanted: B!.id, pending: true });
    expect(s.open).toEqual(start().open);
  });

  it("shows the answer to the latest request, and clears pending and failed", () => {
    let s = reduceOpen(start(), { type: "request", id: B!.id, seq: 1 });
    s = { ...s, failed: true };
    s = reduceOpen(s, {
      type: "answer",
      seq: 1,
      result: { ok: true, open: openOf(B!.id) },
    });
    expect(s).toMatchObject({ pending: false, failed: false, wanted: B!.id });
    expect(s.open).toEqual(openOf(B!.id));
  });

  it("ignores an answer to an older request", () => {
    let s = reduceOpen(start(), { type: "request", id: B!.id, seq: 1 });
    s = reduceOpen(s, { type: "request", id: A!.id, seq: 2 });
    const after = reduceOpen(s, {
      type: "answer",
      seq: 1,
      result: { ok: true, open: openOf(B!.id) },
    });
    expect(after).toBe(s);
  });

  it("closes the preview without waiting on a request for no note", () => {
    const s = reduceOpen(start(), { type: "request", id: null, seq: 3 });
    expect(s).toEqual({
      seq: 3,
      wanted: null,
      open: null,
      pending: false,
      failed: false,
    });
  });

  it("keeps the previous note and says it failed when the answer is not ok", () => {
    let s = reduceOpen(start(), { type: "request", id: B!.id, seq: 1 });
    s = reduceOpen(s, { type: "answer", seq: 1, result: { ok: false } });
    expect(s).toMatchObject({ pending: false, failed: true });
    expect(s.open).toEqual(start().open);
  });

  it("takes a served note that matches the request, and drops the late answer", () => {
    let s = reduceOpen(start(), { type: "request", id: B!.id, seq: 1 });
    const fresh = openOf(B!.id);
    s = reduceOpen(s, { type: "served", open: fresh });
    expect(s).toMatchObject({ pending: false, wanted: B!.id });
    expect(s.open).toBe(fresh);
    expect(
      reduceOpen(s, {
        type: "answer",
        seq: 1,
        result: { ok: true, open: { missing: true } },
      }),
    ).toBe(s);
  });

  it("ignores a served note other than the one on its way", () => {
    const s = reduceOpen(start(), { type: "request", id: B!.id, seq: 1 });
    expect(reduceOpen(s, { type: "served", open: openOf(A!.id) })).toBe(s);
  });

  it("takes whatever is served when nothing is on its way, a closed note too", () => {
    const s = reduceOpen(start(), { type: "served", open: null });
    expect(s).toMatchObject({ open: null, failed: false });
    // The note asked for is still known: a delete of it may be finishing.
    expect(s.wanted).toBe(A!.id);
    const b = reduceOpen(s, { type: "served", open: openOf(B!.id) });
    expect(b.wanted).toBe(B!.id);
  });
});

describe("noteOfClick", () => {
  const here = {
    href: "http://localhost/vault?ws=w1",
    pathname: "/vault",
  };
  const plain = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };
  const link = (href: string, target = "", download = false) => ({
    href,
    target,
    hasAttribute: (n: string) => n === "download" && download,
  });

  it("answers the note of a plain click on a link to this screen", () => {
    expect(noteOfClick(plain, link("/vault?ws=w1&note=n1"), here)).toBe("n1");
    expect(
      noteOfClick(plain, link("http://localhost/vault?note=n2"), here),
    ).toBe("n2");
  });

  it("leaves modifier clicks, other buttons and other targets to the browser", () => {
    for (const k of ["metaKey", "ctrlKey", "shiftKey", "altKey"])
      expect(
        noteOfClick({ ...plain, [k]: true }, link("/vault?note=n1"), here),
      ).toBeNull();
    expect(
      noteOfClick({ ...plain, button: 1 }, link("/vault?note=n1"), here),
    ).toBeNull();
    expect(
      noteOfClick(plain, link("/vault?note=n1", "_blank"), here),
    ).toBeNull();
    expect(
      noteOfClick(plain, link("/vault?note=n1", "", true), here),
    ).toBeNull();
  });

  it("leaves links elsewhere, and links with no note, alone", () => {
    expect(noteOfClick(plain, link("/map?note=n1"), here)).toBeNull();
    expect(
      noteOfClick(plain, link("http://evil.test/vault?note=n1"), here),
    ).toBeNull();
    expect(noteOfClick(plain, link("/vault?ws=w2"), here)).toBeNull();
  });
});
