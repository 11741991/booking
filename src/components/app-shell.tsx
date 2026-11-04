import Link from "next/link";
import type { AppUser } from "@/lib/roles";
import { ROLE_LABELS } from "@/lib/roles";
import { SignOutButton } from "./sign-out-button";

type NavItem = { href: string; label: string };

export function AppShell({ user, children }: { user: AppUser; children: React.ReactNode }) {
  const nav: NavItem[] = [];
  if (user.roles.includes("hunter")) nav.push({ href: "/", label: "Слоты" });
  if (user.roles.includes("closer")) nav.push({ href: "/", label: "Моё расписание" });
  if (user.roles.includes("rop")) nav.push({ href: "/", label: "Все встречи" });
  if (user.roles.includes("admin")) {
    nav.push({ href: "/admin/users", label: "Сотрудники" });
    nav.push({ href: "/admin/settings", label: "Настройки" });
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <Link href="/" className="font-semibold">
            Букинг
          </Link>
          <nav className="flex gap-1 overflow-x-auto text-sm">
            {nav.map((n) => (
              <Link
                key={n.href + n.label}
                href={n.href}
                className="px-3 py-1.5 rounded-lg hover:bg-gray-100 whitespace-nowrap"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden sm:inline text-gray-600">
              {user.name} · {user.roles.map((r) => ROLE_LABELS[r]).join(", ")}
            </span>
            <SignOutButton className="btn-secondary px-3 py-1.5" />
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto p-4">{children}</main>
    </div>
  );
}
