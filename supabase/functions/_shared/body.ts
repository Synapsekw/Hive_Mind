// A request's body as text, or the status to refuse it with. The cap is on the bytes actually
// read; Content-Length is only a way to refuse sooner. Web platform only.
export async function readBody(
  req: Request,
  max: number,
): Promise<string | 400 | 413> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > max) return 413;
  if (req.body === null) return 400;

  const reader = req.body.getReader();
  const bytes = new Uint8Array(max);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > max) {
        await reader.cancel().catch(() => {});
        return 413;
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, length),
    );
  } catch {
    return 400;
  }
}
