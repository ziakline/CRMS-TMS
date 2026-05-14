import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../../lib/auth-options";
import { prisma } from "../../../lib/prisma";
import { formatKstDateTime } from "../../../lib/time";
import Sidebar from "../_components/sidebar";
import YearSelect from "../_components/year-select";

function formatDate(value: Date) {
  return formatKstDateTime(value, true);
}

type RecentHistoryPageProps = {
  searchParams?: {
    year?: string;
  };
};

export default async function RecentHistoryPage({ searchParams }: RecentHistoryPageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const currentYear = new Date().getFullYear();
  const parsedYear = Number(searchParams?.year);
  const selectedYear = Number.isFinite(parsedYear) ? parsedYear : currentYear;
  const dateRange = {
    gte: new Date(Date.UTC(selectedYear, 0, 1)),
    lt: new Date(Date.UTC(selectedYear + 1, 0, 1)),
  };

  const histories = await prisma.manualHistory.findMany({
    where: {
      change_dt: dateRange,
    },
    orderBy: { change_dt: "desc" },
    take: 500,
    select: {
      history_seq: true,
      change_dt: true,
      worker_nm: true,
      remarks: true,
    },
  });

  return (
    <div className="flex min-h-screen min-w-0 overflow-x-hidden bg-slate-100">
      <Sidebar userName={session.user.name ?? "사용자"} />
      <main className="min-w-0 flex-1 overflow-x-hidden p-6 md:p-10">
        <header className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-slate-900">최근 변경 이력</h1>
          <YearSelect selectedYear={selectedYear} />
        </header>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">변경일시</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">담당자</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">변경이력</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 [&>tr:nth-child(even)]:bg-slate-50">
              {histories.map((history) => (
                <tr key={history.history_seq}>
                  <td className="px-4 py-3">{formatDate(history.change_dt)}</td>
                  <td className="px-4 py-3 font-semibold">{history.worker_nm ?? "-"}</td>
                  <td className="px-4 py-3 whitespace-pre-wrap">{history.remarks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
