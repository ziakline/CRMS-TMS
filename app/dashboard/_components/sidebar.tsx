"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname, useSearchParams } from "next/navigation";
import type { ComponentType } from "react";
import { useMemo, useState } from "react";
import {
  BriefcaseBusiness,
  BarChart3,
  ChevronDown,
  ClipboardList,
  Code2,
  FileSpreadsheet,
  FolderKanban,
  CreditCard,
  Database,
  History,
  LineChart,
  LayoutDashboard,
  ListChecks,
  PackageSearch,
  Users,
} from "lucide-react";

type SidebarProps = {
  userName: string;
};

type ChildMenuItem = {
  href: string;
  label: string;
};

type MenuGroup = {
  key: "tracking" | "finance";
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  children: ChildMenuItem[];
};

const groupedMenus: MenuGroup[] = [
  {
    key: "tracking",
    label: "CRMS 추적관리",
    icon: FolderKanban,
    children: [
      { href: "/dashboard", label: "대시보드" },
      { href: "/dashboard/ar", label: "매출 관리" },
      { href: "/dashboard/ap", label: "매입 관리" },
      { href: "/dashboard/op-cost", label: "운영비 관리" },
      { href: "/dashboard/history", label: "CRMS 변경 이력" },
      { href: "/dashboard/recent-history", label: "CRMS 히스토리" },
    ],
  },
  {
    key: "finance",
    label: "재무관리",
    icon: BriefcaseBusiness,
    children: [
      { href: "/dashboard/finance/weekly", label: "주간보고 현황판" },
      { href: "/dashboard/finance/pnl-board", label: "손익계획 현황판" },
      { href: "/dashboard/finance/pnl-plan", label: "손익계획" },
      { href: "/dashboard/finance/hr", label: "인력관리" },
      { href: "/dashboard/finance/code", label: "코드관리" },
      { href: "/dashboard/finance/competitor-price", label: "타행상품가격" },
    ],
  },
];

export default function Sidebar({ userName }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedYear = searchParams.get("year");
  const activeGroup = useMemo(() => {
    if (pathname.startsWith("/dashboard/finance")) return "finance";
    return "tracking";
  }, [pathname]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    tracking: activeGroup === "tracking",
    finance: activeGroup === "finance",
  });

  const iconMap: Record<string, ComponentType<{ size?: number; className?: string }>> = {
    "/dashboard": LayoutDashboard,
    "/dashboard/ar": BarChart3,
    "/dashboard/ap": CreditCard,
    "/dashboard/op-cost": ClipboardList,
    "/dashboard/history": History,
    "/dashboard/recent-history": ListChecks,
    "/dashboard/finance/weekly": ClipboardList,
    "/dashboard/finance/pnl-board": LineChart,
    "/dashboard/finance/pnl-plan": FileSpreadsheet,
    "/dashboard/finance/hr": Users,
    "/dashboard/finance/code": Code2,
    "/dashboard/finance/competitor-price": PackageSearch,
  };

  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const withYearQuery = (href: string) => {
    if (!selectedYear || !href.startsWith("/dashboard")) return href;
    const connector = href.includes("?") ? "&" : "?";
    return `${href}${connector}year=${encodeURIComponent(selectedYear)}`;
  };

  return (
    <aside className="sticky top-0 flex h-screen w-full max-w-[15rem] shrink-0 flex-col overflow-y-auto bg-slate-900 text-slate-100">
      <div className="border-b border-slate-800 px-6 py-6">
        <h1 className="text-lg font-bold tracking-wide text-white">CRMS 관리시스템</h1>
        <p className="mt-1 text-xs text-slate-400">CRMS Management System</p>
      </div>

      <nav className="flex-1 space-y-3 px-3 py-5">
        {groupedMenus.map((group) => {
          const GroupIcon = group.icon;
          const hasActiveChild = group.children.some((item) =>
            item.href === "/dashboard"
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`),
          );

          return (
            <div key={group.key} className="rounded-lg border border-slate-800 bg-slate-950/40">
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  hasActiveChild
                    ? "text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <GroupIcon size={15} className="shrink-0" />
                <span className="flex-1 text-left">{group.label}</span>
                <ChevronDown
                  size={14}
                  className={`transition ${openGroups[group.key] ? "rotate-180" : ""}`}
                />
              </button>

              {openGroups[group.key] ? (
                <div className="space-y-1 px-2 pb-2">
                  {group.children.map((item) => {
                    const isActive =
                      item.href === "/dashboard"
                        ? pathname === item.href
                        : pathname === item.href || pathname.startsWith(`${item.href}/`);
                    const ItemIcon = iconMap[item.href] ?? Database;
                    return (
                      <Link
                        key={item.href}
                        href={withYearQuery(item.href)}
                        className={`flex items-center gap-2 rounded-md px-3 py-2 pl-4 text-xs transition ${
                          isActive
                            ? "bg-slate-700 text-white"
                            : "text-slate-300 hover:bg-slate-800 hover:text-white"
                        }`}
                      >
                        <ItemIcon size={14} className="shrink-0" />
                        <span className="whitespace-nowrap">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}

        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-1">
          <Link
            href="/admin/users"
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition ${
              pathname === "/admin/users" || pathname.startsWith("/admin/users/")
                ? "bg-slate-700 text-white"
                : "text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <Users size={14} className="shrink-0" />
            <span className="whitespace-nowrap">사용자 관리</span>
            <span className="ml-auto rounded bg-indigo-500/30 px-2 py-0.5 text-[10px] text-indigo-200">
              ADMIN
            </span>
          </Link>
          <Link
            href="/admin/targets"
            className={`mt-1 flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition ${
              pathname === "/admin/targets" || pathname.startsWith("/admin/targets/")
                ? "bg-slate-700 text-white"
                : "text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <Database size={14} className="shrink-0" />
            <span className="whitespace-nowrap">크롤링 타겟</span>
            <span className="ml-auto rounded bg-indigo-500/30 px-2 py-0.5 text-[10px] text-indigo-200">
              ADMIN
            </span>
          </Link>
        </div>
      </nav>

      <div className="border-t border-slate-800 px-4 py-4">
        <p className="mb-3 text-sm text-slate-300">{userName}님</p>
        <button
          type="button"
          onClick={() =>
            signOut({
              callbackUrl: "/login",
            })
          }
          className="w-full rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
        >
          로그아웃
        </button>
      </div>
    </aside>
  );
}
