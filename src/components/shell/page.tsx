import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { TopActions } from "./top-actions";

/** A page: sticky top bar (title, Ask Outgrow, account menu) + content column. */
export function Page({ title, back, wide, children }: { title: string; back?: { href: string; label: string }; wide?: boolean; children: React.ReactNode }) {
  return (
    <>
      <header className="top">
        {back && <Link className="btn sm" href={back.href} aria-label={`Back to ${back.label}`}><ArrowLeft size={14} aria-hidden /></Link>}
        <h1>{title}</h1>
        <div className="sp" />
        <TopActions />
      </header>
      <main id="main" className={`content${wide ? " wide" : ""}`}>{children}</main>
    </>
  );
}
