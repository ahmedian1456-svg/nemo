"use client";

// لوحة الإدارة الرئيسية — عربية RTL بالكامل
// أقسام: نظرة عامة (إحصاءات) | المفاتيح | المهام الحية | إعدادات الربط
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KeysPanel } from "@/components/keys-panel";
import { TasksPanel } from "@/components/tasks-panel";
import { ConnectPanel } from "@/components/connect-panel";

export interface StatsResponse {
  stats: { total: number; completed: number; failed: number; active: number };
  keys: { total: number; active: number; exhausted: number; disabled: number; usable: number };
  merger: { configured: boolean };
  mcp: { authRequired: boolean };
  version: string;
}

export interface HealthResponse {
  ok: boolean;
  db: boolean;
  version?: string;
  merger?: { configured: boolean };
  auth?: { mcpToken: boolean };
}

export function Dashboard() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [origin, setOrigin] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [tick, setTick] = useState(0);

  // تحديث دوري: الإحصاءات كل 5 ثوانٍ والجهوزية كل 15 ثانية
  const refresh = useCallback(() => {
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStats(d))
      .catch(() => undefined);
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setHealth(d))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    // عبر مؤقت لتفادي setState المتزامن داخل Effect
    const t = setTimeout(() => {
      setOrigin(window.location.origin);
      refresh();
    }, 0);
    return () => clearTimeout(t);
  }, [refresh, tick]);

  useEffect(() => {
    if (!autoRefresh) return;
    const i = setInterval(refresh, 5000);
    return () => clearInterval(i);
  }, [autoRefresh, refresh]);

  const s = stats?.stats;

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100" dir="rtl">
      {/* الترويسة */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 grow">
            <div className="size-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 grid place-items-center text-xl">
              🎨
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold leading-tight">
                مولّد الوسائط — خادم MCP
              </h1>
              <p className="text-xs sm:text-sm text-slate-400">
                توليد الصور والفيديو بالذكاء الاصطناعي + دمج المقاطع | تبديل مفاتيح تسلسلي تلقائي
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={
                health?.db
                  ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                  : "border-rose-500/40 text-rose-400 bg-rose-500/10"
              }
            >
              <span className={`size-2 rounded-full ml-1.5 ${health?.db ? "bg-emerald-400" : "bg-rose-400 animate-pulse"}`} />
              {health?.db ? "قاعدة البيانات متصلة" : "قاعدة البيانات غير متصلة"}
            </Badge>
            <Badge variant="outline" className="border-slate-700 text-slate-300">
              v{stats?.version ?? "1.2.0"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRefresh((v) => !v)}
              className="border-slate-700 text-slate-300 hover:text-white"
              aria-label={autoRefresh ? "إيقاف التحديث التلقائي" : "تشغيل التحديث التلقائي"}
            >
              {autoRefresh ? "⏸ إيقاف الحي" : "▶ متابعة الحي"}
            </Button>
          </div>
        </div>
      </header>

      <main className="grow w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* بطاقات الإحصاءات */}
        <section aria-label="إحصاءات المهام" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard title="إجمالي المهام" value={s?.total ?? 0} icon="📊" tone="slate" />
          <StatCard title="مكتملة" value={s?.completed ?? 0} icon="✅" tone="emerald" />
          <StatCard title="جارية الآن" value={s?.active ?? 0} icon="⏳" tone="amber" />
          <StatCard title="فاشلة" value={s?.failed ?? 0} icon="❌" tone="rose" />
        </section>

        {/* شريط حالة النظام */}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <StatusItem
              ok={(stats?.keys.usable ?? 0) > 0}
              text={`مفاتيح صالحة للتجربة: ${stats?.keys.usable ?? 0} (نشطة ${stats?.keys.active ?? 0} / مستنزفة ${stats?.keys.exhausted ?? 0})`}
            />
            <StatusItem
              ok={stats?.merger.configured ?? false}
              text={stats?.merger.configured ? "خدمة الدمج مهيأة" : "خدمة الدمج غير مهيأة (MERGER_API_BASE)"}
            />
            <StatusItem
              ok
              neutral
              text={stats?.mcp.authRequired ? "حماية /mcp مفعّلة بتوكن" : "حماية /mcp غير مفعّلة (اختياري: MCP_ACCESS_TOKEN)"}
            />
            <StatusItem ok text="لا تُخزَّن أي ملفات وسائط على السيرفر — روابط فقط" />
          </CardContent>
        </Card>

        {/* الأقسام */}
        <Tabs defaultValue="keys" dir="rtl" className="space-y-4">
          <TabsList className="bg-slate-900 border border-slate-800 h-auto p-1 flex flex-wrap">
            <TabsTrigger value="keys" className="data-[state=active]:bg-slate-800 px-4 py-2">
              🔑 المفاتيح
            </TabsTrigger>
            <TabsTrigger value="tasks" className="data-[state=active]:bg-slate-800 px-4 py-2">
              📋 المهام الحية
            </TabsTrigger>
            <TabsTrigger value="connect" className="data-[state=active]:bg-slate-800 px-4 py-2">
              🔌 إعدادات الربط
            </TabsTrigger>
          </TabsList>

          <TabsContent value="keys">
            <KeysPanel onChanged={() => setTick((t) => t + 1)} />
          </TabsContent>
          <TabsContent value="tasks">
            <TasksPanel />
          </TabsContent>
          <TabsContent value="connect">
            <ConnectPanel origin={origin} authRequired={stats?.mcp.authRequired ?? false} />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="mt-auto border-t border-slate-800 bg-slate-900/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1 justify-between">
          <span>MCP Media Generator — خادم توليد وسائط بروتوكول Model Context Protocol</span>
          <span>kie.ai + CometAPI | دمج MP4 (H.264+AAC) | Turso عبر HTTP</span>
        </div>
      </footer>
    </div>
  );
}

function StatCard({ title, value, icon, tone }: { title: string; value: number; icon: string; tone: "slate" | "emerald" | "amber" | "rose" }) {
  const tones: Record<string, string> = {
    slate: "border-slate-800",
    emerald: "border-emerald-500/30",
    amber: "border-amber-500/30",
    rose: "border-rose-500/30",
  };
  const textTones: Record<string, string> = {
    slate: "text-slate-100",
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    rose: "text-rose-400",
  };
  return (
    <Card className={`bg-slate-900 ${tones[tone]}`}>
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">{title}</span>
          <span className="text-xl" aria-hidden>{icon}</span>
        </div>
        <div className={`mt-2 text-3xl font-extrabold tabular-nums ${textTones[tone]}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function StatusItem({ ok, text, neutral = false }: { ok: boolean; text: string; neutral?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`size-2 rounded-full ${neutral ? "bg-slate-400" : ok ? "bg-emerald-400" : "bg-amber-400"}`}
        aria-hidden
      />
      <span className={neutral ? "text-slate-300" : "text-slate-200"}>{text}</span>
    </span>
  );
}
