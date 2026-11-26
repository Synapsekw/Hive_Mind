// A development stand-in for a signed upload link: the dev gallery's uploads PUT their bytes
// here and they are thrown away. Never served in production.
export async function PUT(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production")
    return new Response(null, { status: 404 });
  await request.arrayBuffer();
  return new Response(null, { status: 200 });
}
