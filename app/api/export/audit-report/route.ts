import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth-options";
import { buildAuditReport } from "../../../../lib/audit-report";
import { auditReportFilename, writeAuditReportBuffer } from "../../../../lib/audit-report-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return Response.json({ message: "인증이 필요합니다." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dateFrom = String(searchParams.get("date_from") ?? "").trim();
    const dateTo = String(searchParams.get("date_to") ?? "").trim();

    if (!dateFrom || !dateTo) {
      return Response.json({ message: "date_from, date_to(YYYY-MM-DD)가 필요합니다." }, { status: 400 });
    }

    const report = await buildAuditReport(dateFrom, dateTo);
    if (!report) {
      return Response.json(
        { message: "날짜 형식이 올바르지 않거나, 시작일이 종료일보다 늦습니다." },
        { status: 400 },
      );
    }

    const buffer = writeAuditReportBuffer(report);
    const filename = auditReportFilename(dateFrom, dateTo);
    const encodedFilename = encodeURIComponent(filename);

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "서버 오류";
    return Response.json({ message: `엑셀 다운로드 중 오류: ${msg}` }, { status: 500 });
  }
}
