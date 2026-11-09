"use client";

// قسم المهام الحية — تحديث تلقائي كل 5 ثوانٍ + فلاتر + روابط النتائج + سجل المحاولات
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";

interface TaskItem {
  id: string;
  type: "image" | "video" | "merge";
  provider: string | null;
  model: string;
  prompt: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  resultUrls: string[];
  errorMessage: string | null;
  attemptsCount: number;
  attempts: { provider: string; keyLabel?: string; ok: boolean; errorClass?: string; error?: string; at: string }[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const TYPE_LABEL: Record<string, string> = { image: "🖼️ صورة", video: "🎬 فيديو", merge: "🎞️ دمج" };
const STATUS_LABEL: Record<string, string> = {
  pending: "بانتظار",
  processing: "جارية",
  completed: "مكتملة",
  failed: "فاشلة",
};
const STATUS_CLASS: Record<string, string> = {
  pending: "border-slate-600 bg-slate-800 text-slate-300",
  processing: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  completed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  failed: "border-rose-500/40 bg-rose-500/10 text-rose-400",
};

function fmtDate(v: string | null): string {
  if (!v) return "—";
  try {
    // التواريخ مخزنة UTC بصيغة "YYYY-MM-DD HH:MM:SS" أو ISO
    const d = new Date(v.includes("T") ? v : v.replace(" ", "T") + "Z");
    return d.toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return v;
  }
}

export function TasksPanel() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/tasks?limit=50");
      const d = await r.json();
      if (d.tasks) setTasks(d.tasks);
    } catch {
      /* تجاهل */
    }
  }, []);

  useEffect(() => {
    // تحميل أولي عبر مؤقت — استدعاء fetch متزامن داخل Effect يسبب cascading renders
    const t = setTimeout(load, 0);
    let i: ReturnType<typeof setInterval> | null = null;
    if (auto) i = setInterval(load, 5000);
    return () => {
      clearTimeout(t);
      if (i) clearInterval(i);
    };
  }, [load, auto]);

  const filtered = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (typeFilter === "all" || t.type === typeFilter) &&
          (statusFilter === "all" || t.status === statusFilter)
      ),
    [tasks, typeFilter, statusFilter]
  );

  function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text).then(
      () => toast({ title: `تم نسخ ${what} 📋` }),
      () => toast({ title: "تعذر النسخ", variant: "destructive" })
    );
  }

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base sm:text-lg">📋 المهام ({filtered.length})</CardTitle>
            <CardDescription className="text-slate-400 text-xs sm:text-sm">
              {auto ? "تتحدث تلقائيًا كل 5 ثوانٍ" : "التحديث التلقائي متوقف"} — اضغط صف المهمة لعرض سجل المحاولات.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm"
              aria-label="فلتر النوع"
            >
              <option value="all">كل الأنواع</option>
              <option value="image">صور</option>
              <option value="video">فيديو</option>
              <option value="merge">دمج</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm"
              aria-label="فلتر الحالة"
            >
              <option value="all">كل الحالات</option>
              <option value="processing">جارية</option>
              <option value="completed">مكتملة</option>
              <option value="failed">فاشلة</option>
            </select>
            <Button variant="outline" size="sm" onClick={() => setAuto((v) => !v)} className="border-slate-700 text-slate-300">
              {auto ? "⏸" : "▶"} الحي
            </Button>
            <Button variant="outline" size="sm" onClick={load} className="border-slate-700 text-slate-300">
              ↻ تحديث
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 pt-0">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center">لا توجد مهام مطابقة — ابدأ التوليد من أي عميل MCP.</p>
        ) : (
          <ul className="space-y-3 max-h-[36rem] overflow-y-auto pl-1 custom-scroll" role="list">
            {filtered.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                  className="w-full text-right rounded-lg border border-slate-800 bg-slate-950/50 hover:bg-slate-950/80 transition-colors p-3 sm:p-4"
                  aria-expanded={expanded === t.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-slate-700 text-slate-300 whitespace-nowrap">
                      {TYPE_LABEL[t.type]}
                    </Badge>
                    <Badge variant="outline" className={`${STATUS_CLASS[t.status]} whitespace-nowrap`}>
                      {STATUS_LABEL[t.status]}
                    </Badge>
                    {(t.status === "processing" || t.status === "pending") && (
                      <span className="text-xs text-amber-400 tabular-nums">{t.progress}%</span>
                    )}
                    <span className="text-sm text-slate-200 grow truncate">{t.prompt || t.model}</span>
                    <span className="text-xs text-slate-500 whitespace-nowrap">{fmtDate(t.createdAt)}</span>
                  </div>

                  {(t.status === "processing" || t.status === "pending") && (
                    <Progress value={t.progress} className="mt-3 h-1.5 bg-slate-800" />
                  )}

                  {t.resultUrls.length > 0 && (
                    <div className="mt-3 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                      {t.resultUrls.map((u) => (
                        <div key={u} className="flex items-center gap-2 text-xs" dir="ltr">
                          <a
                            href={u}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-emerald-400 hover:text-emerald-300 truncate grow text-left"
                          >
                            {u}
                          </a>
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] border-slate-700 text-slate-300">
                            فتح ↗
                          </Button>
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] border-slate-700 text-slate-300" onClick={() => copy(u, "الرابط")}>
                            نسخ
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span className="font-mono" dir="ltr">🆔 {t.id.slice(0, 8)}…</span>
                    {t.provider && <span>المزود: {t.provider}</span>}
                    <span>محاولات: {t.attemptsCount}</span>
                    {t.errorMessage && (
                      <span className="text-amber-500/90 truncate max-w-md" title={t.errorMessage}>
                        ⚠ {t.errorMessage}
                      </span>
                    )}
                  </div>

                  {expanded === t.id && (
                    <div className="mt-3 border-t border-slate-800 pt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs border-slate-700 text-slate-300" onClick={() => copy(t.id, "task_id")}>
                          نسخ task_id كاملًا
                        </Button>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-1">سجل المحاولات (الأحدث أخيرًا):</p>
                        {t.attempts.length === 0 ? (
                          <p className="text-xs text-slate-600">لا محاولات مسجلة بعد</p>
                        ) : (
                          <ul className="space-y-1 max-h-40 overflow-y-auto custom-scroll">
                            {t.attempts.map((a, i) => (
                              <li key={i} className="text-xs flex flex-wrap gap-x-2" dir="ltr">
                                <span className={a.ok ? "text-emerald-400" : "text-rose-400"}>{a.ok ? "✓" : "✗"}</span>
                                <span className="text-slate-300 font-mono">{a.provider}</span>
                                {a.keyLabel && <span className="text-slate-500">({a.keyLabel})</span>}
                                {a.errorClass && <span className="text-slate-500">[{a.errorClass}]</span>}
                                {a.error && <span className="text-slate-600 truncate max-w-sm">{a.error}</span>}
                                <span className="text-slate-600 ms-auto">{fmtDate(a.at)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        الموديل: <span className="font-mono" dir="ltr">{t.model}</span> — آخر تحديث: {fmtDate(t.updatedAt)}
                        {t.completedAt ? ` — اكتملت: ${fmtDate(t.completedAt)}` : ""}
                      </p>
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
