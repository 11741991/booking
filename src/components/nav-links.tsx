"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto text-sm">
      {items.map((n) => {
        const active = path === n.href || path.startsWith(n.href + "/");
        return (
          <Link
            key={n.href}
            href={n.href}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap ${
              active ? "bg-gray-900 text-white" : "hover:bg-gray-100 text-gray-700"
            }`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
