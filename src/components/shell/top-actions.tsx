"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, KeyRound, LogOut, Moon, Sparkles, Sun, ShieldCheck } from "lucide-react";
import { markNotificationsRead } from "@/app/actions/notifications";
import { useShell } from "./shell-context";
import { initials } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/roles";

function setTheme(t: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("og-theme", t); } catch { /* private mode: keep the choice for this visit only */ }
}

function Bells() {
  const { notifications } = useShell();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = seen ? 0 : notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="role-menu" ref={ref}>
      <button className="ava-btn" aria-haspopup="menu" aria-expanded={open} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        onClick={() => { setOpen((v) => !v); if (!open && unread) void markNotificationsRead().then(() => { setSeen(true); router.refresh(); }); }} style={{ position: "relative" }}>
        <Bell size={16} aria-hidden />
        {unread > 0 && <span className="badge" style={{ position: "absolute", top: -4, right: -4 }}>{unread}</span>}
      </button>
      {open && (
        <div className="menu" role="menu" style={{ minWidth: 300, maxHeight: 380, overflowY: "auto" }}>
          <div className="who"><b>Notifications</b></div>
          {notifications.length === 0 && <div className="who" style={{ color: "var(--muted)" }}>Nothing yet.</div>}
          {notifications.map((n) => {
            const inner = <><b style={{ display: "block", fontSize: 13 }}>{n.title}</b>{n.body && <span style={{ fontSize: 12, color: "var(--muted)" }}>{n.body}</span>}</>;
            return n.link ? <Link key={n.id} role="menuitem" href={n.link} onClick={() => setOpen(false)}>{inner}</Link> : <div key={n.id} className="who">{inner}</div>;
          })}
        </div>
      )}
    </div>
  );
}

export function TopActions() {
  const { me, openAsk } = useShell();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const dark = () => document.documentElement.getAttribute("data-theme") === "dark" ||
    (!document.documentElement.getAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);

  return (
    <>
      <button className="askbtn" onClick={() => openAsk()}><Sparkles aria-hidden /><span>Ask Outgrow</span></button>
      <Bells />
      <div className="role-menu" ref={ref}>
        <button className="ava-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="av" aria-hidden>{initials(me.full_name)}</span>
          <span className="sr-only">Account menu for </span>{me.full_name.split(" ")[0]}
        </button>
        {open && (
          <div className="menu" role="menu">
            <div className="who"><b>{me.full_name}</b><br />{me.app_role ? ROLE_LABEL[me.app_role] : "Admin"}{me.email ? <><br />{me.email}</> : null}</div>
            <button role="menuitem" onClick={() => { setTheme(dark() ? "light" : "dark"); setOpen(false); }}>
              <Moon size={15} aria-hidden /> / <Sun size={15} aria-hidden /> Switch light / dark
            </button>
            <Link role="menuitem" href="/account" onClick={() => setOpen(false)}><KeyRound size={15} aria-hidden /> Password &amp; account</Link>
            {me.is_admin && <Link role="menuitem" href="/admin" onClick={() => setOpen(false)}><ShieldCheck size={15} aria-hidden /> Admin</Link>}
            <form action="/auth/signout" method="post"><button role="menuitem" type="submit"><LogOut size={15} aria-hidden /> Sign out</button></form>
          </div>
        )}
      </div>
    </>
  );
}
