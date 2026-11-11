import { NextRequest, NextResponse } from "next/server";
import { checkApiAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

function getRestBase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { base: `${url}/rest/v1`, key };
}

function restHeaders(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

export async function GET(req: NextRequest) {
  const denied = await checkApiAuth(req);
  if (denied) return denied;

  const cfg = getRestBase();
  if (!cfg) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const status = req.nextUrl.searchParams.get("status");
  let url = `${cfg.base}/slack_tasks?select=*&order=created_at.desc.nullslast`;
  if (status) url += `&status=eq.${encodeURIComponent(status)}`;

  const res = await fetch(url, { headers: restHeaders(cfg.key), cache: "no-store" });
  const data = await res.json();
  if (!res.ok) {
    console.error("[/api/tasks] REST error:", data);
    return NextResponse.json({ error: data?.message ?? "Supabase error", code: data?.code }, { status: 500 });
  }

  return NextResponse.json({ tasks: Array.isArray(data) ? data : [] });
}
