import { getServerSession } from "next-auth";
import * as XLSX from "xlsx";
import { authOptions } from "../../../../lib/auth-options";
import { prisma } from "../../../../lib/prisma";

function formatYmdKst(value: Date | null) {
  if (!value) return "";
  const kst = new Date(value.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatYmdHmKst(value: Date | null) {
  if (!value) return "";
  const kst = new Date(value.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const min = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function yyyymmdd() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function normalizeReviewStatus(status: string | null | undefined) {
  if (!status || status.includes("대기")) return "대기";
  if (status.includes("완료")) return "완료";
  if (status.includes("진행")) return "진행";
  return "대기";
}

function buildWorksheet<T extends Record<string, string | number>>(rows: T[]) {
  const headers = Object.keys(rows[0] ?? {});
  const worksheet = XLSX.utils.json_to_sheet(rows);

  if (headers.length > 0) {
    worksheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}1` };
    worksheet["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  }

  const range = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1");
  const amountColIndex = headers.indexOf("금액");
  const colWidths = headers.map((header, idx) => {
    let maxLen = header.length;
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIdx + 1, c: idx });
      const raw = rows[rowIdx]?.[header] ?? "";
      const len = String(raw).length;
      if (len > maxLen) maxLen = len;
      const cell = worksheet[cellAddress];
      if (cell && idx === amountColIndex) {
        cell.t = "n";
        cell.z = "#,##0";
      }
    }
    return { wch: Math.min(Math.max(maxLen + 2, 12), 48) };
  });
  worksheet["!cols"] = colWidths;

  // xlsx 기본 패키지에서는 스타일 지원이 제한적이지만, 지원되는 환경에서는 헤더 강조가 적용됩니다.
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c });
    const cell = worksheet[cellAddress];
    if (!cell) continue;
    cell.s = {
      font: { bold: true },
      fill: { fgColor: { rgb: "F2F2F2" } },
    };
  }

  return worksheet;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  const rows = await prisma.ar.findMany({
    where: { is_deleted: "N" },
    orderBy: { ar_seq: "asc" },
    select: {
      biz_group_nm: true,
      issue_dt: true,
      client_nm: true,
      item_type: true,
      description: true,
      amount: true,
      inspect_status: true,
      claim_status: true,
      receive_status: true,
      source_id: true,
      created_at: true,
      updated_at: true,
    },
  });

  const exportRows = rows.map((row) => ({
    사업그룹: row.biz_group_nm ?? "",
    발행일: formatYmdKst(row.issue_dt),
    거래처명: row.client_nm ?? "",
    항목: row.item_type ?? "",
    세부매출내용: row.description ?? "",
    금액: Number(row.amount),
    검수상태: normalizeReviewStatus(row.claim_status),
    청구상태: row.claim_status ?? "",
    수금상태: row.receive_status ?? "",
    원천ID: row.source_id ?? "",
    생성일시: formatYmdHmKst(row.created_at),
    수정일시: formatYmdHmKst(row.updated_at),
  }));

  const sheet = buildWorksheet(exportRows);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "AR 전체");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellStyles: true });

  const filename = `매출관리_전체_${yyyymmdd()}.xlsx`;
  const encodedFilename = encodeURIComponent(filename);

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedFilename}`,
      "Cache-Control": "no-store",
    },
  });
}
