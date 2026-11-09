// GET /api/stats — إحصاءات المهام + جهوزية النظام للوحة الإدارة
import { NextResponse } from "next/server";
import { taskStats, countActiveKeys, listKeys } from "@/lib/turso";
import { mergerConfigured } from "@/lib/merger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [stats, activeKeys, allKeys] = await Promise.all([
      taskStats(),
      countActiveKeys(),
      listKeys(),
    ]);
    return NextResponse.json({
      stats,
      keys: {
        total: allKeys.length,
        active: allKeys.filter((k) => k.status === "active").length,
        exhausted: allKeys.filter((k) => k.status === "exhausted").length,
        disabled: allKeys.filter((k) => k.status === "disabled").length,
        usable: activeKeys, // غير المعطلة (تشمل exhausted — تبقى في الترتيب)
      },
      merger: { configured: mergerConfigured() },
      mcp: { authRequired: Boolean(process.env.MCP_ACCESS_TOKEN) },
      version: "1.2.0",
    });
  } catch (e) {
    return NextResponse.json(
      { error: `تعذر جلب الإحصاءات: ${e instanceof Error ? e.message : "خطأ غير معروف"}` },
      { status: 500 }
    );
  }
}
