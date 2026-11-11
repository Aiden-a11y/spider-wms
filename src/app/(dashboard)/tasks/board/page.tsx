"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { CheckSquare, Square, ChevronLeft, ChevronRight, CalendarDays, LayoutGrid, Trash2 } from "lucide-react";
import Link from "next/link";

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

const GROUP_COLORS: Record<string, string> = {
  FCOKR: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  FCOUS: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  ULTA: "bg-pink-500/20 text-pink-300 border-pink-500/30",
  FBA: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  LTL: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  B2B: "bg-green-500/20 text-green-300 border-green-500/30",
  기타: "bg-slate-600/30 text-slate-400 border-slate-600/30",
};

function groupColor(key: string | null) {
  if (!key) return GROUP_COLORS["기타"];
  return GROUP_COLORS[key] ?? "bg-slate-600/30 text-slate-400 border-slate-600/30";
}

type ViewMode = "calendar" | "board";

export default function TaskBoardPage() {
  const { user } = useAuth();
  const authHeader: Record<string, string> = user?.token ? { Authorization: `Bearer ${user.token}` } : {};

  const [tasks, setTasks] = useState<Task[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const fetchTasks = useCallback(async () => {
    const res = await fetch("/api/tasks", { headers: authHeader });
    const data = await res.json();
    if (data.tasks) setTasks(data.tasks);
  }, [user?.token]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  async function toggleTask(task: Task) {
    const newStatus = task.status === "pending" ? "done" : "pending";
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? { ...t, status: newStatus, completed_at: newStatus === "done" ? new Date().toISOString() : null }
            : t
        )
      );
    }
  }

  async function deleteTask(id: string) {
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE", headers: authHeader });
    if (res.ok) setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  // --- Calendar helpers ---
  const { year, month } = currentMonth;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = new Date(year, month, 1).toLocaleDateString("ko-KR", { year: "numeric", month: "long" });

  function taskDateKey(task: Task) {
    return (task.source_date ?? task.created_at).slice(0, 10);
  }

  const tasksByDate: Record<string, Task[]> = {};
  for (const t of tasks) {
    const key = taskDateKey(t);
    if (!tasksByDate[key]) tasksByDate[key] = [];
    tasksByDate[key].push(t);
  }

  function dateKey(d: number) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const prevMonth = () =>
    setCurrentMonth(({ year, month }) =>
      month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
    );
  const nextMonth = () =>
    setCurrentMonth(({ year, month }) =>
      month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
    );

  const today = new Date().toISOString().slice(0, 10);

  // --- Selected day tasks or all tasks ---
  const displayTasks = selectedDate
    ? (tasksByDate[selectedDate] ?? [])
    : tasks;

  // Sort: pending first, then by created_at desc
  const sortedDisplay = [...displayTasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
    return b.created_at.localeCompare(a.created_at);
  });

  // --- Board (Kanban) grouping by group_key ---
  const allGroupKeys = Array.from(new Set(tasks.map((t) => t.group_key ?? "기타"))).sort();
  const pendingByGroup: Record<string, Task[]> = {};
  for (const k of allGroupKeys) pendingByGroup[k] = [];
  for (const t of tasks.filter((t) => t.status === "pending")) {
    const k = t.group_key ?? "기타";
    if (!pendingByGroup[k]) pendingByGroup[k] = [];
    pendingByGroup[k].push(t);
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-800 flex-shrink-0">
        <CalendarDays className="w-5 h-5 text-blue-400" />
        <h1 className="text-lg font-semibold">Task Board</h1>
        <span className="ml-1 bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
          미완료 {tasks.filter((t) => t.status === "pending").length}
        </span>
        <div className="flex-1" />
        <Link href="/tasks" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
          ← 목록 보기
        </Link>
        {/* View toggle */}
        <div className="flex bg-slate-800 rounded-lg p-0.5 text-xs ml-3">
          <button
            onClick={() => setViewMode("calendar")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${viewMode === "calendar" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}
          >
            <CalendarDays className="w-3.5 h-3.5" /> 달력
          </button>
          <button
            onClick={() => setViewMode("board")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${viewMode === "board" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> 보드
          </button>
        </div>
      </div>

      {/* Content */}
      {viewMode === "calendar" ? (
        <div className="flex flex-1 min-h-0">
          {/* Calendar panel */}
          <div className="flex flex-col w-[380px] border-r border-slate-800 flex-shrink-0">
            {/* Month nav */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <button onClick={prevMonth} className="p-1 rounded hover:bg-slate-800 transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold">{monthLabel}</span>
              <button onClick={nextMonth} className="p-1 rounded hover:bg-slate-800 transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Day-of-week headers */}
            <div className="grid grid-cols-7 px-2 pt-2">
              {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
                <div key={d} className="text-center text-[10px] font-semibold text-slate-600 py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7 px-2 pb-2 gap-y-1">
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`empty-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const d = i + 1;
                const key = dateKey(d);
                const dayTasks = tasksByDate[key] ?? [];
                const pending = dayTasks.filter((t) => t.status === "pending");
                const isToday = key === today;
                const isSelected = key === selectedDate;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDate(isSelected ? null : key)}
                    className={`relative flex flex-col items-center rounded-lg py-1.5 px-0.5 transition-colors min-h-[52px] ${
                      isSelected
                        ? "bg-blue-600/30 ring-1 ring-blue-500/50"
                        : isToday
                        ? "bg-slate-800/80 ring-1 ring-slate-600"
                        : dayTasks.length > 0
                        ? "hover:bg-slate-800/60"
                        : "hover:bg-slate-900/40"
                    }`}
                  >
                    <span
                      className={`text-xs font-medium leading-none mb-1.5 ${
                        isToday ? "text-blue-400" : "text-slate-400"
                      }`}
                    >
                      {d}
                    </span>
                    {/* Task dots */}
                    {dayTasks.length > 0 && (
                      <div className="flex flex-col items-center gap-0.5 w-full px-1">
                        {pending.length > 0 && (
                          <div className="w-full flex items-center justify-center gap-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                            <span className="text-[9px] text-blue-400 font-bold leading-none">{pending.length}</span>
                          </div>
                        )}
                        {dayTasks.length - pending.length > 0 && (
                          <div className="w-full flex items-center justify-center gap-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500/60 flex-shrink-0" />
                            <span className="text-[9px] text-green-500/80 leading-none">{dayTasks.length - pending.length}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="px-4 py-2 border-t border-slate-800 flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="w-2 h-2 rounded-full bg-blue-400" /> 미완료
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="w-2 h-2 rounded-full bg-green-500/60" /> 완료
              </div>
            </div>
          </div>

          {/* Task list panel */}
          <div className="flex flex-col flex-1 min-w-0">
            <div className="px-4 py-3 border-b border-slate-800 flex-shrink-0">
              <span className="text-sm font-medium text-slate-300">
                {selectedDate
                  ? `${selectedDate} 업무 (${displayTasks.length}개)`
                  : `전체 업무 (${tasks.length}개)`}
              </span>
              {selectedDate && (
                <button
                  onClick={() => setSelectedDate(null)}
                  className="ml-3 text-xs text-slate-500 hover:text-slate-300"
                >
                  × 해제
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
              {sortedDisplay.length === 0 ? (
                <p className="text-sm text-slate-600 text-center pt-10">업무가 없습니다</p>
              ) : (
                sortedDisplay.map((task) => (
                  <CalendarTaskRow key={task.id} task={task} onToggle={toggleTask} onDelete={deleteTask} />
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Board (Kanban) view */
        <div className="flex-1 overflow-x-auto p-4">
          <div className="flex gap-3 h-full" style={{ minWidth: `${allGroupKeys.length * 240}px` }}>
            {allGroupKeys.map((gk) => {
              const gtasks = pendingByGroup[gk] ?? [];
              return (
                <div key={gk} className="flex flex-col w-56 flex-shrink-0">
                  {/* Column header */}
                  <div className={`flex items-center justify-between px-3 py-2 rounded-t-lg border mb-0 ${groupColor(gk)}`}>
                    <span className="text-xs font-bold tracking-wide">{gk}</span>
                    <span className="text-xs font-bold">{gtasks.length}</span>
                  </div>
                  <div className="flex-1 bg-slate-900/50 rounded-b-lg border border-t-0 border-slate-800 overflow-y-auto p-2 space-y-1.5"
                    style={{ maxHeight: "calc(100vh - 200px)" }}>
                    {gtasks.length === 0 ? (
                      <p className="text-xs text-slate-700 text-center py-4">없음</p>
                    ) : (
                      gtasks.map((task) => (
                        <BoardCard key={task.id} task={task} onToggle={toggleTask} onDelete={deleteTask} />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarTaskRow({
  task,
  onToggle,
  onDelete,
}: {
  task: Task;
  onToggle: (t: Task) => void;
  onDelete: (id: string) => void;
}) {
  const isDone = task.status === "done";
  return (
    <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg group transition-colors border-l-2 ${
      isDone ? "border-green-700/40 bg-transparent opacity-50" : "border-blue-500/60 bg-slate-800/50 hover:bg-slate-800"
    }`}>
      <button onClick={() => onToggle(task)} className="flex-shrink-0 mt-0.5 text-slate-500 hover:text-blue-400 transition-colors">
        {isDone ? <CheckSquare className="w-4 h-4 text-green-500/80" /> : <Square className="w-4 h-4" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-snug ${isDone ? "line-through text-slate-500" : "text-slate-200"}`}>
          {task.task_text}
        </p>
        <div className="flex items-center gap-2 mt-1">
          {task.group_key && (
            <span className={`text-[10px] border px-1.5 py-0.5 rounded ${groupColor(task.group_key)}`}>
              {task.group_key}
            </span>
          )}
          <span className="text-[10px] text-slate-600">
            {task.created_at.slice(0, 10)}
          </span>
        </div>
        {!isDone && task.source_text && (
          <p className="text-xs text-slate-600 mt-0.5 truncate">{task.source_text}</p>
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

function BoardCard({
  task,
  onToggle,
  onDelete,
}: {
  task: Task;
  onToggle: (t: Task) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-slate-800 rounded-lg p-2.5 group hover:bg-slate-750 transition-colors border border-slate-700/50">
      <p className="text-xs text-slate-200 leading-snug mb-2">{task.task_text}</p>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-600">{task.created_at.slice(0, 10)}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
          <button onClick={() => onToggle(task)} className="text-slate-500 hover:text-green-400 transition-colors p-0.5">
            <CheckSquare className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(task.id)} className="text-slate-500 hover:text-red-400 transition-colors p-0.5">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
