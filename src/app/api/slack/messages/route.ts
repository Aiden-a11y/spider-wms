import { NextRequest, NextResponse } from "next/server";
import { checkApiAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type SlackRawMsg = {
  type: string;
  text: string;
  ts: string;
  thread_ts?: string;
  reply_count?: number;
  user?: string;
  bot_id?: string;
  subtype?: string;
};

export async function GET(req: NextRequest) {
  const denied = await checkApiAuth(req);
  if (denied) return denied;

  const token = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_DM_CHANNEL_ID;

  if (!token || !channelId) {
    return NextResponse.json({ error: "SLACK_BOT_TOKEN or SLACK_DM_CHANNEL_ID not configured" }, { status: 500 });
  }

  const limit = req.nextUrl.searchParams.get("limit") ?? "50";
  const oldest = req.nextUrl.searchParams.get("oldest");

  // Fetch main channel messages
  const histUrl = new URL("https://slack.com/api/conversations.history");
  histUrl.searchParams.set("channel", channelId);
  histUrl.searchParams.set("limit", limit);
  if (oldest) histUrl.searchParams.set("oldest", oldest);

  const histRes = await fetch(histUrl.toString(),
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  const hist = await histRes.json();
  if (!hist.ok) {
    return NextResponse.json({ error: hist.error ?? "Slack API error" }, { status: 502 });
  }

  const rawMessages = (hist.messages as SlackRawMsg[]).filter(
    (m) => m.type === "message" && m.text && m.subtype !== "channel_join"
  );

  // Fetch thread replies for messages that have them
  const threadParents = rawMessages.filter((m) => m.reply_count && m.reply_count > 0);
  const threadRepliesMap: Record<string, SlackRawMsg[]> = {};

  await Promise.all(
    threadParents.map(async (parent) => {
      try {
        const r = await fetch(
          `https://slack.com/api/conversations.replies?channel=${channelId}&ts=${parent.ts}&limit=50`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
        );
        const data = await r.json();
        if (data.ok && data.messages?.length > 1) {
          // Skip first message (it's the parent), get only replies
          threadRepliesMap[parent.ts] = (data.messages as SlackRawMsg[]).slice(1);
        }
      } catch {}
    })
  );

  // Collect all unique user IDs
  const allMsgs = [
    ...rawMessages,
    ...Object.values(threadRepliesMap).flat(),
  ];
  const userIds = Array.from(new Set<string>(
    allMsgs.map((m) => m.user).filter(Boolean) as string[]
  ));

  const userNames: Record<string, string> = {};
  await Promise.all(
    userIds.map(async (uid) => {
      try {
        const r = await fetch(`https://slack.com/api/users.info?user=${uid}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = await r.json();
        if (data.ok) {
          userNames[uid] = data.user.profile?.display_name || data.user.real_name || uid;
        }
      } catch {
        userNames[uid] = uid;
      }
    })
  );

  // Resolve self user ID
  let selfUserId = "";
  try {
    const authRes = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const authData = await authRes.json();
    if (authData.ok) selfUserId = authData.user_id;
  } catch {}

  function mapMsg(m: SlackRawMsg, isThread = false, parentTs?: string) {
    return {
      text: m.text,
      ts: m.ts,
      userName: m.user ? (userNames[m.user] ?? m.user) : "Bot",
      isSelf: m.user === selfUserId || !!m.bot_id,
      isThread,
      parentTs,
      replyCount: m.reply_count ?? 0,
    };
  }

  // Build ordered list: main messages (oldest first) with thread replies after each parent
  const ordered = rawMessages
    .slice()
    .reverse() // oldest first
    .flatMap((m) => {
      const main = mapMsg(m, false);
      const replies = (threadRepliesMap[m.ts] ?? []).map((r) =>
        mapMsg(r, true, m.ts)
      );
      return [main, ...replies];
    });

  return NextResponse.json({ messages: ordered });
}
