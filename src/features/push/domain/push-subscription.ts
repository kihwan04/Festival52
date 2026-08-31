export interface OrderPushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface OrderPushDeliveryTarget extends OrderPushSubscriptionInput {
  subscriptionId: string;
  publicToken: string;
  orderNumber: string;
  fulfillmentType: "DINE_IN" | "TAKEOUT";
  stallName: string;
}

export interface PushDeliverySummary {
  attempted: number;
  delivered: number;
  failed: number;
  unavailable?: boolean;
}

export function normalizeAllowedPushEndpoint(value: string): string | null {
  if (value.length < 40 || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const allowed = hostname === "fcm.googleapis.com"
      || isServiceSubdomain(hostname, "push.services.mozilla.com")
      || isServiceSubdomain(hostname, "push.apple.com")
      || isServiceSubdomain(hostname, "notify.windows.com");
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || url.pathname === "/" || !allowed) return null;
    return url.href;
  } catch {
    return null;
  }
}

function isServiceSubdomain(hostname: string, suffix: string): boolean {
  const prefix = hostname.slice(0, -(suffix.length + 1));
  return hostname.endsWith(`.${suffix}`) && /^[a-z0-9-]+$/.test(prefix);
}
