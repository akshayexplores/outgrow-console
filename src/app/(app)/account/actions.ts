"use server";
import { z } from "zod";
import { requireActionSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { errResult, okResult, type ActionResult } from "@/lib/types";

const schema = z.object({
  password: z.string().min(10, "Use at least 10 characters.").max(128),
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { message: "The two passwords don't match.", path: ["confirm"] });

/** Optional: lets a person sign in with a password as well as the emailed link. */
export async function setPassword(input: unknown): Promise<ActionResult> {
  await requireActionSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return errResult(parsed.error.issues[0]?.message ?? "Check the form.");
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return errResult(error.message.includes("same") ? "Choose a password you haven't used before." : "Couldn't set the password. Try a longer one.");
  return okResult(undefined);
}
