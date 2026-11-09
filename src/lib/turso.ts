// طبقة قاعدة البيانات — Turso (libsql) عبر HTTP، إلزامية للتوافق مع Vercel
// ملاحظة: لا تُخزَّن أي ملفات وسائط هنا إطلاقًا — روابط النتائج فقط.
import { createClient, type Client, type InValue } from "@libsql/client";

let _client: Client | null = null;
let _ready: Promise<void> | null = null;

/** عميل واحد مشترك لكل التطبيق (Singleton) */
export function getDb(): Client {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL;
    const token = process.env.TURSO_AUTH_TOKEN;
    if (!url || !token) {
      throw new Error(
        "متغيرات بيئة Turso غير مضبوطة: TURSO_DATABASE_URL و TURSO_AUTH_TOKEN مطلوبان"
      );
    }
    _client = createClient({ url, authToken: token });
  }
  return _client;
}

/** إنشاء الجداول عند أول وصول — بلا أدوات migrations */
export async function ensureSchema(): Promise<void> {
  const db = getDb();
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      provider TEXT,
      provider_task_id TEXT,
      key_id TEXT,
      model TEXT NOT NULL,
      type TEXT NOT NULL,
      prompt TEXT DEFAULT '',
      params_json TEXT DEFAULT '{}',
      status TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      result_urls_json TEXT,
      error_message TEXT,
      attempts_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      label TEXT DEFAULT '',
      api_key TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      usage_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      fail_count INTEGER DEFAULT 0,
      last_used_at TEXT,
      last_checked_at TEXT,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

/** تُستدعى داخليًا قبل أي عملية — تضمن المخطط مرة واحدة لكل نسخة (cold start) */
async function ready(): Promise<void> {
  if (!_ready) {
    _ready = ensureSchema().catch((e) => {
      _ready = null; // اسمح بإعادة المحاولة في الاستدعاء التالي
      throw e;
    });
  }
  await _ready;
}

// ------------------------------- المهام -------------------------------

export type TaskType = "image" | "video" | "merge";
export type TaskStatus = "pending" | "processing" | "completed" | "failed";
export type TaskProvider = "kie" | "cometapi" | "merger";

export interface TaskAttempt {
  provider: string;
  keyId?: string;
  keyLabel?: string;
  ok: boolean;
  errorClass?: string;
  error?: string;
  at: string;
}

export interface TaskRow {
  id: string;
  provider: TaskProvider | null;
  providerTaskId: string | null;
  keyId: string | null;
  model: string;
  type: TaskType;
  prompt: string;
  paramsJson: string;
  status: TaskStatus;
  progress: number;
  resultUrls: string[];
  errorMessage: string | null;
  attempts: TaskAttempt[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface RawTask {
  id: unknown;
  provider: unknown;
  provider_task_id: unknown;
  key_id: unknown;
  model: unknown;
  type: unknown;
  prompt: unknown;
  params_json: unknown;
  status: unknown;
  progress: unknown;
  result_urls_json: unknown;
  error_message: unknown;
  attempts_json: unknown;
  created_at: unknown;
  updated_at: unknown;
  completed_at: unknown;
}

function mapTask(r: Record<string, unknown>): TaskRow {
  const parseJson = <T>(v: unknown, fallback: T): T => {
    if (typeof v !== "string" || !v) return fallback;
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  };
  return {
    id: String(r.id ?? ""),
    provider: (r.provider as TaskProvider) ?? null,
    providerTaskId: (r.provider_task_id as string) ?? null,
    keyId: (r.key_id as string) ?? null,
    model: String(r.model ?? ""),
    type: (r.type as TaskType) ?? "image",
    prompt: String(r.prompt ?? ""),
    paramsJson: String(r.params_json ?? "{}"),
    status: (r.status as TaskStatus) ?? "pending",
    progress: Number(r.progress ?? 0),
    resultUrls: parseJson<string[]>(r.result_urls_json, []),
    errorMessage: (r.error_message as string) ?? null,
    attempts: parseJson<TaskAttempt[]>(r.attempts_json, []),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    completedAt: (r.completed_at as string) ?? null,
  };
}

export interface NewTask {
  id: string;
  model: string;
  type: TaskType;
  prompt?: string;
  params?: Record<string, unknown>;
  provider?: TaskProvider | null;
  providerTaskId?: string | null;
  keyId?: string | null;
  status?: TaskStatus;
}

export async function insertTask(t: NewTask): Promise<TaskRow> {
  await ready();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO tasks (id, provider, provider_task_id, key_id, model, type, prompt, params_json, status, progress)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    args: [
      t.id,
      t.provider ?? null,
      t.providerTaskId ?? null,
      t.keyId ?? null,
      t.model,
      t.type,
      t.prompt ?? "",
      JSON.stringify(t.params ?? {}),
      t.status ?? "pending",
    ] satisfies InValue[],
  });
  const row = await getTask(t.id);
  if (!row) throw new Error("فشل إنشاء المهمة في قاعدة البيانات");
  return row;
}

export async function getTask(id: string): Promise<TaskRow | null> {
  await ready();
  const res = await getDb().execute({
    sql: "SELECT * FROM tasks WHERE id = ? LIMIT 1",
    args: [id],
  });
  return res.rows.length ? mapTask(res.rows[0]) : null;
}

export interface TaskPatch {
  provider?: TaskProvider | null;
  providerTaskId?: string | null;
  keyId?: string | null;
  status?: TaskStatus;
  progress?: number;
  resultUrls?: string[] | null;
  errorMessage?: string | null;
  appendAttempt?: TaskAttempt;
  /** استبدال معطيات المهمة (مثل أعلام تدفق خدمة الدمج) */
  params?: Record<string, unknown>;
  /** يفرض تحديث updated_at حتى لو بقية الحقول كما هي */
  touch?: boolean;
}

/** تحديث جزئي للمهمة: يضيف المحاولات ويضبط completed_at تلقائيًا عند الاكتمال */
export async function updateTask(
  id: string,
  patch: TaskPatch
): Promise<TaskRow | null> {
  await ready();
  const db = getDb();
  const current = await getTask(id);
  if (!current) return null;

  const attempts = [...current.attempts];
  if (patch.appendAttempt) attempts.push(patch.appendAttempt);

  const status = patch.status ?? current.status;
  const resultUrls =
    patch.resultUrls !== undefined ? patch.resultUrls : current.resultUrls;
  const completedAt =
    status === "completed" ? (current.completedAt ?? new Date().toISOString()) : null;
  const paramsJson = patch.params !== undefined ? JSON.stringify(patch.params) : current.paramsJson;

  await db.execute({
    sql: `UPDATE tasks SET
            provider = ?,
            provider_task_id = ?,
            key_id = ?,
            status = ?,
            progress = ?,
            result_urls_json = ?,
            error_message = ?,
            attempts_json = ?,
            params_json = ?,
            completed_at = ?,
            updated_at = datetime('now')
          WHERE id = ?`,
    args: [
      patch.provider !== undefined ? patch.provider : current.provider,
      patch.providerTaskId !== undefined ? patch.providerTaskId : current.providerTaskId,
      patch.keyId !== undefined ? patch.keyId : current.keyId,
      status,
      patch.progress !== undefined ? Math.max(0, Math.min(100, Math.round(patch.progress))) : current.progress,
      resultUrls ? JSON.stringify(resultUrls) : null,
      patch.errorMessage !== undefined ? patch.errorMessage : current.errorMessage,
      JSON.stringify(attempts),
      paramsJson,
      completedAt,
      id,
    ] satisfies InValue[],
  });
  return getTask(id);
}

export async function listRecentTasks(
  limit = 20,
  filter: { type?: string; status?: string } = {}
): Promise<TaskRow[]> {
  await ready();
  const db = getDb();
  const where: string[] = [];
  const args: InValue[] = [];
  if (filter.type && filter.type !== "all") {
    where.push("type = ?");
    args.push(filter.type);
  }
  if (filter.status && filter.status !== "all") {
    where.push("status = ?");
    args.push(filter.status);
  }
  const sql = `SELECT * FROM tasks ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY created_at DESC, id DESC LIMIT ?`;
  args.push(limit);
  const res = await db.execute({ sql, args });
  return res.rows.map((r) => mapTask(r as unknown as Record<string, unknown>));
}

export interface TaskStats {
  total: number;
  completed: number;
  failed: number;
  active: number; // pending + processing
}

export async function taskStats(): Promise<TaskStats> {
  await ready();
  const res = await getDb().execute(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
      COALESCE(SUM(CASE WHEN status IN ('pending','processing') THEN 1 ELSE 0 END), 0) AS active
    FROM tasks
  `);
  const r = res.rows[0] ?? {};
  return {
    total: Number(r.total ?? 0),
    completed: Number(r.completed ?? 0),
    failed: Number(r.failed ?? 0),
    active: Number(r.active ?? 0),
  };
}

// ------------------------------ المفاتيح ------------------------------

export type KeyProvider = "kie" | "cometapi";
export type KeyStatus = "active" | "exhausted" | "disabled";

export interface ApiKeyRow {
  id: string;
  provider: KeyProvider;
  label: string;
  apiKey: string; // لا يُعاد أبدًا للواجهة — يُقنَّع دائمًا
  status: KeyStatus;
  usageCount: number;
  successCount: number;
  failCount: number;
  lastUsedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

function mapKey(r: Record<string, unknown>): ApiKeyRow {
  return {
    id: String(r.id ?? ""),
    provider: (r.provider as KeyProvider) ?? "kie",
    label: String(r.label ?? ""),
    apiKey: String(r.api_key ?? ""),
    status: (r.status as KeyStatus) ?? "active",
    usageCount: Number(r.usage_count ?? 0),
    successCount: Number(r.success_count ?? 0),
    failCount: Number(r.fail_count ?? 0),
    lastUsedAt: (r.last_used_at as string) ?? null,
    lastCheckedAt: (r.last_checked_at as string) ?? null,
    lastError: (r.last_error as string) ?? null,
    createdAt: String(r.created_at ?? ""),
  };
}

/**
 * جلب مفاتيح المزودين المطلوبين بترتيب تسلسلي صارم:
 * أول مفتاح أُضيف يُجرَّب أولًا (created_at ASC) — ليست round-robin وليست الأقل استخدامًا.
 * المفتاح المستنزف (exhausted) يبقى في القائمة عمدًا — الوحيد المستثنى هو disabled.
 */
export async function getKeyPool(providers: string[]): Promise<ApiKeyRow[]> {
  await ready();
  const db = getDb();
  if (!providers.length) return [];
  const placeholders = providers.map(() => "?").join(", ");
  const res = await db.execute({
    sql: `SELECT * FROM api_keys
          WHERE status != 'disabled' AND provider IN (${placeholders})
          ORDER BY created_at ASC, id ASC`,
    args: providers as InValue[],
  });
  return res.rows.map((r) => mapKey(r as unknown as Record<string, unknown>));
}

export async function listKeys(): Promise<ApiKeyRow[]> {
  await ready();
  const res = await getDb().execute(
    "SELECT * FROM api_keys ORDER BY created_at ASC, id ASC"
  );
  return res.rows.map((r) => mapKey(r as unknown as Record<string, unknown>));
}

export async function findDuplicateKey(
  provider: string,
  apiKey: string
): Promise<ApiKeyRow | null> {
  await ready();
  const res = await getDb().execute({
    sql: "SELECT * FROM api_keys WHERE provider = ? AND api_key = ? LIMIT 1",
    args: [provider, apiKey],
  });
  return res.rows.length ? mapKey(res.rows[0]) : null;
}

export async function insertKey(k: {
  id: string;
  provider: KeyProvider;
  label?: string;
  apiKey: string;
}): Promise<ApiKeyRow> {
  await ready();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO api_keys (id, provider, label, api_key, status)
          VALUES (?, ?, ?, ?, 'active')`,
    args: [k.id, k.provider, k.label ?? "", k.apiKey],
  });
  const row = await getKey(k.id);
  if (!row) throw new Error("فشل إدراج المفتاح");
  return row;
}

export async function getKey(id: string): Promise<ApiKeyRow | null> {
  await ready();
  const res = await getDb().execute({
    sql: "SELECT * FROM api_keys WHERE id = ? LIMIT 1",
    args: [id],
  });
  return res.rows.length ? mapKey(res.rows[0]) : null;
}

export async function setKeyStatus(
  id: string,
  status: KeyStatus,
  lastError?: string | null
): Promise<ApiKeyRow | null> {
  await ready();
  const db = getDb();
  const args: InValue[] = [status];
  let sql = "UPDATE api_keys SET status = ?";
  if (lastError !== undefined) {
    sql += ", last_error = ?";
    args.push(lastError);
  }
  sql += ", last_checked_at = datetime('now') WHERE id = ?";
  args.push(id);
  await db.execute({ sql, args });
  return getKey(id);
}

export async function deleteKey(id: string): Promise<boolean> {
  await ready();
  const res = await getDb().execute({
    sql: "DELETE FROM api_keys WHERE id = ?",
    args: [id],
  });
  return res.rowsAffected > 0;
}

/** تحديث عدّادات المفتاح بعد كل محاولة (نجاحًا أو فشلًا) — يُستدعى دائمًا */
export async function recordKeyAttempt(
  keyId: string,
  ok: boolean,
  errorClass?: string,
  error?: string
): Promise<void> {
  await ready();
  const db = getDb();
  await db.execute({
    sql: `UPDATE api_keys SET
            usage_count = usage_count + 1,
            success_count = success_count + ?,
            fail_count = fail_count + ?,
            last_used_at = datetime('now'),
            last_checked_at = datetime('now'),
            last_error = ?
          WHERE id = ?`,
    args: [ok ? 1 : 0, ok ? 0 : 1, ok ? null : (`[${errorClass ?? "unknown"}] ${error ?? "خطأ غير معروف"}`).slice(0, 500), keyId] satisfies InValue[],
  });
  if (!ok && (errorClass === "disabled" || errorClass === "exhausted")) {
    await setKeyStatus(keyId, errorClass === "disabled" ? "disabled" : "exhausted");
  }
}

export async function countActiveKeys(): Promise<number> {
  await ready();
  const res = await getDb().execute(
    "SELECT COUNT(*) AS n FROM api_keys WHERE status != 'disabled'"
  );
  return Number(res.rows[0]?.n ?? 0);
}

/** فحص جهوزية قاعدة البيانات */
export async function dbHealthy(): Promise<boolean> {
  try {
    const res = await getDb().execute("SELECT 1 AS ok");
    return res.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}
