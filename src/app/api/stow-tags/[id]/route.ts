import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis";
import type { PersistedStowTag } from "@/lib/stow-tags";

const HASH_KEY = "stow_tags";

// PATCH /api/stow-tags/[id]  — mark tag as stowed
export async function PATCH(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const raw = await redis.hget(HASH_KEY, params.id);
    if (!raw) return NextResponse.json({ error: "Tag not found" }, { status: 404 });

    const tag: PersistedStowTag =
      typeof raw === "string" ? JSON.parse(raw) : (raw as PersistedStowTag);

    tag.stowedAt = new Date().toISOString();
    await redis.hset(HASH_KEY, { [params.id]: JSON.stringify(tag) });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("PATCH /api/stow-tags/[id]", e);
    return NextResponse.json({ error: "Failed to update stow tag" }, { status: 500 });
  }
}
