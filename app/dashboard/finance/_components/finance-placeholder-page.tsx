import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../../../lib/auth-options";
import Sidebar from "../../_components/sidebar";

type FinancePlaceholderPageProps = {
  title: string;
};

export default async function FinancePlaceholderPage({
  title,
}: FinancePlaceholderPageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar userName={session.user.name ?? "사용자"} />
      <main className="flex-1 p-6 md:p-10">
        <section className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            {title} 화면은 현재 준비 중입니다. 메뉴 구조 확정 후 상세 기능을 순차적으로
            적용합니다.
          </div>
        </section>
      </main>
    </div>
  );
}
