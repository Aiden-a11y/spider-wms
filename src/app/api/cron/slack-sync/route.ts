import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KV_KEY = "slack_last_ts";

async function kvGet(key: string): Promise<string | null> {
  if (!KV_URL || !KV_TOKEN) return null;
  const res = await fetch(`${KV_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const data = await res.json();
  return data?.result ?? null;
}

async function kvSet(key: string, value: string) {
  if (!KV_URL || !KV_TOKEN) return;
  await fetch(`${KV_URL}/set/${key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
}

function getRestBase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { base: `${url}/rest/v1`, key };
}

export async function GET(req: NextRequest) {
  // Vercel cron auth
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_DM_CHANNEL_ID;
  if (!token || !channelId) {
    return NextResponse.json({ error: "Slack not configured" }, { status: 500 });
  }

  // Get last processed ts from KV
  const lastTs = await kvGet(KV_KEY);

  // Fetch new messages since lastTs
  const histUrl = new URL("https://slack.com/api/conversations.history");
  histUrl.searchParams.set("channel", channelId);
  histUrl.searchParams.set("limit", "50");
  if (lastTs) histUrl.searchParams.set("oldest", lastTs);

  const histRes = await fetch(histUrl.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const hist = await histRes.json();
  if (!hist.ok) return NextResponse.json({ error: hist.error }, { status: 502 });

  const rawMessages = (hist.messages ?? []).filter(
    (m: { type: string; text: string; subtype?: string }) =>
      m.type === "message" && m.text && m.subtype !== "channel_join"
  );

  if (!rawMessages.length) {
    return NextResponse.json({ skipped: true, reason: "no new messages" });
  }

  // Resolve self user
  let selfUserId = "";
  try {
    const authData = await (
      await fetch("https://slack.com/api/auth.test", { headers: { Authorization: `Bearer ${token}` } })
    ).json();
    if (authData.ok) selfUserId = authData.user_id;
  } catch {}

  // Resolve user names
  const userIds = Array.from(new Set<string>(
    rawMessages.map((m: { user?: string }) => m.user).filter(Boolean) as string[]
  ));
  const userNames: Record<string, string> = {};
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const data = await (
          await fetch(`https://slack.com/api/users.info?user=${uid}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).json();
        if (data.ok) userNames[uid] = data.user.profile?.display_name || data.user.real_name || uid;
      } catch { userNames[uid] = uid; }
    })
  );

  const messages = rawMessages
    .slice()
    .reverse()
    .map((m: { text: string; ts: string; user?: string; bot_id?: string }) => ({
      text: m.text,
      ts: m.ts,
      userName: m.user ? (userNames[m.user] ?? m.user) : "Bot",
      isSelf: m.user === selfUserId || !!m.bot_id,
    }));

  // Extract tasks with Claude
  const convoText = messages
    .map((m: { ts: string; isSelf: boolean; userName: string; text: string }) => {
      const date = new Date(Number(m.ts.split(".")[0]) * 1000).toISOString().slice(0, 10);
      return `[${date} ${m.isSelf ? "나" : m.userName}]: ${m.text}`;
    })
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: `You are a task extraction assistant. Respond with ONLY a valid JSON array. No markdown, no code fences. Start directly with [ and end with ].`,
    messages: [{
      role: "user",
      content: `다음 Slack DM 대화에서 업무, 할 일, 처리 요청사항을 추출하세요. 단순 인사나 잡담만 제외하세요.

각 업무에서:
- group_key: 관련 고객코드/오더번호 (FCOKR, FCOUS, ULTA, B2B, FBA, LTL 등). 없으면 "기타"
- source_date: 업무 내용 안에 명시된 날짜 (예: "11/2 픽업" → 2026-11-02). 없으면 메시지 날짜. YYYY-MM-DD 형식.

JSON 배열만 반환 (마크다운 없이):
[{"task":"업무 요약","source_text":"원본 발췌 20자","group_key":"고객코드 또는 기타","source_date":"YYYY-MM-DD"}]

대화:
${convoText}`,
    }],
  });

  let tasks: Array<{ task: string; source_text: string; group_key?: string; source_date?: string }> = [];
  try {
    const rawText = response.content[0].type === "text" ? response.content[0].text : "";
    const text = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
      tasks = JSON.parse(text.slice(start, end + 1));
    }
  } catch (err) {
    console.error("[cron/slack-sync] parse error:", err);
    return NextResponse.json({ error: "Claude parse error" }, { status: 500 });
  }

  if (!tasks.length) {
    // Update lastTs even if no tasks
    const newestTs = rawMessages[0]?.ts;
    if (newestTs) await kvSet(KV_KEY, newestTs);
    return NextResponse.json({ saved: 0, reason: "no tasks extracted" });
  }

  // Save to Supabase
  const cfg = getRestBase();
  if (!cfg) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const dmUserId = channelId;
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
  const weekLabel = `${now.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;

  const rows = tasks.map((t) => ({
    dm_user_id: dmUserId,
    task_text: t.task,
    source_text: t.source_text,
    group_key: t.group_key ?? "기타",
    week_label: weekLabel,
    source_date: t.source_date ?? null,
    status: "pending",
  }));

  const insertRes = await fetch(`${cfg.base}/slack_tasks`, {
    method: "POST",
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!insertRes.ok) {
    const e = await insertRes.json().catch(() => ({}));
    console.error("[cron/slack-sync] insert error:", e);
    return NextResponse.json({ error: e?.message ?? "Insert failed" }, { status: 500 });
  }

  // Update lastTs to the newest message ts
  const newestTs = rawMessages[0]?.ts;
  if (newestTs) await kvSet(KV_KEY, newestTs);

  console.log(`[cron/slack-sync] saved ${tasks.length} tasks, lastTs=${newestTs}`);
  return NextResponse.json({ saved: tasks.length, lastTs: newestTs });
}
