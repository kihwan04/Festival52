import type { FestivalTable } from "@/src/shared/demo-data";

export interface TableGateway {
  configure(count: number): Promise<FestivalTable[]>;
  rotateQr(tableId: string): Promise<string>;
}

export const configureTables = (gateway: TableGateway, count: number) => gateway.configure(count);
export const rotateTableQr = (gateway: TableGateway, tableId: string) => gateway.rotateQr(tableId);
