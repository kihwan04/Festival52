import { NextResponse } from "next/server";
import type { z } from "zod";
import { asAppError, invalidInput } from "@/src/shared/errors/app-error";

export interface ControllerResult<T> {
  body: T;
  status?: number;
  cookies?: Array<{ name: string; value: string; options: Parameters<NextResponse["cookies"]["set"]>[2] }>;
}

const MAX_JSON_BODY_BYTES = 64 * 1024;

export async function parseJson<TSchema extends z.ZodTypeAny>(request: Request, schema: TSchema, message: string): Promise<z.output<TSchema>> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") throw invalidInput(message);
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) throw invalidInput("요청 내용이 너무 큽니다.");
  const payload: unknown = await readBoundedJson(request, MAX_JSON_BODY_BYTES).catch(() => null);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw invalidInput(message);
  return parsed.data;
}

export async function handleController<T>(action: () => Promise<ControllerResult<T>>): Promise<NextResponse> {
  try {
    const result = await action();
    const response = NextResponse.json(result.body, { status: result.status ?? 200 });
    for (const cookie of result.cookies ?? []) response.cookies.set(cookie.name, cookie.value, cookie.options);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
    return response;
  } catch (error) {
    const appError = asAppError(error);
    const response = NextResponse.json({ code: appError.code, message: appError.message }, { status: appError.status });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
    if (appError.status === 429) response.headers.set("Retry-After", "60");
    return response;
  }
}

async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.body) throw new Error("missing body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let json = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("body too large");
      json += decoder.decode(value, { stream: true });
    }
    json += decoder.decode();
    return JSON.parse(json) as unknown;
  } finally {
    reader.releaseLock();
  }
}
