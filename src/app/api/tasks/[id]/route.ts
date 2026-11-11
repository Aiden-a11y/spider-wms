import { NextRequest, NextResponse } from "next/server";
import { checkApiAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

function getCfg() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { base: `${url}/rest/v1`, key };
}

function headers(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await checkApiAuth(req);
  if (denied) return denied;

  const cfg = getCfg();
  if (!cfg) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const body = await req.json();
  const { status } = body;
  if (!["pending", "done"].includes(status)) {
    return NextResponse.json({ error: "status must be pending or done" }, { status: 400 });
  }

  const update: Record<string, unknown> = { status };
  if (status === "done") update.completed_at = new Date().toISOString();
  if (status === "pending") update.completed_at = null;

  const res = await fetch(
    `${cfg.base}/slack_tasks?id=eq.${params.id}`,
    { method: "PATCH", headers: headers(cfg.key), body: JSON.stringify(update) }
  );
  const data = await res.json();
  if (!res.ok) return NextResponse.json({ error: data?.message ?? "Update failed" }, { status: 500 });
  return NextResponse.json({ task: Array.isArray(data) ? data[0] : data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await checkApiAuth(req);
  if (denied) return denied;

  const cfg = getCfg();
  if (!cfg) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const res = await fetch(
    `${cfg.base}/slack_tasks?id=eq.${params.id}`,
    { method: "DELETE", headers: headers(cfg.key) }
  );
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    return NextResponse.json({ error: e?.message ?? "Delete failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
