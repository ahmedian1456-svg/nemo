// اختبار سريع للاتصال بقاعدة Turso وإنشاء المخطط
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;
if (!url || !token) { console.error("MISSING ENV"); process.exit(1); }

const client = createClient({ url, authToken: token });
const t = await client.execute("SELECT 1 AS ok");
console.log("SELECT 1:", JSON.stringify(t.rows));

await client.execute(`CREATE TABLE IF NOT EXISTS api_keys (
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
)`);
const keys = await client.execute("SELECT COUNT(*) AS n FROM api_keys");
console.log("api_keys count:", keys.rows[0].n);
console.log("TURSO OK");
