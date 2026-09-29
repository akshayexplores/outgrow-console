import { z } from "zod";

/** Public values are referenced statically so Next.js can inline them into the browser bundle. */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
};

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, "SUPABASE_SERVICE_ROLE_KEY is not set"),
  ADMIN_EMAIL: z.string().email("ADMIN_EMAIL must be an email"),
  ALLOWED_EMAIL_DOMAIN: z.string().optional().default(""),
  APP_TIMEZONE: z.string().optional().default("Asia/Kolkata"),
  OPENROUTER_API_KEY: z.string().optional().default(""),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().positive().optional().default(150),
  CRON_SECRET: z.string().optional().default(""),
  VERCEL_URL: z.string().optional().default(""),
});

export type ServerEnv = z.infer<typeof serverSchema>;
let cached: ServerEnv | null = null;

/** Server-only secrets. Validated on first use so a missing optional key never breaks unrelated pages. */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Server environment is incomplete: ${msg}`);
  }
  cached = parsed.data;
  return cached;
}

/** The public base URL used in auth redirects and OpenRouter's HTTP-Referer. */
export function appUrl(fallbackOrigin?: string): string {
  const configured = publicEnv.appUrl.replace(/\/$/, "");
  if (configured) return configured;
  if (fallbackOrigin) return fallbackOrigin.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}
