"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "ホーム" },
  { href: "/reports", label: "記事" },
  { href: "/fish", label: "魚種図鑑" },
  { href: "/ranking", label: "ランキング" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex w-full items-center justify-around gap-1 sm:w-auto sm:justify-end sm:gap-2">
      {links.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors ${
              active
                ? "bg-blue-600 font-bold text-white"
                : "text-slate-600 hover:bg-blue-50 hover:text-blue-700"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
