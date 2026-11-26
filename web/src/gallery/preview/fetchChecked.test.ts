import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchChecked } from "./fetchChecked";

const answer = (body: BlobPart, type: string, status = 200) =>
  vi.fn(
    async () =>
      new Response(new Blob([body], { type }), {
        status,
        headers: { "content-type": type },
      }),
  );

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("fetchChecked", () => {
  it("accepts a PDF whose bytes start with %PDF-", async () => {
    globalThis.fetch = answer("%PDF-1.7 rest", "application/pdf");
    const r = await fetchChecked("u", "pdf", 1000);
    expect(r.ok).toBe(true);
    expect(r.ok && r.blob.type).toBe("application/pdf");
  });
  it("refuses a 'PDF' that is a web page, whatever its declared type", async () => {
    globalThis.fetch = answer("<html><script>x</script>", "application/pdf");
    expect(await fetchChecked("u", "pdf", 1000)).toEqual({
      ok: false,
      reason: "type",
    });
  });
  it("refuses a PDF served as a web page", async () => {
    globalThis.fetch = answer("%PDF-1.7", "text/html");
    expect(await fetchChecked("u", "pdf", 1000)).toEqual({
      ok: false,
      reason: "type",
    });
  });
  it("refuses text whose response type is HTML", async () => {
    globalThis.fetch = answer("<b>x</b>", "text/html");
    expect(await fetchChecked("u", "text", 1000)).toEqual({
      ok: false,
      reason: "type",
    });
  });
  it("refuses a CSV served as SVG", async () => {
    globalThis.fetch = answer("<svg/>", "image/svg+xml");
    expect(await fetchChecked("u", "csv", 1000)).toEqual({
      ok: false,
      reason: "type",
    });
  });
  it("accepts a type with parameters", async () => {
    globalThis.fetch = answer("a,b\n1,2", "text/csv; charset=utf-8");
    expect((await fetchChecked("u", "csv", 1000)).ok).toBe(true);
  });
  it("refuses a kind that has no preview", async () => {
    globalThis.fetch = answer("x", "text/plain");
    expect(await fetchChecked("u", "slides", 1000)).toEqual({
      ok: false,
      reason: "type",
    });
  });
  it("refuses anything over the cap", async () => {
    globalThis.fetch = answer("%PDF-" + "x".repeat(2000), "application/pdf");
    expect(await fetchChecked("u", "pdf", 1000)).toEqual({
      ok: false,
      reason: "size",
    });
  });
  it("cuts text to the cap instead of refusing it", async () => {
    globalThis.fetch = answer("a".repeat(2000), "text/plain");
    const r = await fetchChecked("u", "text", 1000);
    expect(r.ok && r.blob.size).toBe(1000);
    expect(r.ok && r.blob.type).toBe("text/plain");
  });
  it("says network when the request fails or is not ok", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await fetchChecked("u", "text", 1000)).toEqual({
      ok: false,
      reason: "network",
    });
    globalThis.fetch = answer("gone", "text/plain", 404);
    expect(await fetchChecked("u", "text", 1000)).toEqual({
      ok: false,
      reason: "network",
    });
  });
  it("sends no credentials and refuses redirects", async () => {
    const f = answer("x", "text/plain");
    globalThis.fetch = f;
    await fetchChecked("u", "text", 1000);
    expect(f).toHaveBeenCalledWith(
      "u",
      expect.objectContaining({ credentials: "omit", redirect: "error" }),
    );
  });
});
