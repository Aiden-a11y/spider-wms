import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const WMS_BASE = "https://us-wms-api.stload.com/api";

async function wmsGet(path: string, token: string) {
  const res = await fetch(`${WMS_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function wmsPost(path: string, token: string, body: unknown) {
  const res = await fetch(`${WMS_BASE}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const secret = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Supabase env vars missing" }, { status: 500 });
  }
  const sb = createClient(supabaseUrl, supabaseKey);

  const userId = process.env.WMS_USER_ID;
  const password = process.env.WMS_PASSWORD;
  if (!userId || !password) {
    return NextResponse.json({ error: "WMS credentials missing" }, { status: 500 });
  }

  // 1. Login
  const loginRes = await fetch(`${WMS_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, password, clientId: "wms_web" }),
  });
  if (!loginRes.ok) {
    const err = await loginRes.json().catch(() => ({}));
    return NextResponse.json({ error: `Login failed: ${err?.message ?? loginRes.status}` }, { status: 500 });
  }
  const loginJson = await loginRes.json();
  const token =
    loginJson?.data?.token ??
    loginJson?.data?.accessToken ??
    loginJson?.token ??
    loginJson?.accessToken;
  if (!token) {
    return NextResponse.json({ error: "Token not found in login response" }, { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10);
  let totalInserted = 0;
  const errors: string[] = [];
  const debug: string[] = [];

  // 2. Get warehouses
  const whJson = await wmsGet("combo/warehouse", token);
  const warehouses: { id: string; name: string }[] = Array.isArray(whJson?.data)
    ? whJson.data
    : Array.isArray(whJson)
    ? whJson
    : [];

  for (const wh of warehouses) {
    const whCode = wh.id;
    try {
      // 3. Get customers for this warehouse
      const custJson = await wmsGet(`combo/customer-by-warehouse/${whCode}`, token);
      const customers: { code: string; name: string }[] = Array.isArray(custJson?.data)
        ? custJson.data
        : Array.isArray(custJson)
        ? custJson
        : [];

      for (const cust of customers) {
        try {
          // 4. Get SKU list
          const skuJson = await wmsPost("product/list", token, {
            warehouseCode: whCode,
            customerCode: cust.code,
            page: 1,
            size: 9999,
          });
          const skuList: string[] = (
            Array.isArray(skuJson?.data?.list)
              ? skuJson.data.list
              : Array.isArray(skuJson?.data)
              ? skuJson.data
              : []
          ).map((p: Record<string, unknown>) => String(p.productSku ?? p.sku ?? p.code ?? "")).filter(Boolean);

          const rows: Record<string, unknown>[] = [];

          for (const sku of skuList) {
            try {
              const invJson = await wmsPost("inventory/detail", token, {
                warehouseCode: whCode,
                customerCode: cust.code,
                productSku: sku,
              });
              const items: Record<string, unknown>[] = Array.isArray(invJson?.data)
                ? invJson.data
                : [];

              for (const item of items) {
                const zone = String(item.zoneName ?? item.zone ?? "");
                const aisle = String(item.aisleName ?? item.aisle ?? "");
                const bay = String(item.bayName ?? item.bay ?? "");
                const level = String(item.levelName ?? item.level ?? "");
                const position = String(item.positionName ?? item.position ?? "");
                const location = [zone, aisle, bay, level, position].filter(Boolean).join("-");

                rows.push({
                  captured_date: today,
                  warehouse_code: whCode,
                  customer_code: cust.code,
                  location,
                  sku: String(item.productSku ?? item.sku ?? sku),
                  product_name: String(item.productName ?? item.itemName ?? "") || null,
                  qty: Number(item.qty ?? item.quantity ?? item.onHandQty ?? 0),
                  available_qty: item.availableQty != null ? Number(item.availableQty) : null,
                  lot: String(item.lotNo ?? item.lot ?? "") || null,
                  expire_date: String(item.expireDate ?? item.expiryDate ?? "") || null,
                });
              }
            } catch (e) {
              errors.push(`${whCode}/${cust.code}/${sku}: ${(e as Error).message}`);
            }
          }

          if (rows.length > 0) {
            // Delete existing rows for today before inserting (idempotent)
            await sb
              .from("inventory_history")
              .delete()
              .eq("captured_date", today)
              .eq("warehouse_code", whCode)
              .eq("customer_code", cust.code);

            // Batch insert in chunks of 500
            for (let i = 0; i < rows.length; i += 500) {
              const chunk = rows.slice(i, i + 500);
              const { error: insertErr } = await sb.from("inventory_history").insert(chunk);
              if (insertErr) {
                errors.push(`insert ${whCode}/${cust.code}: ${insertErr.message}`);
              } else {
                totalInserted += chunk.length;
              }
            }
          }
        } catch (e) {
          errors.push(`${whCode}/${cust.code}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      errors.push(`${whCode}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    date: today,
    inserted: totalInserted,
    warehouses: warehouses.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
