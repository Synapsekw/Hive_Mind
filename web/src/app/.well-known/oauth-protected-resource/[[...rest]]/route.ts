// The document an app reads after `/mcp` answers 401: which address is protected and which
// server signs people in. It is public and holds nothing secret. Apps ask for it at the bare
// path or with the resource's own path appended (`/mcp`); both answer the same.
import { siteOrigin } from "../../../mcp/origin";

// The site's address is read from the request, so never prerendered.
export const dynamic = "force-dynamic";

const notFound = () => new Response(null, { status: 404 });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ rest?: string[] }> },
): Promise<Response> {
  const { rest } = await params;
  const path = rest ?? [];
  if (!(path.length === 0 || (path.length === 1 && path[0] === "mcp")))
    return notFound();

  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabase) return notFound();

  return new Response(
    JSON.stringify({
      resource: `${siteOrigin(request)}/mcp`,
      authorization_servers: [`${supabase.replace(/\/+$/, "")}/auth/v1`],
      bearer_methods_supported: ["header"],
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        // The address inside comes from this request; no shared cache may hand it to another.
        "cache-control": "no-store",
      },
    },
  );
}
