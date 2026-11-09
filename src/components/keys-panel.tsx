"use client";

// قسم إدارة المفاتيح — إضافة/تعطيل/تنشيط/حذف + عدّادات الاستخدام
// ملاحظة جوهرية: الترتيب التسلسلي الصارم — أول مفتاح أُضيف يُجرَّب أولًا
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import type { StatsResponse } from "@/components/dashboard";

interface KeyItem {
  id: string;
  provider: string;
  label: string;
  maskedKey: string;
  status: "active" | "exhausted" | "disabled";
  usageCount: number;
  successCount: number;
  failCount: number;
  lastUsedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  active: "نشط",
  exhausted: "مستنزف",
  disabled: "معطّل",
};
const STATUS_CLASS: Record<string, string> = {
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  exhausted: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  disabled: "border-slate-600 bg-slate-800 text-slate-400",
};

export function KeysPanel({ onChanged }: { onChanged?: () => void }) {
  const [keys, setKeys] = useState<KeyItem[]>([]);
  const [provider, setProvider] = useState("kie");
  const [apiKey, setApiKey] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/keys");
      const d = await r.json();
      if (d.keys) setKeys(d.keys);
    } catch {
      /* تجاهل أخطاء التحديث الدوري */
    }
  }, []);

  useEffect(() => {
    load();
    const i = setInterval(load, 15000);
    return () => clearInterval(i);
  }, [load]);

  async function addKey() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, api_key: apiKey.trim(), label: label.trim() }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? "فشلت الإضافة");
        toast({ title: "فشلت الإضافة", description: d.error, variant: "destructive" });
      } else {
        toast({ title: "تمت إضافة المفتاح ✅", description: d.message });
        setApiKey("");
        setLabel("");
        await load();
        onChanged?.();
      }
    } catch {
      setError("تعذر الاتصال بالسيرفر");
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(k: KeyItem) {
    const next = k.status === "disabled" ? "active" : "disabled";
    const r = await fetch(`/api/keys/${k.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (r.ok) {
      toast({ title: next === "active" ? "تم التنشيط ✅" : "تم التعطيل ⛔" });
      await load();
      onChanged?.();
    } else {
      const d = await r.json().catch(() => ({}));
      toast({ title: "فشل التحديث", description: d.error, variant: "destructive" });
    }
  }

  async function reactivate(k: KeyItem) {
    const r = await fetch(`/api/keys/${k.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    if (r.ok) {
      toast({ title: "تمت إعادة التنشيط — إن شُحن الرصيد سيعمل فورًا", description: "يبقى ترتيبه حسب وقت الإضافة" });
      await load();
      onChanged?.();
    }
  }

  async function remove(k: KeyItem) {
    const r = await fetch(`/api/keys/${k.id}`, { method: "DELETE" });
    if (r.ok) {
      toast({ title: "تم حذف المفتاح 🗑️" });
      await load();
      onChanged?.();
    } else {
      const d = await r.json().catch(() => ({}));
      toast({ title: "فشل الحذف", description: d.error, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">➕ إضافة مفتاح API</CardTitle>
          <CardDescription className="text-slate-400 text-xs sm:text-sm">
            يُجرَّب المفتاح الأقدم إضافةً أولًا ثم الذي يليه بالترتيب (ترتيب تسلسلي صارم وليس دورانًا).
            عند الخطأ أو نفاد الرصيد ينتقل السيرفر تلقائيًا للمفتاح التالي دون توقف المهمة.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr_220px_auto] gap-3 items-start">
            <div>
              <label className="text-xs text-slate-400 mb-1 block" htmlFor="provider">المزود</label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger id="provider" className="bg-slate-950 border-slate-700 w-full" aria-label="اختر المزود">
                  <SelectValue placeholder="المزود" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="kie">kie.ai</SelectItem>
                  <SelectItem value="cometapi">CometAPI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block" htmlFor="apikey">المفتاح</label>
              <Input
                id="apikey"
                dir="ltr"
                placeholder="API key…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="bg-slate-950 border-slate-700 font-mono text-left"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block" htmlFor="keylabel">تسمية (اختياري)</label>
              <Input
                id="keylabel"
                placeholder="مثال: الحساب الرئيسي"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="bg-slate-950 border-slate-700"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={addKey} disabled={busy || apiKey.trim().length < 8} className="bg-emerald-600 hover:bg-emerald-500 text-white w-full sm:w-auto">
                {busy ? "جارٍ الإضافة…" : "إضافة المفتاح"}
              </Button>
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">🔑 المفاتيح المضافة ({keys.length})</CardTitle>
          <CardDescription className="text-slate-400 text-xs sm:text-sm">
            المفتاح مخفي دائمًا (أول 7 أحرف + نقاط + آخر 4). المفتاح المستنزف يبقى في القاعدة — إن شُحن رصيده اضغط «تنشيط» ثم سيُجرَّب في ترتيبه الأصلي.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          {keys.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              لا توجد مفاتيح بعد — أضف مفتاحًا واحدًا على الأقل لتشغيل التوليد.
            </p>
          ) : (
            <div className="rounded-lg border border-slate-800 overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-950/80 text-slate-400 sticky top-0">
                  <tr>
                    <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">المزود</th>
                    <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">التسمية</th>
                    <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">المفتاح</th>
                    <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">الحالة</th>
                    <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">استخدام / نجاح / فشل</th>
                    <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">آخر خطأ</th>
                    <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id} className="border-t border-slate-800/70 hover:bg-slate-950/40">
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="font-medium">{k.provider === "kie" ? "kie.ai" : "CometAPI"}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-300">{k.label || "—"}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-mono text-xs text-slate-300" dir="ltr">
                        {k.maskedKey}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <Badge variant="outline" className={STATUS_CLASS[k.status]}>
                          {STATUS_LABEL[k.status]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-slate-300">
                        {k.usageCount} / <span className="text-emerald-400">{k.successCount}</span> /{" "}
                        <span className="text-rose-400">{k.failCount}</span>
                      </td>
                      <td className="px-3 py-2.5 max-w-56 truncate text-xs text-slate-500" title={k.lastError ?? ""} dir="ltr">
                        {k.lastError ?? "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1.5 flex-wrap">
                          {k.status === "exhausted" && (
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs border-emerald-600/50 text-emerald-400 hover:bg-emerald-500/10" onClick={() => reactivate(k)}>
                              تنشيط
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs border-slate-700 text-slate-300" onClick={() => toggleStatus(k)}>
                            {k.status === "disabled" ? "تشغيل" : "تعطيل"}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs border-rose-600/50 text-rose-400 hover:bg-rose-500/10" onClick={() => remove(k)}>
                            حذف
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export type { StatsResponse };
