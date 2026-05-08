import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../../lib/auth-options";
import { prisma } from "../../../lib/prisma";
import { formatKstDateTime } from "../../../lib/time";
import Sidebar from "../_components/sidebar";
import YearSelect from "../_components/year-select";

function formatDate(value: Date) {
  return formatKstDateTime(value);
}

function toDateKey(value: Date | null) {
  if (!value) return "";
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
  return map[column] ?? column;
}

function formatChangeValue(column: string, value: string | null) {
  if (column === "amount") return formatMoney(value);
  if (column === "issue_dt") return formatIssueDateValue(value);
  return (value ?? "-").replace(/\\n/g, "\n");
}

type SyncHistoryPageProps = {
  searchParams?: {
    year?: string;
  };
};

export default async function SyncHistoryPage({ searchParams }: SyncHistoryPageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const currentYear = new Date().getFullYear();
  const parsedYear = Number(searchParams?.year);
  const selectedYear = Number.isFinite(parsedYear) ? parsedYear : currentYear;
  const dateRange = {
    gte: new Date(Date.UTC(selectedYear, 0, 1)),
    lt: new Date(Date.UTC(selectedYear + 1, 0, 1)),
  };

  const logs = await prisma.autoChangeLog.findMany({
    where: {
      detected_at: dateRange,
    },
    orderBy: { detected_at: "desc" },
    take: 300,
    select: {
      log_seq: true,
      project_cd: true,
      source_id: true,
      issue_dt: true,
      module_type: true,
      target_desc: true,
      changed_column: true,
      before_value: true,
      after_value: true,
      detected_at: true,
    },
  });

  const [arRows, apRows] = await Promise.all([
    prisma.ar.findMany({
      where: {
        issue_dt: dateRange,
      },
      select: {
        description: true,
        source_id: true,
        biz_group_nm: true,
        client_nm: true,
        amount: true,
        issue_dt: true,
        created_at: true,
      },
    }),
    prisma.ap.findMany({
      where: {
        issue_dt: dateRange,
      },
      select: {
        description: true,
        source_id: true,
        biz_group_nm: true,
        client_nm: true,
        amount: true,
        issue_dt: true,
        created_at: true,
      },
    }),
  ]);

  const makeRefKey = (moduleType: string, sourceId: string | null, issueDt: Date | null, targetDesc: string) =>
    `${moduleType}|${sourceId ?? ""}|${toDateKey(issueDt)}|${targetDesc}`;

  const firstArMap = new Map(
    arRows.map((row) => [
      makeRefKey("AR", row.source_id, row.issue_dt, row.description),
      {
        biz_group_nm: row.biz_group_nm,
        client_nm: row.client_nm,
        initial_amount: Number(row.amount),
        initial_issue_dt: row.issue_dt,
        first_checked_at: row.created_at,
      },
    ]),
  );
  const firstApMap = new Map(
    apRows.map((row) => [
      makeRefKey("AP", row.source_id, row.issue_dt, row.description),
      {
        biz_group_nm: row.biz_group_nm,
        client_nm: row.client_nm,
        initial_amount: Number(row.amount),
        initial_issue_dt: row.issue_dt,
        first_checked_at: row.created_at,
      },
    ]),
  );

  const grouped = logs.reduce<
    Record<
      string,
      {
        module_type: string;
        target_desc: string;
        biz_group_nm: string | null;
        client_nm: string | null;
        initial_amount: number | null;
        initial_issue_dt: Date | null;
        first_checked_at: Date | null;
        histories: typeof logs;
      }
    >
  >((acc, log) => {
    const key = makeRefKey(log.module_type, log.source_id, log.issue_dt, log.target_desc);
    if (!acc[key]) {
      const ref =
        log.module_type === "AR" ? firstArMap.get(key) : firstApMap.get(key);
      acc[key] = {
        module_type: log.module_type,
        target_desc: log.target_desc,
        biz_group_nm: ref?.biz_group_nm ?? null,
        client_nm: ref?.client_nm ?? null,
        initial_amount: ref?.initial_amount ?? null,
        initial_issue_dt: ref?.initial_issue_dt ?? null,
        first_checked_at: ref?.first_checked_at ?? null,
        histories: [],
      };
    }
    acc[key].histories.push(log);
    return acc;
  }, {});

  const entries = Object.values(grouped);

  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar userName={session.user.name ?? "사용자"} />
      <main className="flex-1 p-6 md:p-10">
        <header className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-slate-900">CRMS 변경 이력</h1>
          <YearSelect selectedYear={selectedYear} />
        </header>

        <section className="space-y-3">
          {entries.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
              변경 이력이 없습니다.
            </div>
          ) : (
            entries.map((entry) => (
              <details key={`${entry.module_type}-${entry.target_desc}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        [{entry.module_type}] {entry.biz_group_nm ?? "미분류"} · {entry.client_nm ?? "거래처 미상"}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">{entry.target_desc}</p>
                    </div>
                    <span className="text-xs text-slate-500">히스토리 {entry.histories.length}건</span>
                  </div>
                </summary>
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                    <p>최초 금액: <span className="font-semibold">{entry.initial_amount?.toLocaleString("ko-KR") ?? "-"}원</span></p>
                    <p>최초 발행일: <span className="font-semibold">{entry.initial_issue_dt ? formatDate(entry.initial_issue_dt) : "-"}</span></p>
                    <p>최초 조회일자: <span className="font-semibold">{entry.first_checked_at ? formatDate(entry.first_checked_at) : "-"}</span></p>
                  </div>

                  <ul className="mt-4 space-y-2 border-t border-slate-200 pt-4">
                    {entry.histories.map((history) => (
                      <li key={history.log_seq} className="rounded-md bg-white px-3 py-2 text-sm text-slate-700">
                        <p className="mb-1">
                          [{formatDate(history.detected_at)}] {getColumnLabel(history.changed_column)}이 변경되었습니다.
                        </p>
                        <div className="grid gap-1 sm:grid-cols-2">
                          <div className="rounded border border-rose-100 bg-rose-50/50 px-2 py-1.5">
                            <p className="mb-1 text-[11px] font-semibold text-rose-700">이전 값</p>
                            <pre className="whitespace-pre-wrap break-words text-xs text-rose-700">
                              {formatChangeValue(history.changed_column, history.before_value)}
                            </pre>
                          </div>
                          <div className="rounded border border-blue-100 bg-blue-50/50 px-2 py-1.5">
                            <p className="mb-1 text-[11px] font-semibold text-blue-700">현재 값</p>
                            <pre className="whitespace-pre-wrap break-words text-xs text-blue-700">
                              {formatChangeValue(history.changed_column, history.after_value)}
                            </pre>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
