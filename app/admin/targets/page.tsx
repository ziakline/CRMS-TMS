import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../../lib/auth-options";
import { prisma } from "../../../lib/prisma";
import TargetsClient from "./targets-client";

export default async function AdminTargetsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const targets = await prisma.crawlTarget.findMany({
    orderBy: { target_seq: "desc" },
    select: {
      target_seq: true,
      base_year: true,
      project_name: true,
      project_cd: true,
      biz_sector_nm: true,
      biz_dept_nm: true,
      is_active: true,
    },
  });

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 sm:px-8">
      <section className="mx-auto w-full max-w-6xl">
        <TargetsClient initialTargets={targets} />
      </section>
    </main>
  );
}
