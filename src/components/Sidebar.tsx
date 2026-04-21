"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import {
  LayoutDashboard,
  Boxes,
  Truck,
  PackageCheck,
  RotateCcw,
  LogOut,
  Warehouse,
  History,
} from "lucide-react";

const nav = [
  { href: "/dashboard", label: "대시보드", icon: LayoutDashboard },
  { href: "/inventory", label: "재고 (로케이션)", icon: Boxes },
  { href: "/history", label: "재고 히스토리", icon: History },
  { href: "/shipping", label: "출고 주문", icon: Truck },
  { href: "/receiving", label: "입고", icon: PackageCheck },
  { href: "/returns", label: "반품", icon: RotateCcw },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside className="w-60 flex-shrink-0 bg-slate-900 flex flex-col min-h-screen">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-800">
        <div className="bg-blue-500 p-2 rounded-lg">
          <Warehouse className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-white font-semibold text-sm leading-tight">WMS Dashboard</p>
          <p className="text-slate-500 text-xs">Spider WMS</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-3 py-4 border-t border-slate-800">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div className="w-7 h-7 bg-slate-700 rounded-full flex items-center justify-center text-xs text-slate-300 font-medium flex-shrink-0">
            {user?.name?.[0]?.toUpperCase() ?? user?.userId?.[0]?.toUpperCase() ?? "U"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-medium truncate">{user?.name ?? user?.userId}</p>
            <p className="text-slate-500 text-xs truncate">{user?.userId}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2 w-full text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg text-sm transition-colors"
        >
          <LogOut className="w-4 h-4" />
          로그아웃
        </button>
      </div>
    </aside>
  );
}
