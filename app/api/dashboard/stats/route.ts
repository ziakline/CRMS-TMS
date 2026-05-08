import { getDashboardStats } from "../../../../lib/dashboard-stats";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const yearParam = Number(searchParams.get("year"));
    const selectedYear = Number.isFinite(yearParam) ? yearParam : undefined;
    const stats = await getDashboardStats(selectedYear);
    return Response.json(stats, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch dashboard stats:", error);
    return Response.json(
      { message: "대시보드 통계를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
