import { NextRequest, NextResponse } from "next/server";
import { checkApiAuth } from "@/lib/api-auth";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const denied = await checkApiAuth(req);
  if (denied) return denied;

  const body = await req.json();
  const messages: Array<{ text: string; ts: string; userName: string; isSelf: boolean }> =
    body.messages ?? [];

  if (!messages.length) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  const convoText = messages
    .map((m) => {
      const date = new Date(Number(m.ts.split(".")[0]) * 1000).toISOString().slice(0, 10);
      return `[${date} ${m.isSelf ? "나" : m.userName}]: ${m.text}`;
    })
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: `You are a task extraction assistant. You MUST respond with ONLY a valid JSON array. No markdown, no code fences, no explanation text before or after the JSON. Start your response directly with [ and end with ].`,
    messages: [
      {
        role: "user",
        content: `다음 Slack DM 대화에서 업무, 할 일, 처리 요청사항을 모두 추출하세요. 완료된 것도 포함하세요. 단순 인사나 잡담만 제외하세요.

각 업무에서:
- group_key: 관련 고객코드/오더번호 (예: FCOKR, FCOUS, ULTA, B2B, FBA, LTL 등). 없으면 "기타"
- source_date: 업무 내용 안에 명시된 날짜 (예: "11/2 픽업" → 2026-11-02, "11월 5일까지" → 2026-11-05, "12/1" → 2026-12-01). 날짜가 없으면 메시지 날짜([YYYY-MM-DD ...])를 사용. 반드시 YYYY-MM-DD 형식.

반드시 JSON 배열만 반환하세요 (마크다운 없이):
[{"task":"업무 요약","source_text":"원본 발췌 20자","group_key":"고객코드 또는 기타","source_date":"YYYY-MM-DD"}]

대화:
${convoText}`,
      },
    ],
  });

  let tasks: Array<{ task: string; source_text: string; group_key?: string; source_date?: string }> = [];
  try {
    const rawText = response.content[0].type === "text" ? response.content[0].text : "";
    console.log("[/api/slack/extract] Claude response (full):", rawText);
    // Strip markdown code fences and parse JSON
    const text = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    // Find first [ to last ]
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
      const jsonStr = text.slice(start, end + 1);
      console.log("[/api/slack/extract] Parsing JSON:", jsonStr.slice(0, 200));
      tasks = JSON.parse(jsonStr);
    }
  } catch (err) {
    console.error("[/api/slack/extract] Parse error:", err);
    return NextResponse.json({ error: "Failed to parse Claude response" }, { status: 500 });
  }
  console.log("[/api/slack/extract] Extracted tasks:", tasks.length);

  if (!tasks.length) {
    return NextResponse.json({ tasks: [], saved: 0 });
  }

  // Save to Supabase via raw REST (supabase-js v2.104 incompatible with new sb_secret_ keys)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const dmUserId = process.env.SLACK_DM_CHANNEL_ID ?? "unknown";

  // Week label: YYYY-W##
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

  const insertRes = await fetch(`${supabaseUrl}/rest/v1/slack_tasks`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(rows),
  });
  const inserted = await insertRes.json();
  if (!insertRes.ok) {
    console.error("[/api/slack/extract] insert error:", inserted);
    return NextResponse.json({ error: inserted?.message ?? "Insert failed", code: inserted?.code }, { status: 500 });
  }

  return NextResponse.json({ tasks: inserted, saved: Array.isArray(inserted) ? inserted.length : 0 });
}
