insert into public.festival_tables(id, table_number, qr_token, is_active) values
  ('00000000-0000-4000-8000-000000000007', 7, 'demo-table-7-qr-6e8e8048291f', true)
on conflict (id) do update set table_number = excluded.table_number, qr_token = excluded.qr_token, is_active = true;

insert into public.menu_items(id, name, description, price, category, status, stock_quantity, sort_order) values
  ('11111111-1111-4111-8111-111111111111', '화끈 제육볶음', '불향 가득 매콤한 제육과 아삭한 양파', 12000, '안주', 'AVAILABLE', 13, 10),
  ('22222222-2222-4222-8222-222222222222', '바삭 닭강정', '달콤매콤 소스와 땅콩을 올린 한입 닭강정', 10000, '안주', 'AVAILABLE', 8, 20),
  ('33333333-3333-4333-8333-333333333333', '치즈 떡볶이', '쫄깃한 밀떡 위에 고소한 치즈 듬뿍', 8000, '식사', 'AVAILABLE', 5, 30),
  ('44444444-4444-4444-8444-444444444444', '잔치 국수', '진한 멸치 육수와 푸짐한 고명', 6000, '식사', 'AVAILABLE', 17, 40),
  ('55555555-5555-4555-8555-555555555555', '회오리 감자', '바삭하게 튀겨낸 축제 대표 간식', 4500, '간식', 'SOLD_OUT', 0, 50),
  ('66666666-6666-4666-8666-666666666666', '청포도 에이드', '상큼한 청포도와 톡 쏘는 탄산', 4000, '음료', 'AVAILABLE', 21, 60)
on conflict (id) do update set name = excluded.name, description = excluded.description, price = excluded.price,
  category = excluded.category, status = excluded.status, stock_quantity = excluded.stock_quantity, sort_order = excluded.sort_order;

insert into public.menu_categories(name, sort_order) values
  ('안주', 1), ('식사', 2), ('간식', 3), ('음료', 4)
on conflict (name) do update set sort_order = excluded.sort_order;
