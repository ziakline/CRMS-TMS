import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../lib/auth-options";
import { prisma } from "../../lib/prisma";
import { getDashboardModuleSyncLabels, getDashboardStats } from "../../lib/dashboard-stats";
import DashboardContent from "./_components/dashboard-content";
import Sidebar from "./_components/sidebar";

function getGreetingByHour(date: Date) {
  const hour = toKstDate(date).getUTCHours();

  if (hour < 12) return "좋은 아침입니다";
  if (hour < 18) return "좋은 오후입니다";
  return "좋은 저녁입니다";
}

// [수정 2] formatDate 함수를 date-fns의 format으로 교체 (서버/클라이언트 동일 텍스트 렌더링)
function toKstDate(input: Date) {
  return new Date(input.getTime() + 9 * 60 * 60 * 1000);
}

function formatDate(date: Date) {
  const kstDate = toKstDate(date);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const yyyy = kstDate.getUTCFullYear();
  const mm = String(kstDate.getUTCMonth() + 1);
  const dd = String(kstDate.getUTCDate());
  const day = weekdays[kstDate.getUTCDay()];
  return `${yyyy}년 ${mm}월 ${dd}일 ${day}`;
}

type DashboardPageProps = {
  searchParams?: {
    year?: string;
  };
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/login");
  }

  const currentYear = new Date().getFullYear();
  const parsedYear = Number(searchParams?.year);
  const selectedYear = Number.isFinite(parsedYear) ? parsedYear : currentYear;
  const yearRange = {
    gte: new Date(Date.UTC(selectedYear, 0, 1)),
    lt: new Date(Date.UTC(selectedYear + 1, 0, 1)),
  };

  const [stats, recentHistories, syncLabels] = await Promise.all([
    getDashboardStats(selectedYear),
    prisma.manualHistory.findMany({
      where: {
        change_dt: yearRange,
      },
      orderBy: { change_dt: "desc" },
      take: 5,
      select: {
        history_seq: true,
        project_cd: true,
        worker_nm: true,
        remarks: true,
        change_dt: true,
      },
    }),
    getDashboardModuleSyncLabels(selectedYear),
  ]);

  const now = new Date();
  const greeting = getGreetingByHour(now);
  const userName = session.user.name ?? "사용자";
  const currentDateText = formatDate(now);
  
  return (
    <div className="flex min-h-screen min-w-0 overflow-x-hidden bg-slate-100">
      <Sidebar userName={userName} />
      <DashboardContent
        userName={userName}
        currentDateText={currentDateText}
        greetingText={greeting}
        initialStats={stats}
        latestArSyncText={syncLabels.ar}
        latestApSyncText={syncLabels.ap}
        selectedYear={selectedYear}
        recentHistories={recentHistories.map((history) => ({
          ...history,
          change_dt: history.change_dt.toISOString(),
        }))}
      />
    </div>
  );
}