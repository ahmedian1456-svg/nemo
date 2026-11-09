// تدفق دمج الفيديوهات — قواعد 7.3:
// 1) تحقق صارم: ≥2 رابط http/https مباشر عام، ≤10 مقاطع (رفض بأكثر)
// 2) تسجيل مهمة type=merge في Turso أولًا
// 3) POST /api/jobs ثم تنفيذ /process خلفيًا وبمرة واحدة فقط (قفل في الذاكرة + علم محفوظ)
// 4) استعلام كل 3 ثوانٍ مع بث تقدم وكتابة الحالة في Turso فورًا
// 5) أي خطأ HTTP معلن من الخدمة = فشل نهائي فوري (لا إعادة محاولة)
//    أخطاء شبكتنا نحن (timeout/fetch) = مؤقتة → استمرار الاستعلام حتى انتهاء النافذة
import {
  type TaskRow,
  insertTask,
  getTask,
  updateTask,
} from "@/lib/turso";
import {
  mergerBase,
  mergerConfigured,
  mergerCreateJob,
  mergerProcess,
  mergerGetJob,
  type MergerStatus,
} from "@/lib/merger";
import { truncate } from "@/lib/errors";

export type MergeOutcome =
  | { kind: "completed" | "processing" | "failed"; task: TaskRow }
  | { kind: "config_error" | "validation_error"; message: string };

export type ProgressCallback = (progress: number, message: string) => Promise<void> | void;

/** قفل في الذاكرة يمنع تزامن POST /process مع get_task */
const processInFlight = new Set<string>();
/** قفل منع تزامن إعادة إنشاء مهمة الدمج */
const creationInFlight = new Set<string>();

const POLL_INTERVAL_MS = 3_000;
export const DEFAULT_MERGE_WAIT_SECONDS = 60;

function iso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** رابط http/https مباشر وعام (لا localhost ولا شبكات داخلية) */
export function isPublicHttpUrl(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const h = url.hostname.toLowerCase();
    if (!h) return false;
    if (h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "[::1]") return false;
    if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    if (h.endsWith(".internal") || h.endsWith(".local")) return false;
    return true;
  } catch {
    return false;
  }
}

/** حل روابط task_ids: مهام فيديو مكتملة تُحل روابطها بالترتيب */
async function resolveTaskUrls(taskIds: string[]): Promise<{ urls: string[]; error?: string }> {
  const urls: string[] = [];
  for (const id of taskIds) {
    const t = await getTask(id.trim());
    if (!t) return { urls: [], error: `لم يتم العثور على مهمة بالمعرّف «${truncate(id, 40)}».` };
    if (t.type !== "video") return { urls: [], error: `المهمة «${truncate(id, 40)}» ليست مهمة فيديو.` };
    if (t.status !== "completed" || !t.resultUrls.length) {
      return { urls: [], error: `المهمة «${truncate(id, 40)}» لم تكتمل بعد (${t.status}) — أكملها أولًا ثم أعد الدمج.` };
    }
    urls.push(t.resultUrls[0]);
  }
  return { urls };
}

export async function runMerge(opts: {
  urls?: string[];
  taskIds?: string[];
  waitSeconds?: number;
  onProgress?: ProgressCallback;
}): Promise<MergeOutcome> {
  // 0) الخدمة مهيأة؟
  if (!mergerConfigured()) {
    return {
      kind: "config_error",
      message:
        "خدمة الدمج غير مهيأة على السيرفر — يجب ضبط متغير البيئة MERGER_API_BASE بعنوان خدمة الدمج الفعلي قبل استخدام الدمج.",
    };
  }

  // 1) جمع الروابط: روابط task_ids أولًا ثم urls المباشرة بنفس ترتيبها
  const fromTasks = opts.taskIds?.length ? await resolveTaskUrls(opts.taskIds) : { urls: [] as string[] };
  if (fromTasks.error) return { kind: "validation_error", message: `❌ ${fromTasks.error}` };
  const direct = (opts.urls ?? []).map((u) => u.trim()).filter(Boolean);
  const combined = [...fromTasks.urls, ...direct];

  if (combined.length < 2) {
    return {
      kind: "validation_error",
      message: "❌ يلزم مقطعان على الأقل للدمج — مرر روابط مباشرة في urls أو معرّفات مهام فيديو مكتملة في task_ids.",
    };
  }
  if (combined.length > 10) {
    return {
      kind: "validation_error",
      message: "❌ أقصى عدد مقاطع للدمج هو 10 (خدمة الدمج تقبل 10 مقاطع كحد أقصى).",
    };
  }
  const bad = combined.find((u) => !isPublicHttpUrl(u));
  if (bad) {
    return {
      kind: "validation_error",
      message: `❌ رابط غير صالح: يجب أن تكون كل المقاطع روابط http/https مباشرة وعامة. المرفوض: ${truncate(bad, 80)}`,
    };
  }

  // 2) تسجيل المهمة في Turso أولًا
  const taskId = crypto.randomUUID();
  const promptSummary = `دمج ${combined.length} مقاطع`;
  const params: Record<string, unknown> = {
    urls: combined,
    wait_seconds: opts.waitSeconds ?? DEFAULT_MERGE_WAIT_SECONDS,
    processStarted: false,
  };
  await insertTask({
    id: taskId,
    type: "merge",
    provider: "merger",
    model: "video-merger",
    prompt: promptSummary,
    params,
    status: "pending",
  });

  // 3) إنشاء مهمة الدمج لدى الخدمة
  let jobId: string;
  try {
    const created = await mergerCreateJob(combined);
    jobId = created.jobId;
  } catch (e) {
    // خطأ شبكتنا → مؤقت: تبقى processing وتُعاد المحاولة مع get_task
    const msg = e instanceof Error ? e.message : String(e);
    if (/timeout|fetch failed|network|ECONN/i.test(msg)) {
      const t = await updateTask(taskId, {
        status: "processing",
        errorMessage: "تعذر الوصول لخدمة الدمج (شبكة) — ستُعاد المحاولة تلقائيًا",
      });
      return { kind: "processing", task: t! };
    }
    // خطأ HTTP معلن من الخدمة → فشل نهائي فوري
    const t = await updateTask(taskId, {
      status: "failed",
      errorMessage: `فشل إنشاء مهمة الدمج: ${truncate(msg, 200)}`,
    });
    return { kind: "failed", task: t! };
  }

  let t = await updateTask(taskId, {
    provider: "merger",
    providerTaskId: jobId,
    status: "processing",
    progress: 5,
  });

  // 4) تنفيذ process مرة واحدة ثم الاستعلام حتى انتهاء النافذة
  const waitMs = Math.max(0, Math.min(240, opts.waitSeconds ?? DEFAULT_MERGE_WAIT_SECONDS)) * 1000;
  const outcome = await pollMergeUntil(taskId, jobId, waitMs, opts.onProgress);
  return outcome;
}

/** تنفيذ POST /process مرة واحدة فقط لكل مهمة (قفل ذاكرة + علم محفوظ في params) */
async function triggerProcessIfNeeded(task: TaskRow, jobId: string): Promise<void> {
  if (processInFlight.has(task.id)) return;
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(task.paramsJson) as Record<string, unknown>;
  } catch {
    /* معطيات غير صالحة → نعاملها فارغة */
  }
  if (params.processStarted === true) return; // نُفِّذ سابقًا (أو قيد التنفيذ) — مرة واحدة فقط

  processInFlight.add(task.id);
  try {
    // ضبط العلم قبل النداء حتى لا يتكرر لو تزامن مع get_task
    await updateTask(task.id, { params: { ...params, processStarted: true } });
    const r = await mergerProcess(jobId);
    if (r.error && !r.done) {
      // تمييز فشل الخدمة الحتمي عن خطأ شبكتنا المؤقت
      if (!/timeout|fetch failed|network|ECONN|aborted/i.test(r.error)) {
        await updateTask(task.id, {
          status: "failed",
          errorMessage: `فشل الدمج: ${truncate(r.error, 200)}`,
        });
      }
      // خطأ شبكة: نترك الحالة processing — الاستعلام التالي (GET) سيكشف النتيجة الفعلية
    } else if (r.result?.status === "done" && r.result.resultUrl) {
      await updateTask(task.id, {
        status: "completed",
        progress: 100,
        resultUrls: [r.result.resultUrl],
        errorMessage: null,
      });
    }
  } finally {
    processInFlight.delete(task.id);
  }
}

/** استعلام دوري كل 3 ثوانٍ حتى الاكتمال أو الفشل النهائي أو انتهاء النافذة */
async function pollMergeUntil(
  taskId: string,
  jobId: string,
  waitMs: number,
  onProgress?: ProgressCallback
): Promise<MergeOutcome> {
  const deadline = Date.now() + waitMs;
  let lastReported = -1;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    if (Date.now() >= deadline) break;

    const res = await mergerGetJob(jobId);

    if (res.ok && res.status) {
      const st: MergerStatus = res.status;
      if (st.status === "done") {
        const t = await updateTask(taskId, {
          status: "completed",
          progress: 100,
          resultUrls: [st.resultUrl],
          errorMessage: null,
        });
        return { kind: "completed", task: t! };
      }
      if (st.status === "failed") {
        // خطأ HTTP معلن من الخدمة = فشل نهائي فوري — لا إعادة محاولة
        const t = await updateTask(taskId, {
          status: "failed",
          errorMessage: `فشل الدمج: ${truncate(st.error ?? "خطأ غير معروف من خدمة الدمج", 200)}`,
        });
        return { kind: "failed", task: t! };
      }
      const p = Math.max(5, Math.min(95, st.progress));
      if (p !== lastReported) {
        lastReported = p;
        await updateTask(taskId, { status: "processing", progress: p });
        try {
          await onProgress?.(p, `قيد الدمج… ${p}%`);
        } catch {
          /* الإشعارات ليست حرجة */
        }
      }
      continue;
    }

    if (res.notFound) {
      const t = await updateTask(taskId, {
        status: "failed",
        errorMessage: "مهمة الدمج غير موجودة في الخدمة (حُذفت أو انتهت صلاحيتها بعد 24 ساعة)",
      });
      return { kind: "failed", task: t! };
    }
    // أخطاء شبكتنا نحن = مؤقتة → استمر بالاستعلام حتى انتهاء النافذة
  }

  const t = await updateTask(taskId, { status: "processing" });
  return { kind: "processing", task: t! };
}

/** get_task لمهمة دمج — تحديث حي من الخدمة مع تنفيذ process إن لم يُنفَّذ بعد */
export async function refreshMergeTask(task: TaskRow): Promise<TaskRow> {
  if (task.status === "completed" || task.status === "failed") return task;

  // لا معرّف مهمة بعد (فشل الوصول سابقًا) → أعد الإنشاء مرة واحدة مع قفل
  if (!task.providerTaskId) {
    if (creationInFlight.has(task.id)) return (await getTask(task.id)) ?? task;
    creationInFlight.add(task.id);
    try {
      let params: Record<string, unknown> = {};
      try {
        params = JSON.parse(task.paramsJson) as Record<string, unknown>;
      } catch {
        /* تجاهل */
      }
      const urls = Array.isArray(params.urls) ? (params.urls as string[]) : [];
      if (urls.length < 2) {
        return (await updateTask(task.id, {
          status: "failed",
          errorMessage: "معطيات الدمج غير مكتملة في قاعدة البيانات",
        }))!;
      }
      const created = await mergerCreateJob(urls);
      return (await updateTask(task.id, {
        provider: "merger",
        providerTaskId: created.jobId,
        status: "processing",
        progress: 5,
      }))!;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/timeout|fetch failed|network|ECONN/i.test(msg)) {
        return (await updateTask(task.id, {
          status: "processing",
          errorMessage: "تعذر الوصول لخدمة الدمج (شبكة) — ستُعاد المحاولة تلقائيًا",
        }))!;
      }
      return (await updateTask(task.id, {
        status: "failed",
        errorMessage: `فشل إنشاء مهمة الدمج: ${truncate(msg, 200)}`,
      }))!;
    } finally {
      creationInFlight.delete(task.id);
    }
  }

  const jobId = task.providerTaskId;
  // إن كانت processing ولم يُنفَّذ process بعد فنفّذه الآن
  await triggerProcessIfNeeded(task, jobId);

  const res = await mergerGetJob(jobId);
  if (res.ok && res.status) {
    const st = res.status;
    if (st.status === "done") {
      return (await updateTask(task.id, {
        status: "completed",
        progress: 100,
        resultUrls: [st.resultUrl],
        errorMessage: null,
      }))!;
    }
    if (st.status === "failed") {
      return (await updateTask(task.id, {
        status: "failed",
        errorMessage: `فشل الدمج: ${truncate(st.error ?? "خطأ غير معروف من خدمة الدمج", 200)}`,
      }))!;
    }
    return (await updateTask(task.id, {
      status: "processing",
      progress: Math.max(task.progress, Math.min(95, st.progress)),
    }))!;
  }
  if (res.notFound) {
    return (await updateTask(task.id, {
      status: "failed",
      errorMessage: "مهمة الدمج غير موجودة في الخدمة (حُذفت أو انتهت صلاحيتها بعد 24 ساعة)",
    }))!;
  }
  // خطأ شبكتنا — تبقى قيد المعالجة
  return (await getTask(task.id)) ?? task;
}

/** رابط الخدمة للعرض في الواجهة (مع إخفاء العنوان إن كان placeholder) */
export function mergerDisplayBase(): string {
  return mergerConfigured() ? mergerBase() : "غير مهيأة";
}
