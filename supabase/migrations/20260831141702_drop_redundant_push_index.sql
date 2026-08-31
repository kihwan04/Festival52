-- The unique (team_id, order_id, endpoint_hash) index already serves every
-- lookup by its (team_id, order_id) prefix.
drop index if exists public.order_push_subscriptions_team_order_idx;
