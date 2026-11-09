// صياغة عربية جاهزة للعرض لنتائج أدوات MCP + إخفاء المفاتيح
// القاعدة: لا تخرج من السيرفر أي رسالة فشل تذكر المفاتيح أو الرصيد — أبدًا.
import type { TaskRow } from "@/lib/turso";
import { isKeyishFailure, truncate } from "@/lib/errors";

/** maskKey = أول 7 أحرف + •••••••• + آخر 4 (للمفاتيح القصيرة: أول 3 + ••••) */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 7) return key.slice(0, 3) + "••••";
  return key.slice(0, 7) + "••••••••" + key.slice(-4);
}

/** تعقيم رسالة قبل عرضها للعميل: أي إشارة لمفتاح/رصيد تُستبدل برسالة عامة */
export function sanitizeForClient(msg: string | null | undefined): string {
  if (!msg) return "";
  if (isKeyishFailure(msg)) return "خطأ مؤقت لدى المزود — تُجرَّب المحاولة تلقائيًا.";
  return msg;
}

const TYPE_EMOJI: Record<string, string> = {
  image: "🖼️",
  video: "🎬",
  merge: "🎞️",
};

/** صياغة مهمة واحدة للعميل (نتائج الأدوات بالعربية) */
export function formatTaskForClient(task: TaskRow): string {
  const emoji = TYPE_EMOJI[task.type] ?? "📁";
  const label =
    task.type === "image" ? "الصورة" : task.type === "video" ? "الفيديو" : "فيديو الدمج";

  if (task.status === "completed" && task.resultUrls.length) {
    const lines = [
      `✅ اكتملت المهمة بنجاح!`,
      ``,
      `${emoji} رابط ${label}:`,
      ...task.resultUrls.map((u) => u),
    ];
    if (task.type === "merge") {
      lines.push(
        ``,
        `⏳ ملاحظة: الملف المدموج يُحتفظ به على خدمة الدمج لمدة ~24 ساعة فقط — شاهده أو نزّله سريعًا.`
      );
    }
    lines.push(``, `🆔 task_id: ${task.id}`);
    return lines.join("\n");
  }

  if (task.status === "failed") {
    return [
      `❌ فشلت المهمة.`,
      `السبب: ${sanitizeForClient(task.errorMessage) || "خطأ غير محدد"}`,
      ``,
      `🆔 task_id: ${task.id}`,
    ].join("\n");
  }

  // pending / processing — بما فيها مهام «بانتظار مفتاح صالح» (الرسالة الداخلية لا تُعرض)
  const pct = Math.max(0, Math.min(99, task.progress));
  return [
    `⏳ المهمة لا تزال قيد المعالجة… (${pct}%)`,
    ``,
    `🆔 task_id: ${task.id}`,
    `استدعِ get_task بهذا المعرّف كل ~10 ثوانٍ حتى status = completed ثم اعرض الروابط وتوقف عن الاستعلام.`,
  ].join("\n");
}

/** رد no_keys — رسالة المواصفة الحرفية */
export function formatNoKeys(model: string): string {
  return `❌ لا توجد مفاتيح نشطة لخدمة ${model}. أضف مفتاحًا واحدًا على الأقل من واجهة الإدارة، ثم أعد المحاولة.`;
}

export function formatTaskNotFound(): string {
  return `❌ لم يتم العثور على مهمة بهذا المعرّف. تأكد من task_id (انسخه من نتيجة التوليد) ثم أعد المحاولة.`;
}

/** قائمة أحدث الوسائط لـ list_media */
export function formatMediaList(tasks: TaskRow[], filterNote: string): string {
  if (!tasks.length) {
    return `📚 لا توجد وسائط مخزنة بعد${filterNote ? ` (${filterNote})` : ""}. ابدأ بتوليد صورة أو فيديو ثم عد للاستعلام.`;
  }
  const lines = [`📚 أحدث الوسائط المخزنة (${tasks.length})${filterNote ? ` — ${filterNote}` : ""}:`, ``];
  tasks.forEach((t, i) => {
    const typeLabel =
      t.type === "image" ? "صورة" : t.type === "video" ? "فيديو" : "دمج";
    const statusLabel =
      t.status === "completed"
        ? "مكتملة ✅"
        : t.status === "failed"
          ? "فاشلة ❌"
          : "جارية ⏳";
    lines.push(`${i + 1}. [${typeLabel}] ${statusLabel} — ${truncate(t.prompt || t.model, 70)}`);
    lines.push(`   🕒 ${t.createdAt}${t.completedAt ? ` | اكتملت: ${t.completedAt}` : ""}`);
    if (t.resultUrls.length) {
      lines.push(...t.resultUrls.map((u) => `   🔗 ${u}`));
    }
    lines.push(`   🆔 task_id: ${t.id}`);
    lines.push(``);
  });
  lines.push(`للمزيد: استخدم list_media بمعامل limit أكبر، أو get_task لمعرّف محدد.`);
  return lines.join("\n");
}
