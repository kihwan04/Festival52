-- SECURITY DEFINER RPCs bypass this policy only after their own signature or
-- live operator-session checks. Data API roles can never access rows directly.
create policy "push subscriptions are RPC only"
on public.order_push_subscriptions
for all
to anon, authenticated
using (false)
with check (false);
