"use client";

import { Download } from "lucide-react";
import { Fragment, useCallback, useState, type ReactNode } from "react";
import type {
  AuditReportGroupSummary,
  AuditReportOpCell,
  AuditReportOpMonthRow,
  AuditReportResult,
  AuditReportRow,
} from "../../../lib/audit-report";

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

function diffClass(n: number) {
  if (n > 0) return "text-red-600";
  if (n < 0) return "text-blue-600";
  return "text-slate-600";
}

function fmtMD(ymd: string | null) {
  if (!ymd) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  return `${mm}/${dd}`;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const t = await res.text();
  if (!t) return {};
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function defaultDateRange() {
  const now = new Date();
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  const from = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  return { from, to };
}

/** 8자리(20260518) 또는 숫자만 입력 시 YYYY-MM-DD 로 정규화 */
function normalizeYmdInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  if (/^\d+$/.test(digits)) {
    if (digits.length <= 4) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }

  return trimmed;
}

function DateYmdInput({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  id?: string;
}) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="YYYY-MM-DD"
      maxLength={10}
      value={value}
      onChange={(e) => onChange(normalizeYmdInput(e.target.value))}
      onPaste={(e) => {
        e.preventDefault();
        onChange(normalizeYmdInput(e.clipboardData.getData("text")));
      }}
      className="w-[9.5rem] rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 tabular-nums"
    />
  );
}

const th = "border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-left text-[10px] font-semibold text-slate-700";
const td = "border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-800";
const tdR = `${td} text-right tabular-nums`;

function TimelineText({
  dateFrom,
  dateTo,
  baseAmount,
  finalAmount,
  diff,
  timeline,
}: {
  dateFrom: string;
  dateTo: string;
  baseAmount: number;
  finalAmount: number;
  diff: number;
  timeline: Array<{ at: string; value: number; author: string }>;
}) {
  return (
    <div className="pl-6 pr-2 text-[11px] leading-relaxed text-slate-700">
      <span className="font-semibold text-slate-800">└ 타임라인:</span>
      <span>{" "}[ {fmtMD(dateFrom)} 기준: {fmtWon(baseAmount)} ]</span>
      {timeline.length > 0 ? (
        <>
          <span>{" "}→{" "}</span>
          {timeline.map((e, idx) => (
            <span key={`${e.at}-${idx}`}>
              [ {fmtMD(e.at)} 변경: {fmtWon(e.value)} {e.author ? `(${e.author})` : ""} ]
              {idx < timeline.length - 1 ? " → " : ""}
            </span>
          ))}
          <span>{" "}→{" "}</span>
        </>
      ) : (
        <span>{" "}→{" "}</span>
      )}
      <span>[ {fmtMD(dateTo)} 최종: {fmtWon(finalAmount)} ]</span>
      <span className={diffClass(diff)}>{" "}({fmtDiff(diff)})</span>
    </div>
  );
}

function ReportSection({
  title,
  tone,
  section,
  dateFrom,
  dateTo,
  children,
}: {
  title: string;
  tone: "blue" | "rose" | "slate";
  section: { changed_rows: number; total_rows: number; total_final: number; total_diff: number };
  dateFrom: string;
  dateTo: string;
  children: ReactNode;
}) {
  const headTone = tone === "blue" ? "text-blue-900" : tone === "rose" ? "text-rose-900" : "text-slate-900";
  return (
    <details open className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
      <summary className={`cursor-pointer list-none border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold ${headTone}`}>
        <span>
          {title} · 변동 {section.changed_rows}건 / 전체 {section.total_rows}건 · 합계 {fmtWon(section.total_final)}{" "}
          <span className={diffClass(section.total_diff)}>({fmtDiff(section.total_diff)})</span>
        </span>
      </summary>
      <div className="overflow-x-auto p-2">{children}</div>
    </details>
  );
}

function GroupSummaryRow({ group }: { group: AuditReportGroupSummary }) {
  return (
    <tr
      className={`border-y border-slate-200 ${
        group.changed ? "bg-amber-50 ring-1 ring-inset ring-amber-200" : "bg-slate-50"
      }`}
    >
      <td className={`${td} py-1.5`} colSpan={5}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs font-semibold text-slate-800">
          <span>
            {group.biz_group_nm} ({group.row_count}건) · {fmtWon(group.total_final)}
            {group.total_diff !== 0 ? (
              <span className={`ml-1 font-bold ${diffClass(group.total_diff)}`}>({fmtDiff(group.total_diff)})</span>
            ) : null}
          </span>
          <span className="text-[11px] font-normal text-slate-600">
            완료 {group.done_cnt}건/{fmtWon(group.done_amount)} | 진행 {group.progress_cnt}건/
            {fmtWon(group.progress_amount)} | 대기 {group.pending_cnt}건/{fmtWon(group.pending_amount)}
          </span>
        </div>
      </td>
    </tr>
  );
}

function ArApGrid({
  rows,
  groups,
  dateFrom,
  dateTo,
}: {
  rows: AuditReportRow[];
  groups: AuditReportGroupSummary[];
  dateFrom: string;
  dateTo: string;
}) {
  let groupIdx = 0;
  let lastGroup = "";

  return (
    <table className="w-full min-w-[720px] border-collapse">
      <thead>
        <tr>
          <th className={th}>사업그룹</th>
          <th className={th}>발행일</th>
          <th className={th}>거래처</th>
          <th className={th}>항목</th>
          <th className={`${th} text-right`}>최종 금액(종료일)</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className={`${td} text-center text-slate-500`} colSpan={5}>
              해당 연도에 등록된 전표가 없습니다.
            </td>
          </tr>
        ) : null}
        {rows.map((r) => {
          const label = r.biz_group_nm?.trim() || "미분류";
          const showGroup = label !== lastGroup;
          if (showGroup) {
            lastGroup = label;
          }
          const groupSummary = showGroup ? groups[groupIdx++] : null;
          const highlight = r.changed;
          return (
            <Fragment key={r.row_key}>
              {groupSummary ? <GroupSummaryRow group={groupSummary} /> : null}
              <tr className={`hover:bg-slate-50/60 ${highlight ? "bg-yellow-50 font-semibold" : "bg-white"}`}>
                <td className={td}>{r.biz_group_nm ?? "—"}</td>
                <td className={`${td} whitespace-nowrap`}>{r.issue_dt ?? "—"}</td>
                <td className={td}>{r.client_nm ?? "—"}</td>
                <td className={td}>{r.target_desc}</td>
                <td className={tdR}>{fmtWon(r.final_amount)}</td>
              </tr>
              {highlight ? (
                <tr className="bg-yellow-50/30">
                  <td className={td} colSpan={5}>
                    <TimelineText
                      dateFrom={dateFrom}
                      dateTo={dateTo}
                      baseAmount={r.base_amount}
                      finalAmount={r.final_amount}
                      diff={r.diff}
                      timeline={r.timeline}
                    />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function OpAmountCell({ cell }: { cell: AuditReportOpCell }) {
  return <p className="font-semibold tabular-nums text-slate-900">{fmtWon(cell.final_amount)}</p>;
}

function OpGrid({ rows, dateFrom, dateTo }: { rows: AuditReportOpMonthRow[]; dateFrom: string; dateTo: string }) {
  const totals = rows.reduce(
    (acc, row) => {
      for (const col of OP_COLUMNS) {
        acc[col.key] += row[col.key].final_amount;
      }
      return acc;
    },
    { labor_cost: 0, insurance_cost: 0, severance_cost: 0, dept_op_cost: 0, total_cost: 0 },
  );

  return (
    <table className="w-full min-w-[640px] border-collapse">
      <thead>
        <tr>
          <th className={th}>년월</th>
          {OP_COLUMNS.map((col) => (
            <th key={col.key} className={`${th} text-right`}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className={`${td} text-center text-slate-500`} colSpan={6}>
              해당 연도 운영비 데이터가 없습니다.
            </td>
          </tr>
        ) : null}
        {rows.map((row) => {
          const highlight = row.changed;
          const changedCols = OP_COLUMNS.filter((col) => row[col.key].changed);
          return (
            <Fragment key={row.row_key}>
              <tr className={`hover:bg-slate-50/60 ${highlight ? "bg-yellow-50/40" : "bg-white"}`}>
                <td className={`${td} font-medium whitespace-nowrap`}>{row.target_month}</td>
                {OP_COLUMNS.map((col) => {
                  const cell = row[col.key];
                  return (
                    <td key={col.key} className={`${tdR} ${cell.changed ? "bg-yellow-50" : ""}`}>
                      <OpAmountCell cell={cell} />
                    </td>
                  );
                })}
              </tr>
              {highlight ? (
                <tr className="bg-yellow-50/30">
                  <td className={td} colSpan={6}>
                    <div className="space-y-2 py-1">
                      {changedCols.map((col) => {
                        const cell = row[col.key];
                        return (
                          <div key={col.key}>
                            <p className="mb-0.5 text-[10px] font-bold text-slate-700">{col.label}</p>
                            <TimelineText
                              dateFrom={dateFrom}
                              dateTo={dateTo}
                              baseAmount={cell.base_amount}
                              finalAmount={cell.final_amount}
                              diff={cell.diff}
                              timeline={cell.timeline}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
      {rows.length > 0 ? (
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-100">
            <td className={`${td} font-bold`}>합계</td>
            {OP_COLUMNS.map((col) => (
              <td key={col.key} className={`${tdR} font-bold`}>
                {fmtWon(totals[col.key])}
              </td>
            ))}
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

export default function AuditReportClient() {
  const initial = defaultDateRange();
  const [dateFrom, setDateFrom] = useState(initial.from);
  const [dateTo, setDateTo] = useState(initial.to);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [report, setReport] = useState<AuditReportResult | null>(null);

  const onGenerate = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const qs = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      const res = await fetch(`/api/dashboard/audit-report?${qs}`, { cache: "no-store" });
      const json = await readJson(res);
      if (!res.ok) {
        setMessage(typeof json.message === "string" ? json.message : "보고서 생성 실패");
        setReport(null);
        return;
      }
      setReport(json as unknown as AuditReportResult);
    } catch {
      setMessage("보고서 조회 중 오류가 발생했습니다.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50/80 p-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          조회 시작일
          <DateYmdInput value={dateFrom} onChange={setDateFrom} />
        </label>
        <span className="pb-2 text-sm text-slate-500">~</span>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          조회 종료일
          <DateYmdInput value={dateTo} onChange={setDateTo} />
        </label>
        <button
          type="button"
          disabled={loading}
          onClick={() => void onGenerate()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "생성 중…" : "보고서 생성"}
        </button>
        <p className="w-full text-[11px] leading-relaxed text-slate-500">
          날짜는 YYYY-MM-DD 형식이며, 8자리 숫자(예: 20260518)를 입력하면 2026-05-18로 자동 변환됩니다. 목록은 조회기간이 속한 연도의
          매출·매입·운영비 전체(관리 화면과 동일 범위)이고, 시작·종료일은 금액 스냅샷·타임라인 비교에만 사용됩니다.
        </p>
      </div>

      {message ? <p className="text-sm text-red-600">{message}</p> : null}

      {report ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-800">
              조회기간 {report.date_from} ~ {report.date_to}
            </p>
            <a
              href={`/api/export/audit-report?date_from=${encodeURIComponent(report.date_from)}&date_to=${encodeURIComponent(report.date_to)}`}
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700"
            >
              <Download size={16} />
              엑셀 다운로드
            </a>
          </div>

          <ReportSection title="매출 (AR)" tone="blue" section={report.ar} dateFrom={report.date_from} dateTo={report.date_to}>
            <ArApGrid
              rows={report.ar.rows}
              groups={report.ar.groups}
              dateFrom={report.date_from}
              dateTo={report.date_to}
            />
          </ReportSection>

          <ReportSection title="매입 (AP)" tone="rose" section={report.ap} dateFrom={report.date_from} dateTo={report.date_to}>
            <ArApGrid
              rows={report.ap.rows}
              groups={report.ap.groups}
              dateFrom={report.date_from}
              dateTo={report.date_to}
            />
          </ReportSection>

          <ReportSection title="부서운영비" tone="slate" section={report.op} dateFrom={report.date_from} dateTo={report.date_to}>
            <OpGrid rows={report.op.rows} dateFrom={report.date_from} dateTo={report.date_to} />
          </ReportSection>
        </div>
      ) : null}
    </div>
  );
}

