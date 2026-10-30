/**
 * Auth for API routes that read Supabase with the service-role key.
 *
 * A request passes with either
 *  - the logged-in user's Spider WMS token (`Authorization: Bearer <token>`, see
 *    auth-context.tsx), checked against WMS itself — WMS answers 401 to a bad token, or
 *  - the server-to-server secret (`x-api-key: <INVENTORY_API_KEY>`), only on routes
 *    that opt in with `allowApiKey` (warehouse-3d-map's proxy uses it).
 */
import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { WMS_BASE } from "@/lib/wms";

// Tokens WMS accepted recently (by hash), so every page load isn't a WMS round trip.
const TOKEN_CACHE_MS = 5 * 60 * 1000;
const verifiedTokens = new Map<string, number>();

const sha256 = (s: string) => createHash("sha256").update(s).digest();

function apiKeyMatches(given: string) {
  const expected = process.env.INVENTORY_API_KEY;
  if (!expected) return false;
  return timingSafeEqual(sha256(given), sha256(expected));
}

async function checkWmsToken(token: string): Promise<"ok" | "invalid" | "unavailable"> {
  const key = sha256(token).toString("hex");
  const now = Date.now();
  if ((verifiedTokens.get(key) ?? 0) > now) return "ok";

  const res = await fetch(`${WMS_BASE}/combo/warehouse`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);
  if (!res || res.status >= 500) return "unavailable";
  if (!res.ok) return "invalid";

  if (verifiedTokens.size > 500) {
    verifiedTokens.forEach((until, k) => { if (until <= now) verifiedTokens.delete(k); });
  }
  verifiedTokens.set(key, now + TOKEN_CACHE_MS);
  return "ok";
}

/** Returns an error response to send back, or null when the caller is authorized. */
export async function checkApiAuth(
  req: NextRequest,
  { allowApiKey = false }: { allowApiKey?: boolean } = {}
): Promise<NextResponse | null> {
  const apiKey = req.headers.get("x-api-key");
  if (allowApiKey && apiKey && apiKeyMatches(apiKey)) return null;

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token) {
    const result = await checkWmsToken(token);
    if (result === "ok") return null;
    if (result === "unavailable") {
      return NextResponse.json({ error: "Could not verify token with WMS" }, { status: 503 });
    }
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
