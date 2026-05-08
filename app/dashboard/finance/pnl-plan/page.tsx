import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../../../lib/auth-options";
import Sidebar from "../../_components/sidebar";
import PnlGridClient from "./pnl-grid-client";

export default async function FinancePnlPlanPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  return (
    <div className="flex min-h-screen min-w-0 bg-slate-100">
      <Sidebar userName={session.user.name ?? "사용자"} />
      <main className="min-w-0 flex-1 p-6 md:p-10">
        <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <PnlGridClient initialYear={new Date().getFullYear()} />
        </section>
      </main>
    </div>
  );
}
