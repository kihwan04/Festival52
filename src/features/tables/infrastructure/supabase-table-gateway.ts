import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { TableGateway } from "@/src/features/tables/application/table-service";
import type { FestivalTable } from "@/src/shared/demo-data";
import { conflict } from "@/src/shared/errors/app-error";

const tableRowsSchema = z.array(z.object({
  id: z.string().uuid(), table_number: z.number().int().positive(), qr_token: z.string().min(16), is_active: z.boolean(),
}));

export class SupabaseTableGateway implements TableGateway {
  constructor(private readonly client: SupabaseClient) {}

  async configure(count: number): Promise<FestivalTable[]> {
    const { data, error } = await this.client.rpc("configure_festival_tables", { p_count: count });
    if (error) throw conflict("테이블을 설정하지 못했습니다.");
    const parsed = tableRowsSchema.safeParse(data);
    if (!parsed.success) throw conflict("테이블 설정 결과를 확인하지 못했습니다.");
    return parsed.data.map((row) => ({ id: row.id, tableNumber: row.table_number, qrToken: row.qr_token, isActive: row.is_active }));
  }

  async rotateQr(tableId: string): Promise<string> {
    const { data, error } = await this.client.rpc("rotate_festival_table_qr", { p_table_id: tableId });
    if (error || typeof data !== "string") throw conflict("QR을 재발급하지 못했습니다.");
    return data;
  }
}
