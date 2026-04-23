"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import Image from "next/image";
import { useState } from "react";
import {
  LayoutDashboard,
  Boxes,
  Truck,
  PackageCheck,
  RotateCcw,
  LogOut,
  History,
  Package,
  ChevronDown,
  Search,
  ClipboardList,
  ScanLine,
  Layers,
  MapPin,
  LayoutGrid,
  CheckSquare,
  Building2,
  User,
  Store,
  Globe,
} from "lucide-react";

type NavChild = { href: string; label: string; icon: React.ElementType };
type LeafItem = { href: string; label: string; icon: React.ElementType; children: undefined };
type GroupItem = { href: undefined; label: string; icon: React.ElementType; children: NavChild[] };
type NavItem = LeafItem | GroupItem;

function isGroup(item: NavItem): item is GroupItem {
  return item.children !== undefined;
}

const nav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, children: undefined },
  {
    href: undefined,
    label: "Inventory",
    icon: Boxes,
    children: [
      { href: "/inventory", label: "Inventory Inquiry", icon: Search },
      { href: "/history", label: "History", icon: History },
    ],
  },
  { href: "/products", label: "Products", icon: Package, children: undefined },
  {
    href: undefined,
    label: "Shipping",
    icon: Truck,
    children: [
      { href: "/shipping/b2b", label: "B2B Shipping", icon: Building2 },
      { href: "/shipping/b2c", label: "B2C Shipping", icon: User },
      { href: "/shipping/b2s", label: "B2S Shipping", icon: Store },
      { href: "/shipping/b2e", label: "B2E Shipping", icon: Globe },
    ],
  },
  {
    href: undefined,
    label: "Receiving",
    icon: PackageCheck,
    children: [
      { href: "/receiving", label: "Receiving Orders", icon: ClipboardList },
      { href: "/receiving/process", label: "Receiving Process", icon: ScanLine },
      { href: "/stow", label: "Stow Process", icon: Layers },
    ],
  },
  {
    href: undefined,
    label: "Locations",
    icon: MapPin,
    children: [
      { href: "/locations", label: "Location Master", icon: LayoutGrid },
      { href: "/locations/available", label: "Available Locations", icon: CheckSquare },
    ],
  },
  { href: "/returns", label: "Returns", icon: RotateCcw, children: undefined },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (["/inventory", "/history"].some((p) => pathname === p || pathname.startsWith(p + "/"))) s.add("Inventory");
    if (["/receiving", "/stow"].some((p) => pathname === p || pathname.startsWith(p + "/"))) s.add("Receiving");
    if (pathname === "/locations" || pathname.startsWith("/locations/")) s.add("Locations");
    if (pathname.startsWith("/shipping")) s.add("Shipping");
    return s;
  });

  function toggleGroup(label: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <aside className="w-60 flex-shrink-0 bg-slate-900 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <Link href="/dashboard" className="flex flex-col px-5 py-5 border-b border-slate-800 hover:bg-slate-800 transition-colors">
        <Image src="/stl-logo.png" alt="STL Logo" width={72} height={28} className="object-contain" />
        <p className="text-white font-semibold text-sm mt-2">WMS Dashboard</p>
      </Link>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {nav.map((item) => {
          if (isGroup(item)) {
            const isGroupActive = item.children.some(
              (c) => pathname === c.href || pathname.startsWith(c.href + "/")
            );
            const isOpen = openGroups.has(item.label);
            return (
              <div key={item.label}>
                <button
                  onClick={() => toggleGroup(item.label)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isGroupActive
                      ? "text-white bg-slate-800"
                      : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 text-left">{item.label}</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="mt-0.5 ml-3 pl-3 border-l border-slate-700 space-y-0.5">
                    {item.children.map(({ href, label, icon: Icon }) => {
                      const active =
                        pathname === href ||
                        (pathname.startsWith(href + "/") &&
                          !item.children.some(
                            (s) => s.href !== href && pathname.startsWith(s.href)
                          ));
                      return (
                        <Link
                          key={href}
                          href={href}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                            active
                              ? "bg-blue-600 text-white"
                              : "text-slate-400 hover:bg-slate-800 hover:text-white"
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                          {label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
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
          Logout
        </button>
      </div>
    </aside>
  );
}
