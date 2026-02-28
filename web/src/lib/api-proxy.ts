import { NextRequest, NextResponse } from "next/server";

const GO_API_URL = process.env.API_URL || "http://localhost:8080";

/**
 * Proxy a Next.js API route request to the Go backend.
 * Forwards method, headers, body, and query string.
 * Returns 502 with a clear message if Go API is unreachable.
 */
export async function proxyToGoApi(
  req: NextRequest,
  backendPath?: string,
): Promise<NextResponse> {
  const path = backendPath ?? req.nextUrl.pathname;
  const search = req.nextUrl.search;
  const targetUrl = `${GO_API_URL}${path}${search}`;

  const headers: Record<string, string> = {};
  const auth = req.headers.get("authorization");
  if (auth) headers["Authorization"] = auth;
  const ct = req.headers.get("content-type");
  if (ct) headers["Content-Type"] = ct;

  const init: RequestInit = { method: req.method, headers };

  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      init.body = await req.text();
    } catch {
      // no body — fine for DELETE etc.
    }
  }

  try {
    const upstream = await fetch(targetUrl, init);
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch (err) {
    console.error(`[api-proxy] Go API unreachable at ${targetUrl}:`, err);
    return NextResponse.json(
      {
        error:
          "Backend API is unreachable. Ensure the Go API is running on port 8080.",
      },
      { status: 502 },
    );
  }
}
