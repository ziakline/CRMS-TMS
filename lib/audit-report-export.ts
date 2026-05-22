import * as XLSX from "xlsx-js-style";
import type {
  AuditReportGroupSummary,
  AuditReportOpCell,
  AuditReportOpMonthRow,
  AuditReportResult,
  AuditReportRow,
  AuditReportSection,
  AuditTimelineEvent,
} from "./audit-report";

const OP_COLUMNS = [
  { key: "labor_cost" as const, label: "인건비" },
  { key: "insurance_cost" as const, label: "4대보험" },
  { key: "severance_cost" as const, label: "퇴직급여" },
  { key: "dept_op_cost" as const, label: "부서운영비" },
  { key: "total_cost" as const, label: "합계" },
];

function fmtWon(n: number) {
  return `${n.toLocaleString("ko-KR")}원`;
}

function fmtDiff(n: number) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString("ko-KR")}원`;
}

function fmtMD(ymd: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  return `${Number(m[2])}/${Number(m[3])}`;
}

export function formatAuditTimeline(
  dateFrom: string,
  dateTo: string,
  baseAmount: number,
  finalAmount: number,
  diff: number,
  timeline: AuditTimelineEvent[],
): string {
  let s = `└ 타임라인: [ ${fmtMD(dateFrom)} 기준: ${fmtWon(baseAmount)} ]`;
  if (timeline.length > 0) {
    s += " → ";
    s += timeline
      .map((e) => `[ ${fmtMD(e.at)} 변경: ${fmtWon(e.value)}${e.author ? ` (${e.author})` : ""} ]`)
      .join(" → ");
    s += " → ";
  } else {
    s += " → ";
  }
  s += `[ ${fmtMD(dateTo)} 최종: ${fmtWon(finalAmount)} ] (${fmtDiff(diff)})`;
  return s;
}

function formatGroupSummary(group: AuditReportGroupSummary): string {
  let left = `${group.biz_group_nm} (${group.row_count}건) · ${fmtWon(group.total_final)}`;
  if (group.total_diff !== 0) left += ` (${fmtDiff(group.total_diff)})`;
  const right = `완료 ${group.done_cnt}건/${fmtWon(group.done_amount)} | 진행 ${group.progress_cnt}건/${fmtWon(group.progress_amount)} | 대기 ${group.pending_cnt}건/${fmtWon(group.pending_amount)}`;
  return `${left} | ${right}`;
}

type ArApExportRow = {
  구분: string;
  사업그룹: string;
  발행일: string;
  거래처: string;
  항목: string;
  "최종금액(종료일)": number | string;
  검수상태: string;
  변동: string;
  타임라인: string;
};

export function buildArApExportRows(
  section: AuditReportSection,
  dateFrom: string,
  dateTo: string,
): ArApExportRow[] {
  const out: ArApExportRow[] = [];
  let groupIdx = 0;
  let lastGroup = "";

  for (const row of section.rows) {
    const label = row.biz_group_nm?.trim() || "미분류";
    if (label !== lastGroup) {
      lastGroup = label;
      const group = section.groups[groupIdx++];
      if (group) {
        out.push({
          구분: "집계",
          사업그룹: group.biz_group_nm,
          발행일: "",
          거래처: "",
          항목: formatGroupSummary(group),
          "최종금액(종료일)": group.total_final,
          검수상태: "",
          변동: group.changed ? "Y" : "",
          타임라인: "",
        });
      }
    }
    out.push({
      구분: "내역",
      사업그룹: row.biz_group_nm ?? "",
      발행일: row.issue_dt ?? "",
      거래처: row.client_nm ?? "",
      항목: row.target_desc,
      "최종금액(종료일)": row.final_amount,
      검수상태: row.inspect_status,
      변동: row.changed ? "Y" : "",
      타임라인: "",
    });
    if (row.changed) {
      out.push({
        구분: "타임라인",
        사업그룹: row.biz_group_nm ?? "",
        발행일: row.issue_dt ?? "",
        거래처: row.client_nm ?? "",
        항목: row.target_desc,
        "최종금액(종료일)": "",
        검수상태: "",
        변동: "",
        타임라인: formatAuditTimeline(dateFrom, dateTo, row.base_amount, row.final_amount, row.diff, row.timeline),
      });
    }
  }
  return out;
}

type OpExportRow = {
  구분: string;
  년월: string;
  항목: string;
  인건비: number | string;
  "4대보험": number | string;
  퇴직급여: number | string;
  부서운영비: number | string;
  합계: number | string;
  변동: string;
  타임라인: string;
};

function opAmount(cell: AuditReportOpCell): number | string {
  return cell.final_amount;
}

export function buildOpExportRows(rows: AuditReportOpMonthRow[], dateFrom: string, dateTo: string): OpExportRow[] {
  const out: OpExportRow[] = [];
  const totals = { labor_cost: 0, insurance_cost: 0, severance_cost: 0, dept_op_cost: 0, total_cost: 0 };

  for (const row of rows) {
    for (const col of OP_COLUMNS) {
      totals[col.key] += row[col.key].final_amount;
    }
    out.push({
      구분: "내역",
      년월: row.target_month,
      항목: "",
      인건비: opAmount(row.labor_cost),
      "4대보험": opAmount(row.insurance_cost),
      퇴직급여: opAmount(row.severance_cost),
      부서운영비: opAmount(row.dept_op_cost),
      합계: opAmount(row.total_cost),
      변동: row.changed ? "Y" : "",
      타임라인: "",
    });
    if (row.changed) {
      for (const col of OP_COLUMNS) {
        const cell = row[col.key];
        if (!cell.changed) continue;
        out.push({
          구분: "타임라인",
          년월: row.target_month,
          항목: col.label,
          인건비: "",
          "4대보험": "",
          퇴직급여: "",
          부서운영비: "",
          합계: "",
          변동: "",
          타임라인: formatAuditTimeline(dateFrom, dateTo, cell.base_amount, cell.final_amount, cell.diff, cell.timeline),
        });
      }
    }
  }

  if (rows.length > 0) {
    out.push({
      구분: "합계",
      년월: "합계",
      항목: "",
      인건비: totals.labor_cost,
      "4대보험": totals.insurance_cost,
      퇴직급여: totals.severance_cost,
      부서운영비: totals.dept_op_cost,
      합계: totals.total_cost,
      변동: "",
      타임라인: "",
    });
  }
  return out;
}

/** A열만 Excel 기본 너비 — 긴 텍스트는 옆 열로 넘쳐 보이게(줄바꿈 없음) */
const COL_A_DEFAULT_WCH = 8.43;

type XlsxCellStyle = {
  font?: { bold?: boolean; color?: { rgb: string }; sz?: number };
  fill?: { patternType: "solid"; fgColor: { rgb: string } };
  alignment?: { vertical?: string; wrapText?: boolean };
  numFmt?: string;
};

const STYLE_SECTION: XlsxCellStyle = {
  font: { bold: true, sz: 12, color: { rgb: "1E3A5F" } },
  fill: { patternType: "solid", fgColor: { rgb: "E8EEF4" } },
};

const STYLE_HEADER: XlsxCellStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" } },
  fill: { patternType: "solid", fgColor: { rgb: "4A4A4A" } },
  alignment: { vertical: "center" },
};

const STYLE_AGGREGATE: XlsxCellStyle = {
  fill: { patternType: "solid", fgColor: { rgb: "DDEBF7" } },
  alignment: { vertical: "center" },
};

const STYLE_ZEBRA: XlsxCellStyle = {
  fill: { patternType: "solid", fgColor: { rgb: "F2F2F2" } },
  alignment: { vertical: "center" },
};

const STYLE_DATA: XlsxCellStyle = {
  alignment: { vertical: "center" },
};

type SheetRowMeta =
  | { type: "meta" }
  | { type: "blank" }
  | { type: "section" }
  | { type: "header"; amountColIndexes: number[] }
  | { type: "data"; gubun: string; amountColIndexes: number[] };

const AR_AP_HEADERS = ["구분", "사업그룹", "발행일", "거래처", "항목", "최종금액(종료일)", "검수상태", "변동", "타임라인"] as const;
const AR_AP_AMOUNT_HEADERS = ["최종금액(종료일)"];
const OP_HEADERS = ["구분", "년월", "항목", "인건비", "4대보험", "퇴직급여", "부서운영비", "합계", "변동", "타임라인"] as const;
const OP_AMOUNT_HEADERS = ["인건비", "4대보험", "퇴직급여", "부서운영비", "합계"];

function sectionTitle(
  label: string,
  section: { changed_rows: number; total_rows: number; total_final: number; total_diff: number },
) {
  const diff =
    section.total_diff !== 0
      ? ` (${section.total_diff > 0 ? "+" : ""}${section.total_diff.toLocaleString("ko-KR")}원)`
      : "";
  return `${label} · 변동 ${section.changed_rows}건 / 전체 ${section.total_rows}건 · 합계 ${section.total_final.toLocaleString("ko-KR")}원${diff}`;
}

function rowToLine<T extends Record<string, string | number>>(headers: readonly string[], row: T) {
  return headers.map((h) => row[h as keyof T] ?? "");
}

function appendTableSection(
  aoa: (string | number)[][],
  rowMeta: SheetRowMeta[],
  title: string,
  headers: readonly string[],
  amountHeaders: string[],
  rows: Record<string, string | number>[],
) {
  aoa.push([title]);
  rowMeta.push({ type: "section" });
  aoa.push([]);
  rowMeta.push({ type: "blank" });
  const amountColIndexes = amountHeaders
    .map((h) => headers.indexOf(h))
    .filter((i) => i >= 0);
  aoa.push([...headers]);
  rowMeta.push({ type: "header", amountColIndexes });
  for (const row of rows) {
    aoa.push(rowToLine(headers, row));
    rowMeta.push({ type: "data", gubun: String(row.구분 ?? ""), amountColIndexes });
  }
  aoa.push([]);
  rowMeta.push({ type: "blank" });
}

function applyColumnWidths(worksheet: XLSX.WorkSheet, colCount: number) {
  const range = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1");
  const widths: { wch: number }[] = [];

  for (let c = 0; c < colCount; c += 1) {
    if (c === 0) {
      widths.push({ wch: COL_A_DEFAULT_WCH });
      continue;
    }
    let maxLen = 8;
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
      const len = String(cell?.v ?? "").length;
      if (len > maxLen) maxLen = len;
    }
    widths.push({ wch: Math.min(Math.max(maxLen + 2, 10), 48) });
  }
  worksheet["!cols"] = widths;
}

function styleWorksheet(worksheet: XLSX.WorkSheet, rowMeta: SheetRowMeta[]) {
  const range = XLSX.utils.decode_range(worksheet["!ref"] ?? "A1");
  let zebraIdx = 0;

  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const meta = rowMeta[r];
    if (!meta) continue;

    let rowStyle: XlsxCellStyle | null = null;
    let amountColIndexes: number[] = [];

    if (meta.type === "section") {
      rowStyle = STYLE_SECTION;
    } else if (meta.type === "header") {
      zebraIdx = 0;
      rowStyle = STYLE_HEADER;
      amountColIndexes = meta.amountColIndexes;
    } else if (meta.type === "data") {
      amountColIndexes = meta.amountColIndexes;
      if (meta.gubun === "집계") {
        rowStyle = STYLE_AGGREGATE;
      } else {
        rowStyle = zebraIdx % 2 === 1 ? STYLE_ZEBRA : STYLE_DATA;
        zebraIdx += 1;
      }
    }

    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r, c });
      let cell = worksheet[cellAddress];
      if (!cell) {
        cell = { t: "s", v: "" };
        worksheet[cellAddress] = cell;
      }

      const isAmountCol = meta.type === "data" && amountColIndexes.includes(c) && typeof cell.v === "number";
      if (isAmountCol) {
        cell.t = "n";
        cell.z = "#,##0";
      }

      if (rowStyle) {
        cell.s = isAmountCol ? { ...rowStyle, numFmt: "#,##0" } : rowStyle;
      }
    }
  }
}

function buildUnifiedWorksheet(report: AuditReportResult) {
  const meta = `조회기간: ${report.date_from} ~ ${report.date_to}`;
  const arRows = buildArApExportRows(report.ar, report.date_from, report.date_to);
  const apRows = buildArApExportRows(report.ap, report.date_from, report.date_to);
  const opRows = buildOpExportRows(report.op.rows, report.date_from, report.date_to);

  const aoa: (string | number)[][] = [[meta]];
  const rowMeta: SheetRowMeta[] = [{ type: "meta" }];
  aoa.push([]);
  rowMeta.push({ type: "blank" });

  appendTableSection(aoa, rowMeta, sectionTitle("매출 (AR)", report.ar), AR_AP_HEADERS, AR_AP_AMOUNT_HEADERS, arRows);
  appendTableSection(aoa, rowMeta, sectionTitle("매입 (AP)", report.ap), AR_AP_HEADERS, AR_AP_AMOUNT_HEADERS, apRows);
  appendTableSection(
    aoa,
    rowMeta,
    sectionTitle("부서운영비", report.op),
    OP_HEADERS,
    OP_AMOUNT_HEADERS,
    opRows,
  );

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  const colCount = Math.max(AR_AP_HEADERS.length, OP_HEADERS.length);
  applyColumnWidths(worksheet, colCount);
  styleWorksheet(worksheet, rowMeta);
  return worksheet;
}

export function buildAuditReportWorkbook(report: AuditReportResult): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, buildUnifiedWorksheet(report), "보고서");
  return workbook;
}

export function auditReportFilename(dateFrom: string, dateTo: string) {
  const compact = (s: string) => s.replace(/-/g, "");
  return `보고서_${compact(dateFrom)}_${compact(dateTo)}.xlsx`;
}

export function writeAuditReportBuffer(report: AuditReportResult): Buffer {
  const workbook = buildAuditReportWorkbook(report);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellStyles: true }) as Buffer;
}
