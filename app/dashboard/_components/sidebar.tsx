"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname, useSearchParams } from "next/navigation";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  BriefcaseBusiness,
  BarChart3,
  ChevronLeft,
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
  Menu,
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
  const [collapsed, setCollapsed] = useState(false);

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

  useEffect(() => {
    const saved = window.localStorage.getItem("sidebar-collapsed");
    if (saved === "1") setCollapsed(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  const withYearQuery = (href: string) => {
    if (!selectedYear || !href.startsWith("/dashboard")) return href;
    const connector = href.includes("?") ? "&" : "?";
    return `${href}${connector}year=${encodeURIComponent(selectedYear)}`;
  };

  return (
    <aside
      className={`sticky top-0 flex h-screen shrink-0 flex-col overflow-x-visible overflow-y-auto bg-slate-900 text-slate-100 transition-all duration-300 ${
        collapsed ? "w-16" : "w-full max-w-[15rem]"
      }`}
    >
      <div className={`border-b border-slate-800 ${collapsed ? "px-2 py-4" : "px-6 py-6"}`}>
        <div className="flex items-center justify-between gap-2">
          {!collapsed ? (
            <div>
              <h1 className="text-lg font-bold tracking-wide text-white">CRMS 관리시스템</h1>
              <p className="mt-1 text-xs text-slate-400">CRMS Management System</p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            className="rounded-md p-1 text-slate-300 transition hover:bg-slate-800 hover:text-white"
            title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          >
            {collapsed ? <Menu size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </div>

      <nav className={`flex-1 space-y-3 ${collapsed ? "px-1 py-3" : "px-3 py-5"}`}>
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
                className={`group relative flex w-full items-center ${collapsed ? "justify-center" : "gap-2"} rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  hasActiveChild
                    ? "text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <GroupIcon size={15} className="shrink-0" />
                {!collapsed ? <span className="flex-1 text-left">{group.label}</span> : null}
                {!collapsed ? (
                  <ChevronDown
                    size={14}
                    className={`transition ${openGroups[group.key] ? "rotate-180" : ""}`}
                  />
                ) : null}
                {collapsed ? (
                  <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded bg-slate-950/95 px-2 py-1 text-[11px] text-white opacity-0 shadow transition-all duration-150 group-hover:opacity-100">
                    {group.label}
                  </span>
                ) : null}
              </button>

              {openGroups[group.key] && !collapsed ? (
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
            className={`group relative flex items-center ${collapsed ? "justify-center" : "gap-2"} rounded-md px-3 py-2 text-xs font-semibold transition ${
              pathname === "/admin/users" || pathname.startsWith("/admin/users/")
                ? "bg-slate-700 text-white"
                : "text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <Users size={14} className="shrink-0" />
            {!collapsed ? <span className="whitespace-nowrap">사용자 관리</span> : null}
            {!collapsed ? (
              <span className="ml-auto rounded bg-indigo-500/30 px-2 py-0.5 text-[10px] text-indigo-200">
                ADMIN
              </span>
            ) : null}
            {collapsed ? (
              <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded bg-slate-950/95 px-2 py-1 text-[11px] text-white opacity-0 shadow transition-all duration-150 group-hover:opacity-100">
                사용자 관리
              </span>
            ) : null}
          </Link>
          <Link
            href="/admin/targets"
            className={`group relative mt-1 flex items-center ${collapsed ? "justify-center" : "gap-2"} rounded-md px-3 py-2 text-xs font-semibold transition ${
              pathname === "/admin/targets" || pathname.startsWith("/admin/targets/")
                ? "bg-slate-700 text-white"
                : "text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <Database size={14} className="shrink-0" />
            {!collapsed ? <span className="whitespace-nowrap">크롤링 타겟</span> : null}
            {!collapsed ? (
              <span className="ml-auto rounded bg-indigo-500/30 px-2 py-0.5 text-[10px] text-indigo-200">
                ADMIN
              </span>
            ) : null}
            {collapsed ? (
              <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded bg-slate-950/95 px-2 py-1 text-[11px] text-white opacity-0 shadow transition-all duration-150 group-hover:opacity-100">
                크롤링 타겟
              </span>
            ) : null}
          </Link>
        </div>
      </nav>

      <div className={`border-t border-slate-800 ${collapsed ? "px-2 py-3" : "px-4 py-4"}`}>
        {!collapsed ? <p className="mb-3 text-sm text-slate-300">{userName}님</p> : null}
        <button
          type="button"
          onClick={() =>
            signOut({
              callbackUrl: "/login",
            })
          }
          className={`group relative rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 ${
            collapsed ? "w-full text-xs" : "w-full"
          }`}
        >
          {collapsed ? "OUT" : "로그아웃"}
          {collapsed ? (
            <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded bg-slate-950/95 px-2 py-1 text-[11px] text-white opacity-0 shadow transition-all duration-150 group-hover:opacity-100">
              로그아웃
            </span>
          ) : null}
        </button>
      </div>
    </aside>
  );
}
