import { z } from "zod";
import { DEMO_MENU } from "@/src/shared/demo-data";
import type { MenuCategory, MenuItem } from "@/src/features/menu/domain/menu";
import { getPublicSupabase, isDemoMode } from "@/src/lib/supabase/server";
import { signLegacyTeamRequest, signPublicMenuRequest, signTableResolution } from "@/src/shared/security/request-signing";

const publicMenuSchema = z.array(z.object({
  id: z.string().uuid(), name: z.string(), description: z.string(), price: z.number().int().nonnegative(),
  category: z.string(), status: z.enum(["AVAILABLE", "SOLD_OUT"]), stock_quantity: z.number().int().nonnegative(),
}));

const emojiByCategory: Record<string, string> = { "안주": "🥘", "식사": "🍜", "간식": "🥔", "음료": "🍹" };

export async function loadPublicMenu(teamSlug?: string): Promise<MenuItem[] | null> {
  if (isDemoMode()) return DEMO_MENU;
  const supabase = getPublicSupabase();
  if (!supabase) return null;
  const proof = await signPublicMenuRequest(teamSlug);
  const { data, error } = teamSlug
    ? await supabase.rpc("get_public_menu", { p_team_slug: teamSlug, p_request_timestamp: proof.requestTimestamp, p_signature: proof.signature })
    : await supabase.rpc("get_public_menu", { p_request_timestamp: proof.requestTimestamp, p_signature: proof.signature });
  if (error) return null;
  const parsed = publicMenuSchema.safeParse(data);
  if (!parsed.success) return null;
  return parsed.data.map((item) => ({
    id: item.id, name: item.name, description: item.description, price: item.price,
    category: item.category as MenuCategory, status: item.status, stockQuantity: item.stock_quantity,
    reservedQuantity: 0, soldQuantity: 0, emoji: emojiByCategory[item.category] ?? "🍽️",
  }));
}

const tableSchema = z.object({ id: z.string().uuid(), table_number: z.number().int().positive(), team_slug: z.string().regex(/^team-[a-f0-9]{16}$/) });

export async function resolveTable(qrToken: string): Promise<{ id: string; tableNumber: number; teamSlug: string } | null> {
  if (isDemoMode()) {
    const demoTableNumber = qrToken === "table-7-demo" ? 7 : Number(/^demo-table-(\d+)-qr-[a-z0-9-]+$/i.exec(qrToken)?.[1]);
    if (Number.isInteger(demoTableNumber) && demoTableNumber > 0 && demoTableNumber <= 200) {
      return { id: `00000000-0000-4000-8000-${String(demoTableNumber).padStart(12, "0")}`, tableNumber: demoTableNumber, teamSlug: "team-0000000000000000" };
    }
  }
  const supabase = getPublicSupabase();
  if (!supabase) return null;
  const proof = await signTableResolution(qrToken);
  const { data, error } = await supabase.rpc("resolve_festival_table", {
    p_qr_token: qrToken,
    p_request_timestamp: proof.requestTimestamp,
    p_signature: proof.signature,
  });
  if (error) return null;
  const parsed = tableSchema.safeParse(data);
  return parsed.success ? { id: parsed.data.id, tableNumber: parsed.data.table_number, teamSlug: parsed.data.team_slug } : null;
}

export async function loadLegacyTeamSlug(): Promise<string | null> {
  if (isDemoMode()) return "team-0000000000000000";
  const supabase = getPublicSupabase();
  if (!supabase) return null;
  const proof = await signLegacyTeamRequest();
  const { data, error } = await supabase.rpc("get_legacy_festival_team_slug", {
    p_request_timestamp: proof.requestTimestamp,
    p_signature: proof.signature,
  });
  return !error && typeof data === "string" && /^team-[a-f0-9]{16}$/.test(data) ? data : null;
}
