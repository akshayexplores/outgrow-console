import { redirect } from "next/navigation";
import { getSession, landingFor } from "@/lib/auth/session";

export default async function Home() {
  const s = await getSession();
  if (!s) redirect("/login");
  redirect(landingFor(s.me));
}
