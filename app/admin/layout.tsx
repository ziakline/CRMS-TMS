import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { authOptions } from "../../lib/auth-options";
import Sidebar from "../dashboard/_components/sidebar";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar userName={session.user.name ?? "사용자"} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
