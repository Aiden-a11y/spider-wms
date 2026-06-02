"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Receipt, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";

const TABS = [
  { href: "/billing",       label: "Invoices",     icon: Receipt },
  { href: "/billing/rates", label: "Rate Master",  icon: SlidersHorizontal },
];

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();

  // Block Staff-level users from accessing billing via direct URL
  useEffect(() => {
    if (user?.level?.toLowerCase() === "staff") {
      router.replace("/dashboard");
    }
  }, [user, router]);

  return (
    <div className="flex flex-col min-h-full">
      {/* Tab bar */}
      <div className="bg-white border-b border-slate-200 px-8">
        <nav className="flex gap-1 -mb-px">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/billing"
                ? pathname === "/billing"
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

      {/* Page content */}
      <div className="flex-1">{children}</div>
    </div>
  );
}
