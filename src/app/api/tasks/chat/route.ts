import { NextRequest, NextResponse } from "next/server";
import { checkApiAuth } from "@/lib/api-auth";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const denied = await checkApiAuth(req);
  if (denied) return denied;

  const body = await req.json();
  const { question } = body;
  if (!question) return NextResponse.json({ error: "question required" }, { status: 400 });

  // Fetch current tasks for context
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let taskContext = "";
  if (url && key) {
    const db = createClient(url, key);
    const { data } = await db
      .from("slack_tasks")
      .select("task_text, status, created_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (data?.length) {
      const pending = data.filter((t) => t.status === "pending");
      const done = data.filter((t) => t.status === "done");
      taskContext = `현재 업무 현황:
- 미완료 업무 (${pending.length}개):
${pending.map((t, i) => `  ${i + 1}. ${t.task_text} (등록: ${t.created_at?.slice(0, 10)})`).join("\n")}
- 완료된 업무 (${done.length}개):
${done.map((t, i) => `  ${i + 1}. ${t.task_text} (완료: ${t.completed_at?.slice(0, 10) ?? "-"})`).join("\n")}`;
    }
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `당신은 Slack DM 기반 업무 관리 어시스턴트입니다. 사용자의 업무 목록을 바탕으로 질문에 답변해주세요. 간결하고 실용적으로 답변해주세요.`,
    messages: [
      {
        role: "user",
        content: taskContext ? `${taskContext}\n\n질문: ${question}` : question,
      },
    ],
  });

  const answer = response.content[0].type === "text" ? response.content[0].text : "";
  return NextResponse.json({ answer });
}
