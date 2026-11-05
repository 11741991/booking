import Link from "next/link";
import type { AppUser } from "@/lib/roles";
import { ROLE_LABELS } from "@/lib/roles";
import { SignOutButton } from "./sign-out-button";
import { NavLinks } from "./nav-links";

export function navFor(user: AppUser) {
  const r = user.roles;
  const nav: { href: string; label: string }[] = [];
  if (r.includes("hunter") || r.includes("rop") || r.includes("admin"))
    nav.push({ href: "/slots", label: "Слоты" });
  if (r.includes("closer") || r.includes("rop") || r.includes("admin"))
    nav.push({ href: "/schedule", label: r.includes("closer") ? "Моё расписание" : "Расписание" });
  if (r.includes("admin")) {
    nav.push({ href: "/admin/users", label: "Сотрудники" });
    nav.push({ href: "/admin/settings", label: "Настройки" });
  }
  return nav;
}

export function AppShell({ user, children }: { user: AppUser; children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link href="/" className="font-semibold shrink-0">
            Букинг
          </Link>
          <div className="hidden md:block">
            <NavLinks items={navFor(user)} />
          </div>
          <div className="flex items-center gap-3 text-sm shrink-0">
            <span className="hidden lg:inline text-gray-600">
              {user.name} · {user.roles.map((r) => ROLE_LABELS[r]).join(", ")}
            </span>
            <SignOutButton className="btn-secondary px-3 py-1.5" />
          </div>
        </div>
        <div className="md:hidden border-t border-gray-100 px-2 py-1.5">
          <NavLinks items={navFor(user)} />
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto p-4">{children}</main>
    </div>
  );
}
