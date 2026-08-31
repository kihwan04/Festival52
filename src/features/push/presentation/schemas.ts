import { z } from "zod";
import { normalizeAllowedPushEndpoint } from "@/src/features/push/domain/push-subscription";

const endpointSchema = z.string().min(40).max(2048)
  .refine((value) => normalizeAllowedPushEndpoint(value) !== null, "허용되지 않은 푸시 서버입니다.")
  .transform((value) => normalizeAllowedPushEndpoint(value) as string);

export const pushSubscriptionSchema = z.object({
  endpoint: endpointSchema,
  expirationTime: z.number().finite().nonnegative().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(80).max(160).regex(/^[A-Za-z0-9_-]+$/),
    auth: z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/),
  }),
});
