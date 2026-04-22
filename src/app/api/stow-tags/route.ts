import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis";
import type { PersistedStowTag } from "@/lib/stow-tags";

const HASH_KEY = "stow_tags";

// GET /api/stow-tags?pending=true
export async function GET(req: NextRequest) {
  try {
    const pendingOnly = req.nextUrl.searchParams.get("pending") === "true";
    const raw = await redis.hgetall(HASH_KEY);

    if (!raw) return NextResponse.json([]);

    const tags: PersistedStowTag[] = Object.values(raw).map((v) =>
      typeof v === "string" ? JSON.parse(v) : (v as PersistedStowTag)
    );

    const result = pendingOnly ? tags.filter((t) => !t.stowedAt) : tags;
    // Sort by id (creation time) ascending
    result.sort((a, b) => a.id - b.id);

    return NextResponse.json(result);
  } catch (e) {
    console.error("GET /api/stow-tags", e);
    return NextResponse.json({ error: "Failed to fetch stow tags" }, { status: 500 });
  }
}

// POST /api/stow-tags  body: PersistedStowTag
export async function POST(req: NextRequest) {
  try {
    const tag: PersistedStowTag = await req.json();
    await redis.hset(HASH_KEY, { [String(tag.id)]: JSON.stringify(tag) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("POST /api/stow-tags", e);
    return NextResponse.json({ error: "Failed to save stow tag" }, { status: 500 });
  }
}
