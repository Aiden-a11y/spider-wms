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

  const body = req.method !== "GET" && req.method !== "HEAD"
    ? await req.text()
    : undefined;

  const upstream = await fetch(url, {
    method: req.method,
    headers,
    body,
  });

  const data = await upstream.text();

  return new NextResponse(data, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
