"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Package, ClipboardList } from "lucide-react";

const TABS = [
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/inventory/cycle-count", label: "Cycle Count", icon: ClipboardList },
];

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col min-h-full">
      <div className="bg-white border-b border-slate-200 px-8">
        <nav className="flex gap-1 -mb-px">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/inventory"
                ? pathname === "/inventory"
                : pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
