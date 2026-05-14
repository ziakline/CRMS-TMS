import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../../../../lib/auth-options";
import Sidebar from "../../../_components/sidebar";
import CrmsMappingClient from "../crms-mapping-client";

export default async function PnlCrmsMappingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  return (
    <div className="flex min-h-screen min-w-0 bg-slate-100">
      <Sidebar userName={session.user.name ?? "사용자"} />
      <main className="min-w-0 flex-1 p-6 md:p-10">
        <Suspense
          fallback={<p className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">불러오는 중…</p>}
        >
          <CrmsMappingClient />
        </Suspense>
      </main>
    </div>
  );
}
