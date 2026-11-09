// منسّق التوليد — يدير المهام عبر مرشّحي المفاتيح بالترتيب التسلسلي الصارم
// القواعد الجوهرية:
// 1) أول مفتاح أُضيف يُجرَّب أولًا ثم التالي… (وليس round-robin)
// 2) عند أي خطأ مفتاح/رصيد: نفس المهمة بنفس task_id تُستأنف على المفتاح التالي
// 3) إذا فشل الجميع: تبقى المهمة processing (ليست failed) وتُعاد المحاولة مع كل get_task (تهدئة 45ث)
// 4) العميل (نموذج الذكاء الاصطناعي) لا يرى أخطاء المفاتيح أو الرصيد أبدًا
import {
  type TaskRow,
  type TaskType,
  type ApiKeyRow,
  getKeyPool,
  insertTask,
  getTask,
  updateTask,
  recordKeyAttempt,
  getKey,
} from "@/lib/turso";
import type { ModelDef, ProviderId } from "@/lib/models";
import { findModel } from "@/lib/models";
import { getAdapter, ProviderError, type KeyRef, type CheckResult } from "@/lib/providers";
import {
  classifyProviderError,
  clientSafeMessage,
  isKeyishFailure,
  truncate,
} from "@/lib/errors";

export const POLL_INTERVAL_MS = 3_000;
export const RETRY_COOLDOWN_MS = 45_000;
export const DEFAULT_WAIT_SECONDS: Record<TaskType, number> = {
  image: 90,
  video: 25,
  merge: 60,
};

export type GenerationOutcome =
  | { kind: "completed" | "processing" | "failed"; task: TaskRow }
  | { kind: "no_keys"; model: string };

export type ProgressCallback = (progress: number, message: string) => Promise<void> | void;

/** قفل في الذاكرة يمنع إعادة إنشاء متزامنة لنفس المهمة (كل نسخة serverless على حدة) */
const creationInFlight = new Set<string>();

function keyRef(k: ApiKeyRow): KeyRef {
  return { id: k.id, provider: k.provider, label: k.label, apiKey: k.apiKey };
}

function iso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** تطبيع معطيات الأداة إلى حقل input دلالي موحد يفهمه كل المزودون */
export interface NormalizedInput {
  prompt: string;
  image_urls?: string[];
  aspect_ratio?: string;
  resolution?: string;
  background?: string;
  output_format?: string;
  duration?: number;
  enable_audio?: boolean;
}

export function normalizeInput(type: TaskType, params: Record<string, unknown>): NormalizedInput {
  const input: NormalizedInput = { prompt: String(params.prompt ?? "") };
  const imageUrl = params.image_url;
  if (typeof imageUrl === "string" && imageUrl.trim()) {
    input.image_urls = [imageUrl.trim()];
  }
  if (typeof params.aspect_ratio === "string") input.aspect_ratio = params.aspect_ratio;
  if (typeof params.resolution === "string") input.resolution = params.resolution;
  if (type === "image") {
    // background يُطبَّق عند 1K فقط حسب المواصفة
    if (typeof params.background === "string" && String(params.resolution ?? "1K") === "1K") {
      input.background = params.background;
    }
    if (typeof params.output_format === "string") input.output_format = params.output_format;
  }
  if (type === "video") {
    if (typeof params.duration === "number") input.duration = params.duration;
    if (typeof params.enable_audio === "boolean") input.enable_audio = params.enable_audio;
  }
  return input;
}

export async function runGeneration(opts: {
  type: "image" | "video";
  modelName: string;
  params: Record<string, unknown>;
  waitSeconds?: number;
  onProgress?: ProgressCallback;
}): Promise<GenerationOutcome> {
  const { type, params, onProgress } = opts;

  // 1) توحيد اسم الموديل — غير معروف → خطأ معطيات فوري (يُعالج في الأداة)
  const model: ModelDef | null = findModel(opts.modelName);
  if (!model || model.type !== type) {
    const err = new Error(`model_not_found:${opts.modelName}`);
    (err as Error & { paramsError?: boolean }).paramsError = true;
    throw err;
  }

  // 2) مسبح المفاتيح بالترتيب التسلسلي الصارم
  const pool = await getKeyPool(model.providers);
  if (!pool.length) return { kind: "no_keys", model: model.canonical };

  const input = normalizeInput(type, params);
  const waitMs = Math.max(0, Math.min(240, opts.waitSeconds ?? DEFAULT_WAIT_SECONDS[type])) * 1000;
  const promptText = String(params.prompt ?? "");

  // 3) تسجيل المهمة في Turso قبل أي نداء خارجي — تبقى قابلة للتتبع مهما حدث
  const taskId = crypto.randomUUID();
  await insertTask({
    id: taskId,
    model: model.canonical,
    type,
    prompt: promptText,
    params,
    status: "pending",
  });

  // 4) تجربة المرشحين بالترتيب حتى نجاح الإنشاء ثم نافذة الانتظار
  for (const key of pool) {
    const adapter = getAdapter(key.provider as ProviderId);
    const providerModel = model.providerModel[key.provider as ProviderId] ?? model.canonical;
    const attemptBase = { provider: key.provider, keyId: key.id, keyLabel: key.label };

    let providerTaskId: string | null = null;
    let syncUrls: string[] | null = null;

    try {
      if (type === "image" && adapter.createImageSync) {
        const r = await adapter.createImageSync(keyRef(key), providerModel, input as unknown as Record<string, unknown>);
        syncUrls = r.urls;
      } else {
        const r = await adapter.createTask(keyRef(key), providerModel, input as unknown as Record<string, unknown>);
        providerTaskId = r.providerTaskId;
      }
    } catch (e) {
      // حالة خاصة: CometAPI قد يعيد معرّف مهمة صور غير متزامنة داخل الخطأ
      const m = e instanceof Error ? e.message.match(/^async_image_task:(.+)$/) : null;
      if (m) {
        providerTaskId = m[1];
      } else {
        const { cls, message } = classifyProviderError(e);
        // عدّادات المفتاح تُحدَّث دائمًا (نجاحًا أو فشلًا)
        await recordKeyAttempt(key.id, false, cls, message);
        await updateTask(taskId, {
          appendAttempt: { ...attemptBase, ok: false, errorClass: cls, error: truncate(message, 300), at: iso() },
        });
        if (cls === "params") {
          // توقف فورًا — تبديل المفاتيح لن يحل خطأ معطيات
          const failed = await updateTask(taskId, {
            status: "failed",
            progress: 0,
            errorMessage: clientSafeMessage("params", message),
          });
          return { kind: "failed", task: failed! };
        }
        // disabled / exhausted / provider / temporary → انتقل للمفتاح التالي فورًا
        continue;
      }
    }

    // نجاح الإنشاء — اربط المهمة بالمزود والمفتاح
    await recordKeyAttempt(key.id, true);
    if (syncUrls?.length) {
      // صورة متزامنة اكتملت فورًا
      const t = await updateTask(taskId, {
        ...{ provider: key.provider as TaskRow["provider"] },
        providerTaskId: `sync:${Date.now()}`,
        keyId: key.id,
        status: "completed",
        progress: 100,
        resultUrls: syncUrls,
        appendAttempt: { ...attemptBase, ok: true, at: iso() },
      });
      return { kind: "completed", task: t! };
    }

    const t = await updateTask(taskId, {
      provider: key.provider as TaskRow["provider"],
      providerTaskId,
      keyId: key.id,
      status: "processing",
      progress: 3,
      appendAttempt: { ...attemptBase, ok: true, at: iso() },
    });

    // 5) نافذة الانتظار مع بث التقدم كل ~3 ثوانٍ
    const outcome = await waitForCompletion(taskId, keyRef(key), adapter, providerTaskId!, waitMs, onProgress);

    if (outcome.kind === "completed") {
      return { kind: "completed", task: outcome.task };
    }
    if (outcome.kind === "failed_real") {
      const failed = await updateTask(taskId, {
        status: "failed",
        errorMessage: outcome.safeMessage,
      });
      return { kind: "failed", task: failed! };
    }
    if (outcome.kind === "key_failure") {
      // فشل مفتاح/رصيد في منتصف المهمة → نفس task_id يُستأنف على المفتاح التالي
      continue;
    }
    // انتهت النافذة والنتيجة لم تظهر → processing والعميل يتابع بـ get_task
    return { kind: "processing", task: t };
  }

  // 6) استُنفد كل المرشحين دون نجاح — المهمة تبقى processing بانتظار مفتاح صالح
  //    (رسالة داخلية فقط؛ العميل يرى «قيد المعالجة»)
  const t = await updateTask(taskId, {
    status: "processing",
    progress: 0,
    errorMessage: "بانتظار توفر مفتاح صالح…",
  });
  return { kind: "processing", task: t! };
}

interface WaitOutcome {
  kind: "completed" | "failed_real" | "key_failure" | "window_expired";
  task?: TaskRow;
  safeMessage?: string;
}

/** استعلام دوري كل 3 ثوانٍ حتى الاكتمال أو الفشل الحقيقي أو انتهاء النافذة */
async function waitForCompletion(
  taskId: string,
  key: KeyRef,
  adapter: ReturnType<typeof getAdapter>,
  providerTaskId: string,
  waitMs: number,
  onProgress?: ProgressCallback
): Promise<WaitOutcome> {
  const deadline = Date.now() + waitMs;
  let lastReported = -1;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    if (Date.now() >= deadline) break;

    let check: CheckResult;
    try {
      check = await adapter.checkTask(key, providerTaskId);
    } catch (e) {
      const { cls, message } = classifyProviderError(e);
      await recordKeyAttempt(key.id, false, cls, message);
      await updateTask(taskId, {
        appendAttempt: {
          provider: key.provider,
          keyId: key.id,
          keyLabel: key.label,
          ok: false,
          errorClass: cls,
          error: truncate(message, 300),
          at: iso(),
        },
      });
      if (cls === "temporary" || cls === "params") continue; // نكمل النافذة على نفس المفتاح
      return { kind: "key_failure" }; // disabled/exhausted → المفتاح التالي
    }

    if (check.status === "completed" && check.urls?.length) {
      const t = await updateTask(taskId, {
        status: "completed",
        progress: 100,
        resultUrls: check.urls,
        errorMessage: null,
      });
      return { kind: "completed", task: t! };
    }

    if (check.status === "failed") {
      const msg = check.error ?? "فشل التوليد لدى المزود";
      // فشل رسالته تطابق مشكلات مفتاح/رصيد → استئناف على المفتاح التالي بنفس task_id
      if (isKeyishFailure(msg)) return { kind: "key_failure" };
      // فشل حقيقي (انتهاك سياسة/معطيات) → نهائي
      return { kind: "failed_real", safeMessage: `فشل التوليد: ${truncate(msg, 240)}` };
    }

    const progress = Math.max(3, Math.min(95, Math.round(check.progress ?? 0)));
    if (progress !== lastReported) {
      lastReported = progress;
      await updateTask(taskId, { status: "processing", progress });
      try {
        await onProgress?.(progress, `قيد التوليد… ${progress}%`);
      } catch {
        // إشعارات التقدم ليست حرجة — تجاهل أي خطأ
      }
    }
  }
  return { kind: "window_expired" };
}

/**
 * تحديث حي للمهمة عند get_task — استعلام واحد من المزود مع نفس منطق التبديل:
 * فشل مفتاحي → إعادة إنشاء بنفس task_id على المفتاح التالي فورًا.
 */
export async function refreshTask(taskId: string): Promise<TaskRow | null> {
  const task = await getTask(taskId);
  if (!task) return null;

  // المهام المنتهية تُعاد كما هي بلا نداء خارجي
  if (task.status === "completed" || task.status === "failed") return task;

  if (task.type === "merge") {
    // تُدار في merge.ts لتجنب الاستدعاء الدائري
    const { refreshMergeTask } = await import("@/lib/merge");
    return refreshMergeTask(task);
  }

  const model = findModel(task.model);
  if (!model) return task;

  // حالة أ: مهمة مرتبطة بمزود ومفتاح
  if (task.provider && task.providerTaskId) {
    const key = task.keyId ? await getKey(task.keyId) : null;
    if (key && key.status !== "disabled") {
      const adapter = getAdapter(key.provider);
      try {
        const check = await adapter.checkTask(keyRef(key), task.providerTaskId);
        if (check.status === "completed" && check.urls?.length) {
          return (await updateTask(task.id, {
            status: "completed",
            progress: 100,
            resultUrls: check.urls,
            errorMessage: null,
          }))!;
        }
        if (check.status === "failed") {
          const msg = check.error ?? "فشل التوليد لدى المزود";
          if (isKeyishFailure(msg)) {
            return recreateTaskOnNextKey(task, key.id, model);
          }
          return (await updateTask(task.id, {
            status: "failed",
            errorMessage: `فشل التوليد: ${truncate(msg, 240)}`,
          }))!;
        }
        // ما تزال قيد المعالجة — حدّث التقدم
        return (await updateTask(task.id, {
          status: "processing",
          progress: Math.max(task.progress, Math.min(95, Math.round(check.progress ?? task.progress))),
        }))!;
      } catch (e) {
        const { cls, message } = classifyProviderError(e);
        await recordKeyAttempt(key.id, false, cls, message);
        await updateTask(task.id, {
          appendAttempt: {
            provider: key.provider,
            keyId: key.id,
            keyLabel: key.label,
            ok: false,
            errorClass: cls,
            error: truncate(message, 300),
            at: iso(),
          },
        });
        if (cls === "temporary") return task; // خطأ عابر — يُستعلم لاحقًا
        return recreateTaskOnNextKey(task, key.id, model);
      }
    }
    // المفتاح المربوط معطل/محذوف → أعد الإنشاء على المتاح
    return recreateTaskOnNextKey(task, task.keyId ?? undefined, model);
  }

  // حالة ب: لم يُنشأ لدى المزود بعد (بانتظار مفتاح صالح) — هدئة 45ث ثم إعادة محاولة
  const lastAt = task.attempts.length ? Date.parse(task.attempts[task.attempts.length - 1].at) : 0;
  if (Number.isFinite(lastAt) && Date.now() - lastAt < RETRY_COOLDOWN_MS) return task;
  return recreateTaskOnNextKey(task, undefined, model);
}

/** إعادة إنشاء نفس المهمة بنفس task_id على المفاتيح المتاحة (بدءًا بعد المفتاح الفاشل) */
async function recreateTaskOnNextKey(
  task: TaskRow,
  failedKeyId: string | undefined,
  model: ModelDef
): Promise<TaskRow> {
  if (creationInFlight.has(task.id)) {
    const fresh = await getTask(task.id);
    return fresh ?? task;
  }
  creationInFlight.add(task.id);
  try {
    const pool = await getKeyPool(model.providers);
    const type = task.type as "image" | "video";
    const params = (() => {
      try {
        return JSON.parse(task.paramsJson) as Record<string, unknown>;
      } catch {
        return {} as Record<string, unknown>;
      }
    })();
    const input = normalizeInput(type, params);

    let startIndex = 0;
    if (failedKeyId) {
      const idx = pool.findIndex((k) => k.id === failedKeyId);
      if (idx >= 0) startIndex = idx + 1;
    }

    for (let i = startIndex; i < pool.length; i++) {
      const key = pool[i];
      const adapter = getAdapter(key.provider as ProviderId);
      const providerModel = model.providerModel[key.provider as ProviderId] ?? model.canonical;
      const attemptBase = { provider: key.provider, keyId: key.id, keyLabel: key.label };

      let providerTaskId: string | null = null;
      let syncUrls: string[] | null = null;
      try {
        if (type === "image" && adapter.createImageSync) {
          const r = await adapter.createImageSync(keyRef(key), providerModel, input as unknown as Record<string, unknown>);
          syncUrls = r.urls;
        } else {
          const r = await adapter.createTask(keyRef(key), providerModel, input as unknown as Record<string, unknown>);
          providerTaskId = r.providerTaskId;
        }
      } catch (e) {
        const m = e instanceof Error ? e.message.match(/^async_image_task:(.+)$/) : null;
        if (m) providerTaskId = m[1];
        else {
          const { cls, message } = classifyProviderError(e);
          await recordKeyAttempt(key.id, false, cls, message);
          await updateTask(task.id, {
            appendAttempt: { ...attemptBase, ok: false, errorClass: cls, error: truncate(message, 300), at: iso() },
          });
          if (cls === "params") {
            return (await updateTask(task.id, {
              status: "failed",
              errorMessage: clientSafeMessage("params", message),
            }))!;
          }
          continue;
        }
      }

      await recordKeyAttempt(key.id, true);
      if (syncUrls?.length) {
        return (await updateTask(task.id, {
          provider: key.provider as TaskRow["provider"],
          providerTaskId: `sync:${Date.now()}`,
          keyId: key.id,
          status: "completed",
          progress: 100,
          resultUrls: syncUrls,
          errorMessage: null,
          appendAttempt: { ...attemptBase, ok: true, at: iso() },
        }))!;
      }
      return (await updateTask(task.id, {
        provider: key.provider as TaskRow["provider"],
        providerTaskId,
        keyId: key.id,
        status: "processing",
        progress: 3,
        errorMessage: null,
        appendAttempt: { ...attemptBase, ok: true, at: iso() },
      }))!;
    }

    // لا مرشحين متاحين — تبقى processing بانتظار مفتاح
    return (await updateTask(task.id, {
      status: "processing",
      errorMessage: "بانتظار توفر مفتاح صالح…",
    }))!;
  } finally {
    creationInFlight.delete(task.id);
  }
}
