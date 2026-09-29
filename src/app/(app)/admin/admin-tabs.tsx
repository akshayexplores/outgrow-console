import Link from "next/link";

const TABS = [
  { key: "employees", label: "Employees", href: "/admin" },
  { key: "import", label: "Data import", href: "/admin/import" },
  { key: "settings", label: "Settings", href: "/admin/settings" },
  { key: "audit", label: "Audit", href: "/admin/audit" },
] as const;

export function AdminTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  return (
    <nav className="tabs" aria-label="Admin sections">
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} aria-selected={t.key === current} aria-current={t.key === current ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}
