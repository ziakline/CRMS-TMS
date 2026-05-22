import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../../../lib/auth-options";
import Sidebar from "../../_components/sidebar";
import PnlGridAllClient from "./pnl-grid-all-client";

export default async function FinancePnlPlanR2Page() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  return (
    <div className="flex h-screen min-w-0 overflow-hidden bg-slate-100">
      <Sidebar userName={session.user.name ?? "사용자"} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden p-4 md:p-6">
        <PnlGridAllClient initialYear={new Date().getFullYear()} />
      </main>
    </div>
  );
}
