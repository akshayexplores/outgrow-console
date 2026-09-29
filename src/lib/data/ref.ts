import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export interface ServiceLine { service_line_id: string; name: string; short_code: string; is_lila: boolean }
export interface ChannelRule { geography: string; primary_channel: string; follow_up_channel: string; avoid: string | null; blocked_channels: string[] | null; country_codes: string[] | null }
export interface RefData { serviceLines: ServiceLine[]; channelRules: ChannelRule[] }

/** Small reference lists every screen needs (service lines, channel rules). Cached per request. */
export const getRefData = cache(async (): Promise<RefData> => {
  const supabase = await createClient();
  const [sl, cr] = await Promise.all([
    supabase.from("service_lines").select("service_line_id,name,short_code,is_lila").eq("active", true).is("archived_at", null).order("sort_order"),
    supabase.from("channel_rules").select("geography,primary_channel,follow_up_channel,avoid,blocked_channels,country_codes").is("archived_at", null).order("geography"),
  ]);
  return { serviceLines: (sl.data ?? []) as ServiceLine[], channelRules: (cr.data ?? []) as ChannelRule[] };
});
