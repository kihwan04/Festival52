import { serviceUnavailable } from "@/src/shared/errors/app-error";

export interface SignedRequestProof {
  rateKeyHash: string;
  requestTimestamp: number;
  signature: string;
}

interface OrderSignatureInput {
  teamSlug: string;
  qrToken: string | null;
  fulfillmentType: "DINE_IN" | "TAKEOUT";
  clientRequestId: string;
}

const encoder = new TextEncoder();

export async function signOrderRequest(request: Request, input: OrderSignatureInput): Promise<SignedRequestProof> {
  const secret = signingSecret();
  const channel = input.fulfillmentType === "DINE_IN" ? input.qrToken ?? "INVALID_TABLE" : input.teamSlug;
  const rateKeyHash = await hmacHex(secret, `order-rate-v1|${trustedClientAddress(request)}|${channel}`);
  const requestTimestamp = Math.floor(Date.now() / 1000);
  const message = `order-v2|${requestTimestamp}|${input.clientRequestId}|${input.teamSlug}|${input.fulfillmentType}|${input.qrToken ?? ""}|${rateKeyHash}`;
  return { rateKeyHash, requestTimestamp, signature: await hmacHex(secret, message) };
}

export async function signLoginAttempt(request: Request): Promise<SignedRequestProof> {
  const secret = signingSecret();
  const rateKeyHash = await hmacHex(secret, `login-rate-v1|${trustedClientAddress(request)}`);
  const requestTimestamp = Math.floor(Date.now() / 1000);
  const message = `login-v1|${requestTimestamp}|${rateKeyHash}`;
  return { rateKeyHash, requestTimestamp, signature: await hmacHex(secret, message) };
}

export async function signSignupAttempt(request: Request): Promise<SignedRequestProof> {
  const secret = signingSecret();
  const rateKeyHash = await hmacHex(secret, `signup-rate-v1|${trustedClientAddress(request)}`);
  const requestTimestamp = Math.floor(Date.now() / 1000);
  const message = `signup-v1|${requestTimestamp}|${rateKeyHash}`;
  return { rateKeyHash, requestTimestamp, signature: await hmacHex(secret, message) };
}

export async function signSignupProvision(input: {
  departmentName: string;
  teamName: string;
  displayName: string;
  email: string;
}): Promise<SignedRequestProof> {
  const secret = signingSecret();
  const requestTimestamp = Math.floor(Date.now() / 1000);
  const message = `signup-user-v1|${requestTimestamp}|${input.email.toLowerCase()}|${input.departmentName}|${input.teamName}|${input.displayName}`;
  return { rateKeyHash: "", requestTimestamp, signature: await hmacHex(secret, message) };
}

export async function signTableResolution(qrToken: string): Promise<SignedRequestProof> {
  return signPublicMessage(`resolve-table-v1|{timestamp}|${qrToken}`);
}

export async function signPublicMenuRequest(teamSlug?: string): Promise<SignedRequestProof> {
  return teamSlug
    ? signPublicMessage(`public-menu-v1|{timestamp}|${teamSlug}`)
    : signPublicMessage("public-menu-legacy-v1|{timestamp}");
}

export async function signPublicSettingsRequest(teamSlug?: string): Promise<SignedRequestProof> {
  return teamSlug
    ? signPublicMessage(`public-settings-v1|{timestamp}|${teamSlug}`)
    : signPublicMessage("public-settings-legacy-v1|{timestamp}");
}

export async function signLegacyTeamRequest(): Promise<SignedRequestProof> {
  return signPublicMessage("legacy-team-v1|{timestamp}");
}

export async function signPublicOrderRequest(request: Request, publicToken: string): Promise<SignedRequestProof> {
  const secret = signingSecret();
  const rateKeyHash = await hmacHex(secret, `public-order-rate-v1|${trustedClientAddress(request)}|${publicToken}`);
  const requestTimestamp = Math.floor(Date.now() / 1000);
  const message = `public-order-v1|${requestTimestamp}|${publicToken}|${rateKeyHash}`;
  return { rateKeyHash, requestTimestamp, signature: await hmacHex(secret, message) };
}

export async function signTransferClaim(request: Request, publicToken: string): Promise<SignedRequestProof> {
  const secret = signingSecret();
  const rateKeyHash = await hmacHex(secret, `transfer-rate-v1|${trustedClientAddress(request)}|${publicToken}`);
  const requestTimestamp = Math.floor(Date.now() / 1000);
  const message = `transfer-v1|${requestTimestamp}|${publicToken}|${rateKeyHash}`;
  return { rateKeyHash, requestTimestamp, signature: await hmacHex(secret, message) };
}

function signingSecret(): string {
  const secret = process.env.FESTIVAL_REQUEST_SIGNING_SECRET?.trim();
  if (!secret || secret.length < 32) throw serviceUnavailable("요청 보안 설정을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.");
  return secret;
}

function trustedClientAddress(request: Request): string {
  const cloudflareAddress = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareAddress) return cloudflareAddress.slice(0, 80);
  if (process.env.NODE_ENV === "production") return "unavailable-client-address";
  const forwardedAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedAddress) return forwardedAddress.slice(0, 80);
  const realAddress = request.headers.get("x-real-ip")?.trim();
  return (realAddress || "unknown-client").slice(0, 80);
}

async function signPublicMessage(template: string): Promise<SignedRequestProof> {
  const secret = signingSecret();
  const requestTimestamp = Math.floor(Date.now() / 1000);
  const message = template.replace("{timestamp}", String(requestTimestamp));
  return { rateKeyHash: "", requestTimestamp, signature: await hmacHex(secret, message) };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
