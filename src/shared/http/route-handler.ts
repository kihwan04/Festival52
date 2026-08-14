import { NextResponse } from "next/server";
import type { z } from "zod";
import { asAppError, invalidInput } from "@/src/shared/errors/app-error";

export interface ControllerResult<T> {
  body: T;
  status?: number;
  cookies?: Array<{ name: string; value: string; options: Parameters<NextResponse["cookies"]["set"]>[2] }>;
}

export async function parseJson<TSchema extends z.ZodTypeAny>(request: Request, schema: TSchema, message: string): Promise<z.output<TSchema>> {
  const payload: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw invalidInput(message);
  return parsed.data;
}

export async function handleController<T>(action: () => Promise<ControllerResult<T>>): Promise<NextResponse> {
  try {
    const result = await action();
    const response = NextResponse.json(result.body, { status: result.status ?? 200 });
    for (const cookie of result.cookies ?? []) response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error) {
    const appError = asAppError(error);
    return NextResponse.json({ code: appError.code, message: appError.message }, { status: appError.status });
  }
}
