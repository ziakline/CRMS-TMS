import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import HistoryTableRow, { type ChangeLogItem, type GridRowItem } from "../../../components/history-table-row";
import { authOptions } from "../../../lib/auth-options";
import { prisma } from "../../../lib/prisma";
import ArApManagementSummary from "../_components/ar-ap-management-summary";
import GroupedDetailsToggleButtons from "../_components/grouped-details-toggle-buttons";
import Sidebar from "../_components/sidebar";
import YearSelect from "../_components/year-select";
import { getDashboardModuleSyncLabels } from "../../../lib/dashboard-stats";

function toIsoString(value: Date | null) {
  return value ? value.toISOString() : null;
}

function toDateKey(value: Date | null) {
  if (!value) return "";
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toKstDateKey(value: Date) {
  const kst = new Date(value.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeReviewStatus(status: string | null | undefined) {
  if (!status || status.includes("대기")) return "대기";
  if (status.includes("완료")) return "완료";
  if (status.includes("진행")) return "진행";
  return "대기";
}

type ApManagementPageProps = {
  searchParams?: {
    year?: string;
  };
};

export default async function ApManagementPage({ searchParams }: ApManagementPageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const currentYear = new Date().getFullYear();
  const parsedYear = Number(searchParams?.year);
  const selectedYear = Number.isFinite(parsedYear) ? parsedYear : currentYear;
  const issueDtRange = {
    gte: new Date(Date.UTC(selectedYear, 0, 1)),
    lt: new Date(Date.UTC(selectedYear + 1, 0, 1)),
  };

  const [apRows, syncLabels] = await Promise.all([
    prisma.ap.findMany({
      where: {
        is_deleted: "N",
        issue_dt: issueDtRange,
      },
      orderBy: { ap_seq: "asc" },
      select: {
        ap_seq: true,
        source_id: true,
        biz_group_nm: true,
        issue_dt: true,
        client_nm: true,
        description: true,
        amount: true,
        pay_status: true,
        inspect_title: true,
        inspect_worker: true,
        inspect_body: true,
        inspect_excel: true,
      },
    }),
    getDashboardModuleSyncLabels(selectedYear),
  ]);

  const logs = await prisma.autoChangeLog.findMany({
    where: {
      module_type: "AP",
      detected_at: issueDtRange,
    },
    orderBy: { detected_at: "desc" },
    take: 2000,
    select: {
      log_seq: true,
      source_id: true,
      issue_dt: true,
      target_desc: true,
      changed_column: true,
      before_value: true,
      after_value: true,
      detected_at: true,
    },
  });

  const timelineLogs = logs.filter((log) => !log.changed_column.startsWith("inspect_"));
  const logMap = timelineLogs.reduce<Record<string, ChangeLogItem[]>>((acc, log) => {
    const key = `${log.source_id ?? ""}|${toDateKey(log.issue_dt)}|${log.target_desc}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push({
      log_seq: log.log_seq,
      changed_column: log.changed_column,
      before_value: log.before_value,
      after_value: log.after_value,
      detected_at: log.detected_at.toISOString(),
    });
    return acc;
  }, {});
  const todayKstKey = toKstDateKey(new Date());

  // source_id 중복 제거: 동일 source_id는 ap_seq가 가장 높은(최신) 레코드만 유지
  const deduplicatedApRows = (() => {
    const seen = new Map<string, typeof apRows[0]>();
    for (const row of apRows) {
      if (!row.source_id) continue;
      const prev = seen.get(row.source_id);
      if (!prev || row.ap_seq > prev.ap_seq) seen.set(row.source_id, row);
    }
    return apRows.filter(
      (row) => !row.source_id || seen.get(row.source_id)?.ap_seq === row.ap_seq,
    );
  })();

  const rows: GridRowItem[] = deduplicatedApRows.map((row) => ({
    row_id: row.ap_seq,
    source_id: row.source_id,
    target_desc: row.description,
    biz_group_nm: row.biz_group_nm,
    issue_dt: toIsoString(row.issue_dt),
    client_nm: row.client_nm,
    description: row.description,
    amount: Number(row.amount),
    inspect_status: normalizeReviewStatus(row.pay_status),
    inspect_title: row.inspect_title,
    inspect_worker: row.inspect_worker,
    inspect_body: row.inspect_body,
    inspect_excel: row.inspect_excel,
  }));

  const groupedRows = rows.reduce<Record<string, GridRowItem[]>>((acc, row) => {
    const key = row.biz_group_nm?.trim() || "미분류";
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});
  const groupEntries = Object.entries(groupedRows);
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const pendingAmount = rows
    .filter((row) => row.inspect_status !== "완료" && row.inspect_status !== "진행")
    .reduce((sum, row) => sum + row.amount, 0);

  return (
    <div className="flex min-h-screen min-w-0 overflow-x-hidden bg-slate-100">
      <Sidebar userName={session.user.name ?? "사용자"} />
      <main className="min-w-0 flex-1 overflow-x-hidden p-6 md:p-10">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="shrink-0 text-2xl font-bold text-slate-900">매입 관리 (AP)</h1>
            <GroupedDetailsToggleButtons sectionId="ap-group-details" />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <YearSelect selectedYear={selectedYear} />
            <Link
              href="/api/export/ap"
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700"
            >
              <Download size={16} />
              엑셀 다운로드
            </Link>
          </div>
        </header>

        <ArApManagementSummary
          module="ap"
          selectedYear={selectedYear}
          totalAmount={totalAmount}
          pendingAmount={pendingAmount}
          latestSyncText={syncLabels.ap}
        />

        <section id="ap-group-details" className="space-y-4">
          {groupEntries.map(([groupName, groupRows]) => {
            const sortedGroupRows = [...groupRows].sort((a, b) => {
              if (!a.issue_dt && !b.issue_dt) return 0;
              if (!a.issue_dt) return 1;
              if (!b.issue_dt) return -1;
              return new Date(a.issue_dt).getTime() - new Date(b.issue_dt).getTime();
            });
            const totalAmount = groupRows.reduce((sum, row) => sum + row.amount, 0);
            const statusSummary = groupRows.reduce(
              (acc, row) => {
                if (row.inspect_status === "완료") {
                  acc.doneCnt += 1;
                  acc.doneAmount += row.amount;
                } else if (row.inspect_status === "진행") {
                  acc.progressCnt += 1;
                  acc.progressAmount += row.amount;
                } else {
                  acc.pendingCnt += 1;
                  acc.pendingAmount += row.amount;
                }
                return acc;
              },
              {
                doneCnt: 0,
                doneAmount: 0,
                progressCnt: 0,
                progressAmount: 0,
                pendingCnt: 0,
                pendingAmount: 0,
              },
            );
            const hasTodayChange = groupRows.some((row) => {
              const rowDateKey = row.issue_dt ? row.issue_dt.slice(0, 10) : "";
              const key = `${row.source_id ?? ""}|${rowDateKey}|${row.target_desc}`;
              return (logMap[key] ?? []).some((log) => toKstDateKey(new Date(log.detected_at)) === todayKstKey);
            });
            return (
              <details
                key={groupName}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                <summary
                  className={`cursor-pointer list-none px-5 py-4 text-xs font-semibold text-slate-800 hover:bg-slate-50 ${
                    hasTodayChange ? "bg-amber-50 ring-1 ring-amber-200" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <span>
                      {groupName} ({sortedGroupRows.length}건) · {totalAmount.toLocaleString("ko-KR")}원
                    </span>
                    <span className="text-[11px] text-slate-600">
                      완료 {statusSummary.doneCnt}건/{statusSummary.doneAmount.toLocaleString("ko-KR")}원 | 진행{" "}
                      {statusSummary.progressCnt}건/{statusSummary.progressAmount.toLocaleString("ko-KR")}원 | 대기{" "}
                      {statusSummary.pendingCnt}건/{statusSummary.pendingAmount.toLocaleString("ko-KR")}원
                    </span>
                  </div>
                </summary>
                <div className="border-t border-slate-200">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">사업그룹</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">발행일</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">거래처</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">항목</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">금액</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">검수상태</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">상세</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedGroupRows.map((row, index) => {
                        const rowDateKey = row.issue_dt ? row.issue_dt.slice(0, 10) : "";
                        const key = `${row.source_id ?? ""}|${rowDateKey}|${row.target_desc}`;
                        return (
                          <HistoryTableRow
                            key={row.row_id}
                            row={row}
                            logs={logMap[key] ?? []}
                            rowIndex={index}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })}
        </section>
      </main>
    </div>
  );
}
