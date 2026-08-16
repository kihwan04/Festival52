-- The signed application version is live, so the zero-downtime compatibility
-- entry point can no longer bypass request signing and durable rate limits.
revoke all on function public.create_festival_order(text, text, uuid, jsonb)
  from public, anon, authenticated;
drop function public.create_festival_order(text, text, uuid, jsonb);

-- Customer-side calls always use the anonymous publishable key. Keeping the
-- authenticated role out of these entry points narrows the callable surface.
revoke execute on function public.create_festival_order(text, text, uuid, jsonb, text, bigint, text)
  from authenticated;
revoke execute on function public.authorize_festival_login_attempt(text, bigint, text)
  from authenticated;
