"use client";

// قسم إعدادات الربط — عنوان /mcp جاهز للنسخ + إعدادات لأشهر عملاء MCP
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

const CLIENTS: { name: string; icon: string; steps: string[]; make: (url: string, token?: string) => string; lang: "json" | "text" }[] = [
  {
    name: "ChatGPT (Connectors)",
    icon: "🟢",
    steps: [
      "الإعدادات ← Connectors ← Create",
      "اختر MCP Server والصق العنوان أدناه",
      "إن كان التوكن مفعّلًا أضف الترويسة Authorization",
      "أضف الموصل لمحادثة جديدة عبر Developer Mode",
    ],
    make: (url) => `MCP Server URL:\n${url}`,
    lang: "text",
  },
  {
    name: "Claude (Desktop / Web)",
    icon: "🟠",
    steps: [
      "Desktop: الإعدادات ← Connectors ← Add custom connector",
      "Web: الإعدادات ← Connectors ← Add custom connector",
      "الصق العنوان أدناه (Remote MCP)",
    ],
    make: (url) => `Remote MCP server URL:\n${url}`,
    lang: "text",
  },
  {
    name: "Cursor / Windsurf / Cline",
    icon: "🖥️",
    steps: [
      "Cursor: الإعدادات ← MCP ← New MCP Server (يفتح mcp.json)",
      "Windsurf: الإعدادات ← Cascade ← MCP Servers",
      "Cline: MCP Servers ← Installed ← Configure",
      "الصق الإعداد أدناه",
    ],
    make: (url, token) =>
      JSON.stringify(
        {
          mcpServers: {
            "media-generator": {
              url,
              ...(token ? { headers: { Authorization: `Bearer <MCP_ACCESS_TOKEN>` } } : {}),
            },
          },
        },
        null,
        2
      ),
    lang: "json",
  },
];

export function ConnectPanel({ origin, authRequired }: { origin: string; authRequired: boolean }) {
  const mcpUrl = useMemo(() => (origin ? `${origin}/mcp` : "…"), [origin]);

  function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text).then(
      () => toast({ title: `تم نسخ ${what} 📋` }),
      () => toast({ title: "تعذر النسخ", variant: "destructive" })
    );
  }

  return (
    <div className="space-y-4">
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">🔌 عنوان خادم MCP</CardTitle>
          <CardDescription className="text-slate-400 text-xs sm:text-sm">
            استخدم هذا العنوان في أي عميل يدعم بروتوكول MCP عبر نقل Streamable HTTP.
            {authRequired
              ? " الحماية مفعّلة: أرفق الترويسة Authorization: Bearer <MCP_ACCESS_TOKEN> في كل طلب."
              : " الحماية غير مفعّلة — يمكن تفعيلها لاحقًا بمتغير البيئة MCP_ACCESS_TOKEN."}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          <div className="flex items-center gap-2 flex-wrap" dir="ltr">
            <code className="grow min-w-0 truncate rounded-md border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-sm text-emerald-400 text-left">
              {mcpUrl}
            </code>
            <Button onClick={() => copy(mcpUrl, "العنوان")} className="bg-emerald-600 hover:bg-emerald-500 text-white">
              نسخ
            </Button>
          </div>
          <ul className="mt-4 grid gap-1.5 text-xs text-slate-400 sm:grid-cols-2" dir="rtl">
            <li>✅ 5 أدوات: generate_image · generate_video · merge_videos · get_task · list_media</li>
            <li>🔁 تبديل مفاتيح تسلسلي تلقائي عند الخطأ أو نفاد الرصيد</li>
            <li>⏳ المهام غير المتزامنة تُتابع بأداة get_task كل ~10 ثوانٍ</li>
            <li>🎞️ الدمج يقبل روابط مباشرة أو معرّفات مهام مكتملة (بحد أقصى 10 مقاطع)</li>
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {CLIENTS.map((c) => {
          const snippet = c.make(mcpUrl, authRequired ? "token" : undefined);
          return (
            <Card key={c.name} className="bg-slate-900 border-slate-800 flex flex-col">
              <CardHeader className="p-4 sm:p-6">
                <CardTitle className="text-sm sm:text-base">
                  {c.icon} {c.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 sm:p-6 pt-0 grow flex flex-col gap-3">
                <ol className="text-xs text-slate-400 space-y-1 list-decimal ps-4">
                  {c.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                <pre
                  dir="ltr"
                  className="mt-auto text-[11px] leading-relaxed font-mono bg-slate-950 border border-slate-800 rounded-md p-3 overflow-x-auto text-slate-300 text-left"
                >
                  {snippet}
                </pre>
                <Button variant="outline" size="sm" className="border-slate-700 text-slate-300 w-full" onClick={() => copy(snippet, "الإعداد")}>
                  نسخ الإعداد
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-sm sm:text-base">🧪 اختبار سريع من الطرفية</CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          <pre dir="ltr" className="text-[11px] leading-relaxed font-mono bg-slate-950 border border-slate-800 rounded-md p-3 overflow-x-auto text-slate-300 text-left">
{`# initialize
curl -s -X POST ${mcpUrl} \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# tools/call
curl -s -X POST ${mcpUrl} \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"generate_image","arguments":{"prompt":"قطة أسترالية تنظر للنجوم","wait_seconds":45}}}'`}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
