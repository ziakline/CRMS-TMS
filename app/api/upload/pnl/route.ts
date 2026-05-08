import { getServerSession } from "next-auth";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";
import { authOptions } from "../../../../lib/auth-options";
import { prisma } from "../../../../lib/prisma";

type ParsedRow = {
  base_year: number;
  pnl_type: "AR" | "AP";
  row_code: string;
  parent_row_code: string | null;
  grade: string | null;
  category1: string | null;
  category2: string | null;
  category3: string | null;
  biz_detail: string | null;
  biz_group: string | null;
  row_label: string | null;
  client_name: string | null;
  row_type: string;
  calc_mode: string;
  sort_order: number;
  prev_year_actual: number;
  company_target: number;
  base_ratio: number;
  t: number[];
  a: number[];
  source_note: string | null;
};

const CELL_ERROR_REGEX = /^#(REF!|DIV\/0!|N\/A|VALUE!|NAME\?|NUM!|NULL!)/i;

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function toNullable(value: string): string | null {
  const v = value.trim();
  return v ? v : null;
}

function sanitizeCodePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w가-힣]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
}

function parseNumericCell(value: unknown): { value: number; note: string | null } {
  const raw = asText(value);
  if (!raw) return { value: 0, note: null };
  if (CELL_ERROR_REGEX.test(raw)) return { value: 0, note: raw };

  const normalized = raw.replace(/[,%원\s]/g, "").replace(/,/g, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return { value: 0, note: `NaN:${raw}` };
  return { value: parsed, note: null };
}

function buildRowType(rowLabel: string): string {
  if (rowLabel.includes("합계")) return "TOTAL";
  if (rowLabel.includes("소계") || rowLabel.includes("계")) return "SUBTOTAL";
  return "INPUT";
}

function normalizeHeader(value: unknown): string {
  return asText(value).replace(/\s+/g, "").replace(/[\r\n]+/g, "").toLowerCase();
}

function findColumnIndex(row: unknown[], includesText: string): number {
  const target = includesText.replace(/\s+/g, "").toLowerCase();
  return row.findIndex((cell) => normalizeHeader(cell).includes(target));
}

function findHeaderConfig(rows: unknown[][], startIdx: number) {
  const end = Math.min(rows.length - 1, startIdx + 15);
  for (let i = startIdx; i <= end; i += 1) {
    const row = rows[i] ?? [];
    const itemIdx = findColumnIndex(row, "항목");
    const t01Idx = findColumnIndex(row, "1월목표");
    const a01Idx = findColumnIndex(row, "1월실적");
    if (itemIdx < 0 || t01Idx < 0 || a01Idx < 0) continue;
    return { headerRowIdx: i, itemIdx, t01Idx, a01Idx };
  }
  return null;
}

function parseWorkbook(buffer: Buffer, baseYear: number) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellText: true });
  const parsedRows: ParsedRow[] = [];
  let globalSortOrder = 1;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });

    let currentType: "AR" | "AP" | null = null;
    let headerRowIdx = -1;
    let itemIdx = 8;
    let t01Idx = 19;
    let a01Idx = 31;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] ?? [];
      const rowTextMerged = row.map((cell) => asText(cell)).join(" ");
      const normalizedMerged = normalizeHeader(rowTextMerged);
      if (normalizedMerged.includes("[ar]")) {
        currentType = "AR";
        headerRowIdx = -1;
      }
      if (normalizedMerged.includes("[ap]")) {
        currentType = "AP";
        headerRowIdx = -1;
      }

      if (!currentType) continue;

      if (headerRowIdx < 0) {
        const header = findHeaderConfig(rows as unknown[][], i);
        if (!header) continue;
        headerRowIdx = header.headerRowIdx;
        itemIdx = header.itemIdx;
        t01Idx = header.t01Idx;
        a01Idx = header.a01Idx;
        i = headerRowIdx;
        continue;
      }

      if (i <= headerRowIdx) continue;

      const cells = row.map((cell) => asText(cell));
      const rowLabel = cells[itemIdx] || "";
      const hasAnyData = cells.some((cell) => cell.length > 0);
      const isAnotherSectionHeader = normalizedMerged.includes("[ar]") || normalizedMerged.includes("[ap]");
      if (!hasAnyData || isAnotherSectionHeader) continue;

      const numericSignals = [t01Idx, t01Idx + 1, a01Idx, a01Idx + 1].map((idx) => parseNumericCell(row[idx]).value);
      const hasNumericSignal = numericSignals.some((num) => num !== 0);
      if (!rowLabel && !hasNumericSignal) continue;
      if (!rowLabel && (cells[itemIdx - 1] || "").includes("항목")) continue;

      const notes: string[] = [];
      const getNum = (idx: number) => {
        const parsed = parseNumericCell(row[idx]);
        if (parsed.note) notes.push(`c${idx + 1}:${parsed.note}`);
        return parsed.value;
      };

      const targetMonths = Array.from({ length: 12 }, (_, monthIdx) => getNum(t01Idx + monthIdx));
      const actualMonths = Array.from({ length: 12 }, (_, monthIdx) => getNum(a01Idx + monthIdx));
      const baseRatioColIdx = Math.max(0, t01Idx - 1);
      const baseRatio = parseNumericCell(row[baseRatioColIdx]);
      if (baseRatio.note) notes.push(`c${baseRatioColIdx + 1}:${baseRatio.note}`);

      const resolvedLabel = rowLabel || cells[itemIdx - 1] || cells[itemIdx + 1] || `행_${globalSortOrder}`;
      const rowType = buildRowType(resolvedLabel);
      const rowCode = `${baseYear}_${currentType}_${globalSortOrder}_${sanitizeCodePart(resolvedLabel)}`.slice(0, 100);

      parsedRows.push({
        base_year: baseYear,
        pnl_type: currentType,
        row_code: rowCode,
        parent_row_code: null,
        grade: toNullable(cells[0] || ""),
        category1: toNullable(cells[1] || ""),
        category2: toNullable(cells[2] || ""),
        category3: toNullable(cells[3] || ""),
        biz_detail: toNullable(cells[4] || ""),
        biz_group: toNullable(cells[5] || ""),
        row_label: toNullable(resolvedLabel),
        client_name: toNullable(cells[Math.max(0, itemIdx - 1)] || ""),
        row_type: rowType,
        calc_mode: rowType === "INPUT" ? "AUTO" : "MANUAL_OVERRIDE",
        sort_order: globalSortOrder,
        prev_year_actual: getNum(Math.max(0, t01Idx - 10)),
        company_target: getNum(Math.max(0, t01Idx - 4)),
        base_ratio: baseRatio.value,
        t: targetMonths,
        a: actualMonths,
        source_note: notes.length > 0 ? notes.join(" | ") : null,
      });
      globalSortOrder += 1;
    }
  }

  return parsedRows;
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const sourcePathRaw = formData.get("sourcePath");
    const sourcePath = typeof sourcePathRaw === "string" ? sourcePathRaw.trim() : "";
    const baseYearRaw = Number(formData.get("baseYear"));
    const baseYear = Number.isFinite(baseYearRaw) ? baseYearRaw : new Date().getFullYear();
    let buffer: Buffer;

    if (file instanceof File) {
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else if (sourcePath) {
      if (!/\.(xlsx|xls|xlsm)$/i.test(sourcePath)) {
        return Response.json({ message: "지원하지 않는 파일 확장자입니다." }, { status: 400 });
      }
      buffer = await readFile(sourcePath);
    } else {
      return Response.json({ message: "엑셀 파일 또는 sourcePath가 필요합니다." }, { status: 400 });
    }

    const parsedRows = parseWorkbook(buffer, baseYear);
    if (parsedRows.length === 0) {
      return Response.json({ message: "업로드 가능한 데이터 행을 찾지 못했습니다." }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      for (const row of parsedRows) {
        await tx.pnlMaster.upsert({
          where: { row_code: row.row_code },
          update: {
            base_year: row.base_year,
            pnl_type: row.pnl_type,
            parent_row_code: row.parent_row_code,
            grade: row.grade,
            category1: row.category1,
            category2: row.category2,
            category3: row.category3,
            biz_detail: row.biz_detail,
            biz_group: row.biz_group,
            row_label: row.row_label,
            client_name: row.client_name,
            row_type: row.row_type,
            calc_mode: row.calc_mode,
            sort_order: row.sort_order,
            prev_year_actual: row.prev_year_actual,
            company_target: row.company_target,
            base_ratio: row.base_ratio,
            t_m01: row.t[0],
            t_m02: row.t[1],
            t_m03: row.t[2],
            t_m04: row.t[3],
            t_m05: row.t[4],
            t_m06: row.t[5],
            t_m07: row.t[6],
            t_m08: row.t[7],
            t_m09: row.t[8],
            t_m10: row.t[9],
            t_m11: row.t[10],
            t_m12: row.t[11],
            a_m01: row.a[0],
            a_m02: row.a[1],
            a_m03: row.a[2],
            a_m04: row.a[3],
            a_m05: row.a[4],
            a_m06: row.a[5],
            a_m07: row.a[6],
            a_m08: row.a[7],
            a_m09: row.a[8],
            a_m10: row.a[9],
            a_m11: row.a[10],
            a_m12: row.a[11],
            source_note: row.source_note,
          },
          create: {
            row_code: row.row_code,
            base_year: row.base_year,
            pnl_type: row.pnl_type,
            parent_row_code: row.parent_row_code,
            grade: row.grade,
            category1: row.category1,
            category2: row.category2,
            category3: row.category3,
            biz_detail: row.biz_detail,
            biz_group: row.biz_group,
            row_label: row.row_label,
            client_name: row.client_name,
            row_type: row.row_type,
            calc_mode: row.calc_mode,
            sort_order: row.sort_order,
            prev_year_actual: row.prev_year_actual,
            company_target: row.company_target,
            base_ratio: row.base_ratio,
            t_m01: row.t[0],
            t_m02: row.t[1],
            t_m03: row.t[2],
            t_m04: row.t[3],
            t_m05: row.t[4],
            t_m06: row.t[5],
            t_m07: row.t[6],
            t_m08: row.t[7],
            t_m09: row.t[8],
            t_m10: row.t[9],
            t_m11: row.t[10],
            t_m12: row.t[11],
            a_m01: row.a[0],
            a_m02: row.a[1],
            a_m03: row.a[2],
            a_m04: row.a[3],
            a_m05: row.a[4],
            a_m06: row.a[5],
            a_m07: row.a[6],
            a_m08: row.a[7],
            a_m09: row.a[8],
            a_m10: row.a[9],
            a_m11: row.a[10],
            a_m12: row.a[11],
            source_note: row.source_note,
          },
        });
      }
    });

    return Response.json(
      {
        message: "손익계획 엑셀 업로드가 완료되었습니다.",
        processed: parsedRows.length,
        year: baseYear,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "업로드 처리 중 오류가 발생했습니다.";
    return Response.json({ message }, { status: 500 });
  }
}
