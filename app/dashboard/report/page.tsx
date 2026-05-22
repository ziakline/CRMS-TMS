import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../../lib/auth-options";
import Sidebar from "../_components/sidebar";
import AuditReportClient from "./audit-report-client";

export default async function AuditReportPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  return (
    <div className="flex min-h-screen min-w-0 overflow-x-hidden bg-slate-100">
      <Sidebar userName={session.user.name ?? "사용자"} />
      <main className="min-w-0 flex-1 overflow-x-hidden p-6 md:p-10">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">보고서</h1>
          <p className="mt-1 text-sm text-slate-600">매출·매입·운영비 변동 감사 리포트</p>
        </header>
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
          <AuditReportClient />
        </section>
      </main>
    </div>
  );
}
