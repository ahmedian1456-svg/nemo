// GET /api/health — فحص الجهوزية (قاعدة البيانات + المفاتيح + خدمة الدمج + الحماية)
import { NextResponse } from "next/server";
import { dbHealthy, countActiveKeys, ensureSchema } from "@/lib/turso";
import { mergerConfigured } from "@/lib/merger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await ensureSchema();
    const [db, activeKeys] = await Promise.all([dbHealthy(), countActiveKeys()]);
    return NextResponse.json({
      ok: db,
      version: "1.2.0",
      service: "media-generator-mcp",
      db,
      activeKeys,
      merger: { configured: mergerConfigured() },
      auth: { mcpToken: Boolean(process.env.MCP_ACCESS_TOKEN) },
      latencyMs: Date.now() - started,
      time: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        version: "1.2.0",
        service: "media-generator-mcp",
        db: false,
        error: e instanceof Error ? e.message : "خطأ غير معروف",
        latencyMs: Date.now() - started,
        time: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
