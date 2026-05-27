import { NextRequest, NextResponse } from "next/server";

const WMS_BASE = "https://us-wms-api.stload.com/api";

async function handler(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join("/");
  const search = req.nextUrl.search;
  const url = `${WMS_BASE}/${path}${search}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const auth = req.headers.get("authorization");
  if (auth) headers["Authorization"] = auth;

  // Forward cookies so WMS server-side sessions are preserved
  // (e.g. the location selected via location-search is stored in the WMS session)
  const cookie = req.headers.get("cookie");
  if (cookie) headers["Cookie"] = cookie;

  // Forward any WMS-specific session headers the client may have stored
  const wmsSession = req.headers.get("x-wms-session");
  if (wmsSession) headers["X-Wms-Session"] = wmsSession;

  const body = req.method !== "GET" && req.method !== "HEAD"
    ? await req.text()
    : undefined;

  const upstream = await fetch(url, {
    method: req.method,
    headers,
    body,
  });

  const data = await upstream.text();

  const response = new NextResponse(data, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });

  // Forward Set-Cookie so the browser stores the WMS session cookie
  const setCookie = upstream.headers.get("set-cookie");
  if (setCookie) {
    response.headers.set("Set-Cookie", setCookie);
  }

  return response;
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
