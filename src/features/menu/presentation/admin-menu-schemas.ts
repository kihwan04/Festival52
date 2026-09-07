import { z } from "zod";

const menuOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(40),
  priceDelta: z.number().int().min(0).max(1_000_000),
});

const menuOptionsSchema = z.array(menuOptionSchema).max(12).refine(
  (options) => new Set(options.map((option) => option.id)).size === options.length,
  "같은 옵션이 중복되어 있습니다.",
);

export const menuCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  price: z.number().int().min(0).max(10_000_000),
  category: z.string().trim().min(1).max(30),
  status: z.enum(["AVAILABLE", "SOLD_OUT", "HIDDEN"]).default("AVAILABLE"),
  stockQuantity: z.number().int().min(0).max(100_000),
  options: menuOptionsSchema.default([]),
});

export const menuAdjustmentSchema = z.object({
  quantityChange: z.number().int().min(-1000).max(1000).refine((value) => value !== 0),
  reason: z.string().trim().min(2).max(240),
});

export const menuEditSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  price: z.number().int().min(0).max(10_000_000).optional(),
  category: z.string().trim().min(1).max(30).optional(),
  status: z.enum(["AVAILABLE", "SOLD_OUT", "HIDDEN", "ARCHIVED"]).optional(),
  options: menuOptionsSchema.optional(),
}).refine((value) => Object.keys(value).length > 0);

export const categoryNameSchema = z.string().trim().min(1).max(30);
export const categoryCreateSchema = z.object({ name: categoryNameSchema });
export const categoryRenameSchema = z.object({ previousName: categoryNameSchema, nextName: categoryNameSchema });
