"use client";

import { ChevronDown, Circle, Search } from "lucide-react";
import { useMemo, useState } from "react";

export type ChangeLogItem = {
  log_seq: number;
  changed_column: string;
  before_value: string | null;
  after_value: string | null;
  detected_at: string;
};

export type GridRowItem = {
  row_id: number;
  source_id?: string | null;
  target_desc: string;
  biz_group_nm: string | null;
  issue_dt: string | null;
  client_nm: string | null;
  description: string;
  amount: number;
  inspect_status: string | null;
  inspect_title?: string | null;
  inspect_worker?: string | null;
  inspect_body?: string | null;
  inspect_excel?: string | null;
};

type HistoryTableRowProps = {
  row: GridRowItem;
  logs: ChangeLogItem[];
  rowIndex: number;
};

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  // Hydration mismatch 방지를 위해 KST 기준 고정 문자열 포맷을 사용합니다.
  const kstTime = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kstTime.getUTCFullYear();
  const mm = String(kstTime.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kstTime.getUTCDate()).padStart(2, "0");
  const hh = String(kstTime.getUTCHours()).padStart(2, "0");
  const min = String(kstTime.getUTCMinutes()).padStart(2, "0");

  return `${yyyy}. ${mm}. ${dd}. ${hh}:${min}`;
}

function formatMoney(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (Number.isNaN(parsed)) return String(value);
  return `${parsed.toLocaleString("ko-KR")}원`;
}

function formatIssueDateValue(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}.${mm}.${dd} ${hh}:${min}`;
}

function getColumnLabel(column: string) {
  const map: Record<string, string> = {
    amount: "금액",
    issue_dt: "발행일",
    client_nm: "거래처",
    description: "항목",
    inspect_status: "검수상태",
    claim_status: "청구상태",
    pay_status: "지급상태",
    receive_status: "수금상태",
  };
  return map[column] || column;
}

function formatChangeValue(column: string, value: string | null) {
  if (column === "amount") return formatMoney(value);
  if (column === "issue_dt") return formatIssueDateValue(value);
  return value ?? "-";
}

function getReviewStatusClass(status: string | null) {
  if (status === "완료") return "text-blue-600";
  if (status === "진행") return "text-emerald-600";
  return "text-amber-600";
}

function formatExcelSummary(value: string | null | undefined) {
  if (!value) return "엑셀 파싱 내용이 없습니다.";
  return value
    .replace(/\[시트\]/g, "\n[시트]")
    .replace(/\s\|\s/g, "  |  ")
    .trim();
}

type ParsedExcelSheet = {
  name: string;
  rows: string[][];
};

function parseExcelSummary(value: string | null | undefined): ParsedExcelSheet[] {
  if (!value) return [];
  const lines = value.split("\n").map((line) => line.trim());
  const sheets: ParsedExcelSheet[] = [];
  let current: ParsedExcelSheet | null = null;

  for (const line of lines) {
    if (!line) continue;
    const sheetMatch = line.match(/^\[시트\]\s*(.+)$/);
    if (sheetMatch) {
      current = { name: sheetMatch[1], rows: [] };
      sheets.push(current);
      continue;
    }
    if (!current) {
      current = { name: "시트", rows: [] };
      sheets.push(current);
    }

    const cols = line.split("|").map((col) => col.trim());
    if (cols.length > 0) {
      current.rows.push(cols);
    }
  }
  return sheets;
}

export default function HistoryTableRow({ row, logs, rowIndex }: HistoryTableRowProps) {
  const [open, setOpen] = useState(false);
  const [openInspect, setOpenInspect] = useState(false);
  const latestLog = logs[0] ?? null;

  const changedColumnNormalized = useMemo(
    () => latestLog?.changed_column.toLowerCase().replace(/\s+/g, "") ?? "",
    [latestLog?.changed_column],
  );

  const isChanged = (columnCandidates: string[]) =>
    columnCandidates.some((candidate) => changedColumnNormalized.includes(candidate));

  const highlightClass = "bg-yellow-50 font-bold text-slate-900";
  const normalClass = "text-slate-700";
  const parsedExcelSheets = useMemo(() => parseExcelSummary(row.inspect_excel), [row.inspect_excel]);

  return (
    <>
      <tr
        className={`cursor-pointer border-b border-slate-200 hover:bg-slate-50 ${
          rowIndex % 2 === 0 ? "bg-white" : "bg-slate-50/70"
        }`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-800">{row.biz_group_nm ?? "-"}</td>
        <td
          className={`whitespace-nowrap px-4 py-3 text-xs ${isChanged(["issue_dt", "issue", "일자", "date"]) ? highlightClass : normalClass}`}
        >
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            {formatDateTime(row.issue_dt)}
          </span>
        </td>
        <td
          className={`whitespace-nowrap px-4 py-3 text-xs ${isChanged(["client_nm", "client"]) ? highlightClass : normalClass}`}
        >
          <span className="inline-flex max-w-[180px] items-center gap-1 truncate" title={row.client_nm ?? "-"}>
            {row.client_nm ?? "-"}
          </span>
        </td>
        <td
          className={`whitespace-nowrap px-4 py-3 text-xs ${isChanged(["description", "target_desc"]) ? highlightClass : normalClass}`}
        >
          <span className="inline-flex max-w-[220px] items-center gap-1 truncate" title={row.description}>
            {row.description}
          </span>
        </td>
        <td className={`whitespace-nowrap px-4 py-3 text-right text-xs ${isChanged(["amount", "금액"]) ? highlightClass : normalClass}`}>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            {row.amount.toLocaleString("ko-KR")}원
          </span>
        </td>
        <td
          className={`whitespace-nowrap px-4 py-3 text-xs ${isChanged(["inspect_status", "status", "상태"]) ? highlightClass : normalClass}`}
        >
          <div className="inline-flex max-w-[220px] items-center gap-2">
            <span
              className={`inline-flex max-w-[180px] items-center gap-1 truncate font-semibold ${getReviewStatusClass(
                row.inspect_status,
              )}`}
              title={row.inspect_status ?? "-"}
            >
              {row.inspect_status ?? "-"}
            </span>
            {row.inspect_title || row.inspect_worker || row.inspect_body ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenInspect(true);
                }}
                className="inline-flex h-5 w-5 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                title="검수서 상세보기"
              >
                <Search size={12} />
              </button>
            ) : null}
          </div>
        </td>
        <td className="px-4 py-3 text-right text-slate-400">
          <ChevronDown size={16} className={`inline transition ${open ? "rotate-180" : ""}`} />
        </td>
      </tr>

      <tr className={`${open ? "table-row" : "hidden"} bg-slate-50`}>
        <td colSpan={7} className="px-6 py-5">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h4 className="mb-3 text-sm font-semibold text-slate-800">변경 타임라인</h4>
            {logs.length === 0 ? (
              <p className="text-sm text-slate-500">변경 이력이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {logs.map((log) => (
                  <li key={log.log_seq} className="relative pl-6">
                    <span className="absolute left-1 top-1 h-full w-px bg-slate-200" />
                    <Circle size={10} className="absolute left-0 top-1 text-indigo-500" fill="currentColor" />
                    <p className="text-sm text-slate-700">
                      [{formatDateTime(log.detected_at)}] {getColumnLabel(log.changed_column)}이 변경되었습니다:{" "}
                      <span className="font-medium text-rose-600">
                        {formatChangeValue(log.changed_column, log.before_value)}
                      </span>{" "}
                      -&gt;{" "}
                      <span className="font-medium text-blue-600">
                        {formatChangeValue(log.changed_column, log.after_value)}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </td>
      </tr>

      {openInspect ? (
        <tr className="hidden" />
      ) : null}

      {openInspect ? (
        <tr className="pointer-events-none">
          <td colSpan={7} className="p-0">
            <div
              className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4"
              onClick={() => setOpenInspect(false)}
            >
              <div
                className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between">
                  <h5 className="text-base font-bold text-slate-900">검수서 상세</h5>
                  <button
                    type="button"
                    className="text-xs font-semibold text-slate-500 hover:text-slate-700"
                    onClick={() => setOpenInspect(false)}
                  >
                    닫기
                  </button>
                </div>
                <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                  <p>
                    타이틀: <span className="font-semibold text-slate-900">{row.inspect_title ?? "-"}</span>
                  </p>
                  <p>
                    작업자: <span className="font-semibold text-slate-900">{row.inspect_worker ?? "-"}</span>
                  </p>
                </div>
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-700">
                  {row.inspect_body ?? "세부내용이 없습니다."}
                </div>
                {row.inspect_excel ? (
                  <div className="mt-4 rounded-md border border-indigo-200 bg-indigo-50/40 p-3">
                    <p className="mb-2 text-sm font-semibold text-indigo-900">엑셀 파싱 요약</p>
                    {parsedExcelSheets.length > 0 ? (
                      <div className="max-h-80 space-y-3 overflow-auto">
                        {parsedExcelSheets.map((sheet, sheetIndex) => {
                          const maxCols = sheet.rows.reduce((max, r) => Math.max(max, r.length), 0);
                          if (sheet.rows.length === 0 || maxCols === 0) return null;
                          return (
                            <div key={`${sheet.name}-${sheetIndex}`} className="rounded border border-indigo-100 bg-white">
                              <div className="border-b border-indigo-100 px-3 py-2 text-xs font-semibold text-indigo-800">
                                {sheet.name}
                              </div>
                              <div className="overflow-x-auto">
                                <table className="min-w-max text-xs text-slate-800">
                                  <tbody>
                                    {sheet.rows.map((rowCols, rowIdx) => (
                                      <tr key={`${sheet.name}-${rowIdx}`} className={rowIdx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                                        {Array.from({ length: maxCols }).map((_, colIdx) => (
                                          <td
                                            key={`${sheet.name}-${rowIdx}-${colIdx}`}
                                            className={`whitespace-nowrap border-r border-slate-200 px-2 py-1.5 align-top ${
                                              rowIdx === 0 ? "font-semibold text-slate-900" : "text-slate-700"
                                            }`}
                                          >
                                            {rowCols[colIdx] ?? ""}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-6 text-slate-800">
                        {formatExcelSummary(row.inspect_excel)}
                      </pre>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
