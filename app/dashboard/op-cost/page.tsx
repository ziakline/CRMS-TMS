import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Sidebar from "../_components/sidebar";
import YearSelect from "../_components/year-select";
import { authOptions } from "../../../lib/auth-options";
import { prisma } from "../../../lib/prisma";

type OpCostPageProps = {
  searchParams?: {
    year?: string;
  };
};

function formatWon(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return 0;
}

export default async function OpCostPage({ searchParams }: OpCostPageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const currentYear = new Date().getFullYear();
  const parsedYear = Number(searchParams?.year);
  const selectedYear = Number.isFinite(parsedYear) ? parsedYear : currentYear;
  const issueDtRange = {
    gte: new Date(Date.UTC(selectedYear, 0, 1)),
    lt: new Date(Date.UTC(selectedYear + 1, 0, 1)),
  };

  const [rows, logs] = await Promise.all([
    prisma.operatingCost.findMany({
      where: { base_year: selectedYear },
      orderBy: { target_month: "asc" },
    }),
    prisma.autoChangeLog.findMany({
      where: {
        module_type: "OP",
        issue_dt: issueDtRange,
      },
      orderBy: { detected_at: "desc" },
      select: {
        target_desc: true,
        changed_column: true,
        before_value: true,
      },
      take: 5000,
    }),
  ]);

  const prevMap = new Map<string, string>();
  for (const log of logs) {
    if (!log.before_value) continue;
    const key = `${log.target_desc}|${log.changed_column}`;
    if (!prevMap.has(key)) prevMap.set(key, log.before_value);
  }

  const normalizedRows = rows.map((row) => ({
    ...row,
    labor_cost: toNumber(row.labor_cost),
    insurance_cost: toNumber(row.insurance_cost),
    severance_cost: toNumber(row.severance_cost),
    dept_op_cost: toNumber(row.dept_op_cost),
    total_cost: toNumber(row.total_cost),
  }));

  const totals = normalizedRows.reduce(
    (acc, row) => {
      acc.labor += row.labor_cost;
      acc.insurance += row.insurance_cost;
      acc.severance += row.severance_cost;
      acc.dept += row.dept_op_cost;
      acc.total += row.total_cost;
      return acc;
    },
    { labor: 0, insurance: 0, severance: 0, dept: 0, total: 0 },
  );

  const renderAmountCell = (month: string, field: string, amount: number) => {
    const prev = prevMap.get(`${month}|${field}`);
    return (
      <div className="text-right">
        <p className="font-semibold text-slate-900">{formatWon(amount)}</p>
        {prev ? (
          <p className="mt-1 text-[11px] text-slate-500">(직전 금액: {formatWon(Number(prev))})</p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar userName={session.user.name ?? "사용자"} />
      <main className="flex-1 p-6 md:p-10">
        <header className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-slate-900">운영비 관리</h1>
          <YearSelect selectedYear={selectedYear} />
        </header>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">년월</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">인건비</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">4대보험</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">퇴직급여</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">부서운영비</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">합계</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 [&>tr:nth-child(even)]:bg-slate-50">
              {normalizedRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">
                    운영비 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                normalizedRows.map((row) => (
                  <tr key={row.op_seq}>
                    <td className="px-4 py-3 font-medium text-slate-800">{row.target_month}</td>
                    <td className="px-4 py-3">{renderAmountCell(row.target_month, "labor_cost", row.labor_cost)}</td>
                    <td className="px-4 py-3">
                      {renderAmountCell(row.target_month, "insurance_cost", row.insurance_cost)}
                    </td>
                    <td className="px-4 py-3">
                      {renderAmountCell(row.target_month, "severance_cost", row.severance_cost)}
                    </td>
                    <td className="px-4 py-3">{renderAmountCell(row.target_month, "dept_op_cost", row.dept_op_cost)}</td>
                    <td className="px-4 py-3">{renderAmountCell(row.target_month, "total_cost", row.total_cost)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="border-t-2 border-slate-300 bg-slate-100">
              <tr>
                <td className="px-4 py-3 text-sm font-bold text-slate-900">합계</td>
                <td className="px-4 py-3 text-right text-sm font-bold text-slate-900">{formatWon(totals.labor)}</td>
                <td className="px-4 py-3 text-right text-sm font-bold text-slate-900">
                  {formatWon(totals.insurance)}
                </td>
                <td className="px-4 py-3 text-right text-sm font-bold text-slate-900">
                  {formatWon(totals.severance)}
                </td>
                <td className="px-4 py-3 text-right text-sm font-bold text-slate-900">{formatWon(totals.dept)}</td>
                <td className="px-4 py-3 text-right text-sm font-bold text-slate-900">{formatWon(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </section>
      </main>
    </div>
  );
}
