// تهيئة أولية: إدخال مفتاح kie.ai في قاعدة Turso (idempotent — لا يكرر المفتاح)
// الاستخدام: KIE_SEED_KEY=... KIE_SEED_LABEL=... bun scripts/seed-key.mjs
import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

// قراءة .env.local يدويًا إن لم تتوفر المتغيرات في البيئة
function loadEnvFile() {
  try {
    const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* لا ملف بيئة — نعتمد على متغيرات البيئة */
  }
}
loadEnvFile();

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
const key = process.env.KIE_SEED_KEY;
const label = process.env.KIE_SEED_LABEL ?? "kie الرئيسي";

if (!url || !token) {
  console.error("مطلوب: TURSO_DATABASE_URL و TURSO_AUTH_TOKEN");
  process.exit(1);
}
if (!key) {
  console.log("لا يوجد KIE_SEED_KEY — تخطي التهيئة (سيُضاف المفتاح من الواجهة لاحقًا)");
  process.exit(0);
}

const db = createClient({ url, authToken: token });

await db.execute(`CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, label TEXT DEFAULT '', api_key TEXT NOT NULL,
  status TEXT DEFAULT 'active', usage_count INTEGER DEFAULT 0, success_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0, last_used_at TEXT, last_checked_at TEXT, last_error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`);

const dup = await db.execute({
  sql: "SELECT id FROM api_keys WHERE provider = 'kie' AND api_key = ? LIMIT 1",
  args: [key],
});
if (dup.rows.length) {
  console.log("مفتاح kie موجود مسبقًا — لا حاجة للإضافة");
} else {
  await db.execute({
    sql: "INSERT INTO api_keys (id, provider, label, api_key, status) VALUES (?, 'kie', ?, ?, 'active')",
    args: [randomUUID(), label, key],
  });
  console.log("تمت إضافة مفتاح kie إلى قاعدة البيانات ✅ (سيُجرَّب أولًا ضمن الترتيب التسلسلي)");
}
const n = await db.execute("SELECT COUNT(*) AS n FROM api_keys WHERE status != 'disabled'");
console.log("عدد المفاتيح الصالحة:", n.rows[0].n);
