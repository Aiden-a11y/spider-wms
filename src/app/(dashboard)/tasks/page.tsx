"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import {
  CheckSquare,
  Square,
  RefreshCw,
  Sparkles,
  Send,
  Trash2,
  MessageSquare,
  ClipboardList,
} from "lucide-react";

type Message = {
  text: string;
  ts: string;
  userName: string;
  isSelf: boolean;
  isThread?: boolean;
  parentTs?: string;
  replyCount?: number;
};

type Task = {
  id: string;
  task_text: string;
  status: "pending" | "done";
  source_text: string | null;
  group_key: string | null;
  week_label: string | null;
  source_date: string | null;
  created_at: string;
  completed_at: string | null;
};

type GroupMode = "week" | "group";

type ChatEntry = {
  role: "user" | "ai";
  text: string;
};

export default function TasksPage() {
  const { user } = useAuth();

  const authHeader: Record<string, string> = user?.token ? { Authorization: `Bearer ${user.token}` } : {};

  const [messages, setMessages] = useState<Message[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatEntry[]>([]);
  const [question, setQuestion] = useState("");

  const [loadingMessages, setLoadingMessages] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [groupMode, setGroupMode] = useState<GroupMode>("week");
  const [expandedDone, setExpandedDone] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    setLoadingMessages(true);
    try {
      const res = await fetch("/api/slack/messages?limit=100", { headers: authHeader });
      const data = await res.json();
      if (data.messages) setMessages(data.messages);
    } finally {
      setLoadingMessages(false);
    }
  }, [user?.token]);

  const fetchTasks = useCallback(async () => {
    const res = await fetch("/api/tasks", { headers: authHeader });
    const data = await res.json();
    if (data.tasks) setTasks(data.tasks);
  }, [user?.token]);

  useEffect(() => {
    fetchMessages();
    fetchTasks();
    const interval = setInterval(fetchTasks, 30000);
    return () => clearInterval(interval);
  }, [fetchMessages, fetchTasks]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  async function extractTasks() {
    if (!messages.length) return;
    setExtracting(true);
    try {
      const res = await fetch("/api/slack/extract", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messages.slice(-50) }),
      });
      const data = await res.json();
      if (data.saved > 0) {
        await fetchTasks();
      }
      setChatHistory((prev) => [
        ...prev,
        {
          role: "ai",
          text: data.saved > 0
            ? `${data.saved}개의 업무를 추출해서 목록에 추가했습니다.`
            : "새로운 업무 항목이 없습니다.",
        },
      ]);
    } finally {
      setExtracting(false);
    }
  }

  async function toggleTask(task: Task) {
    const newStatus = task.status === "pending" ? "done" : "pending";
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: newStatus, completed_at: newStatus === "done" ? new Date().toISOString() : null } : t))
      );
    }
  }

  async function deleteTask(id: string) {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "DELETE",
      headers: authHeader,
    });
    if (res.ok) setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  async function sendQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || chatLoading) return;
    const q = question.trim();
    setQuestion("");
    setChatHistory((prev) => [...prev, { role: "user", text: q }]);
    setChatLoading(true);
    try {
      const res = await fetch("/api/tasks/chat", {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      setChatHistory((prev) => [...prev, { role: "ai", text: data.answer ?? "답변을 받지 못했습니다." }]);
    } finally {
      setChatLoading(false);
    }
  }

  const pending = tasks.filter((t) => t.status === "pending");
  const done = tasks.filter((t) => t.status === "done");

  // Group tasks
  function groupTasks(taskList: Task[]) {
    const key = groupMode === "week" ? "week_label" : "group_key";
    const groups: Record<string, Task[]> = {};
    for (const t of taskList) {
      const k = t[key] ?? "미분류";
      if (!groups[k]) groups[k] = [];
      groups[k].push(t);
    }
    // Sort group keys: weeks descending, groups alphabetically
    return Object.entries(groups).sort(([a], [b]) =>
      groupMode === "week" ? b.localeCompare(a) : a.localeCompare(b)
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-800 flex-shrink-0">
        <MessageSquare className="w-5 h-5 text-blue-400" />
        <h1 className="text-lg font-semibold">Task Manager</h1>
        <span className="ml-2 bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
          미완료 {pending.length}
        </span>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Slack messages */}
        <div className="flex flex-col w-1/2 border-r border-slate-800">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
            <span className="text-sm font-medium text-slate-300">Slack DM</span>
            <div className="flex gap-2">
              <button
                onClick={fetchMessages}
                disabled={loadingMessages}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingMessages ? "animate-spin" : ""}`} />
                새로고침
              </button>
              <button
                onClick={extractTasks}
                disabled={extracting || !messages.length}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors disabled:opacity-50"
              >
                <Sparkles className={`w-3.5 h-3.5 ${extracting ? "animate-pulse" : ""}`} />
                {extracting ? "추출 중..." : "AI로 업무 추출"}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {loadingMessages && !messages.length ? (
              <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
                메시지 로딩 중...
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
                메시지가 없습니다
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.ts}
                  className={`flex ${m.isSelf ? "justify-end" : "justify-start"} ${m.isThread ? "pl-6" : ""}`}
                >
                  {m.isThread && (
                    <div className="flex items-start mr-1.5 mt-2">
                      <div className="w-3 h-3 border-l-2 border-b-2 border-slate-600 rounded-bl-sm flex-shrink-0" />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm ${
                      m.isThread
                        ? m.isSelf
                          ? "bg-blue-500/70 text-white rounded-br-sm"
                          : "bg-slate-700 text-slate-200 rounded-bl-sm"
                        : m.isSelf
                        ? "bg-blue-600 text-white rounded-br-sm"
                        : "bg-slate-800 text-slate-100 rounded-bl-sm"
                    }`}
                  >
                    {m.isThread && (
                      <p className="text-xs text-slate-400 mb-0.5 font-medium flex items-center gap-1">
                        <span className="text-slate-500">↩</span> 스레드 답장
                      </p>
                    )}
                    {!m.isSelf && !m.isThread && (
                      <p className="text-xs text-slate-400 mb-1 font-medium">{m.userName}</p>
                    )}
                    {!m.isSelf && m.isThread && (
                      <p className="text-xs text-slate-400 mb-1 font-medium">{m.userName}</p>
                    )}
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    <div className="flex items-center justify-between mt-1">
                      <p className={`text-xs ${m.isSelf ? "text-blue-200" : "text-slate-500"}`}>
                        {new Date(Number(m.ts.split(".")[0]) * 1000).toLocaleTimeString("ko-KR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      {!m.isThread && m.replyCount && m.replyCount > 0 ? (
                        <p className="text-xs text-blue-400 ml-2">↩ {m.replyCount}개 답장</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Right: Tasks */}
        <div className="flex flex-col w-1/2">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 flex-shrink-0">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-medium text-slate-300">업무 목록</span>
              <span className="text-xs text-slate-500">미완료 {pending.length} / 완료 {done.length}</span>
            </div>
            {/* Group mode toggle */}
            <div className="flex bg-slate-800 rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setGroupMode("week")}
                className={`px-2.5 py-1 rounded-md transition-colors ${groupMode === "week" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}
              >
                주차별
              </button>
              <button
                onClick={() => setGroupMode("group")}
                className={`px-2.5 py-1 rounded-md transition-colors ${groupMode === "group" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}
              >
                오더별
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
            {tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-500">
                <ClipboardList className="w-8 h-8 opacity-30" />
                <p className="text-sm">업무가 없습니다</p>
                <p className="text-xs">"AI로 업무 추출" 버튼으로 추출하세요</p>
              </div>
            ) : (
              groupTasks(tasks).map(([groupLabel, groupItems]) => {
                const gPending = groupItems.filter((t) => t.status === "pending");
                const gDone = groupItems.filter((t) => t.status === "done");
                const doneExpanded = expandedDone.has(groupLabel);
                const toggleDone = () =>
                  setExpandedDone((prev) => {
                    const next = new Set(prev);
                    if (next.has(groupLabel)) next.delete(groupLabel);
                    else next.add(groupLabel);
                    return next;
                  });
                return (
                  <div key={groupLabel}>
                    {/* Group header */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest whitespace-nowrap">
                        {groupMode === "week" ? groupLabel : groupLabel}
                      </span>
                      <div className="flex-1 h-px bg-slate-800" />
                      {gPending.length > 0 && (
                        <span className="text-[10px] font-bold bg-blue-600/20 text-blue-400 px-1.5 py-0.5 rounded-full">
                          {gPending.length}
                        </span>
                      )}
                    </div>
                    {/* Pending tasks */}
                    <div className="space-y-1">
                      {gPending.length === 0 && gDone.length > 0 && (
                        <p className="text-xs text-slate-600 pl-2 py-1">미완료 없음</p>
                      )}
                      {gPending.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          onToggle={toggleTask}
                          onDelete={deleteTask}
                          showGroup={groupMode === "week"}
                        />
                      ))}
                    </div>
                    {/* Done items — collapsible */}
                    {gDone.length > 0 && (
                      <div className="mt-1.5">
                        <button
                          onClick={toggleDone}
                          className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-400 transition-colors pl-1 py-0.5"
                        >
                          <span className={`transition-transform ${doneExpanded ? "rotate-90" : ""}`}>▶</span>
                          완료 {gDone.length}개
                        </button>
                        {doneExpanded && (
                          <div className="space-y-1 mt-1">
                            {gDone.map((task) => (
                              <TaskRow
                                key={task.id}
                                task={task}
                                onToggle={toggleTask}
                                onDelete={deleteTask}
                                showGroup={groupMode === "week"}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Chat / Q&A panel */}
      <div className="border-t border-slate-800 flex-shrink-0" style={{ maxHeight: "280px" }}>
        <div className="px-4 py-2 border-b border-slate-800/50">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            AI에게 질문
          </span>
        </div>

        {/* Chat history */}
        <div className="overflow-y-auto px-4 py-2 space-y-2" style={{ maxHeight: "180px" }}>
          {chatHistory.length === 0 && (
            <p className="text-xs text-slate-600 italic">
              예: "오늘 처리해야 할 업무 정리해줘", "가장 오래된 미완료 업무는?"
            </p>
          )}
          {chatHistory.map((entry, i) => (
            <div key={i} className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  entry.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-200"
                }`}
              >
                <p className="whitespace-pre-wrap">{entry.text}</p>
              </div>
            </div>
          ))}
          {chatLoading && (
            <div className="flex justify-start">
              <div className="bg-slate-800 rounded-lg px-3 py-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={sendQuestion} className="flex gap-2 px-4 py-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="업무에 대해 질문하세요..."
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
          <button
            type="submit"
            disabled={!question.trim() || chatLoading}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete,
  showGroup = false,
}: {
  task: Task;
  onToggle: (t: Task) => void;
  onDelete: (id: string) => void;
  showGroup?: boolean;
}) {
  const isDone = task.status === "done";
  return (
    <div
      className={`flex items-start gap-2 px-3 py-2.5 rounded-lg group transition-colors border-l-2 ${
        isDone
          ? "border-slate-700 bg-transparent opacity-50"
          : "border-blue-500/60 bg-slate-800/50 hover:bg-slate-800"
      }`}
    >
      <button
        onClick={() => onToggle(task)}
        className="flex-shrink-0 mt-0.5 text-slate-500 hover:text-blue-400 transition-colors"
      >
        {isDone ? (
          <CheckSquare className="w-4 h-4 text-green-500/80" />
        ) : (
          <Square className="w-4 h-4" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-snug ${isDone ? "line-through text-slate-500" : "text-slate-200"}`}>
          {task.task_text}
        </p>
        {!isDone && task.source_text && (
          <p className="text-xs text-slate-600 mt-0.5 truncate">{task.source_text}</p>
        )}
        {showGroup && task.group_key && (
          <span className="inline-block mt-1 text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">
            {task.group_key}
          </span>
        )}
      </div>
      <button
        onClick={() => onDelete(task.id)}
        className="flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
