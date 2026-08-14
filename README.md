# 컴공 52 — 축제 QR 주문 시스템

테이블 QR 주문과 포장 주문을 하나의 주문 모델로 처리하는 축제 운영 웹앱입니다. 고객은 메뉴 선택, 계좌이체 확인 요청, 주문 상태 확인을 할 수 있고 운영자는 입금·조리·전달 상태와 재고를 관리합니다.

## 주요 화면

- `/t/{qrToken}`: 활성 테이블 QR 고객 주문
- `/booth`: 테이블 없이 이용하는 포장 주문
- `/order/{publicToken}`: 최소 정보만 노출하는 고객 주문 현황
- `/admin`: Supabase Auth와 `profiles.role`로 보호되는 운영 대시보드

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

`.env.local`의 `FESTIVAL_DEMO_MODE=true`에서는 실제 계정이나 DB 없이 화면과 상태 전환을 확인할 수 있습니다. 이 모드는 운영 환경에서 사용하면 안 됩니다.

## Supabase 연결

1. Supabase 프로젝트에서 `supabase/migrations/202608140001_festival_qr.sql`을 적용합니다.
2. 필요하면 `supabase/seed.sql`로 예시 테이블과 메뉴를 추가합니다.
3. `.env.example`을 참고해 URL, anon key, 서버 전용 service-role key를 설정합니다.
4. `FESTIVAL_DEMO_MODE=false`로 변경합니다.
5. Supabase Auth에 운영자 계정을 만들고 같은 사용자 ID를 `profiles`에 `ADMIN` 또는 `STAFF` 역할로 등록합니다.

service-role key는 서버 Route Handler에서만 사용합니다. 브라우저 번들, Git, 공개 로그에 넣지 마세요.

## 데이터 무결성

- 주문 생성, 주문 항목 스냅샷, 재고 차감, 결제 행 생성을 하나의 PostgreSQL 함수에서 처리합니다.
- `client_request_id` 고유 제약으로 새로고침·재시도에 따른 중복 주문을 막습니다.
- 고객이 보내는 가격은 사용하지 않고 DB의 현재 메뉴 가격으로 계산합니다.
- 고객의 입금 표시는 `CUSTOMER_MARKED_TRANSFERRED`까지만 변경합니다.
- 관리자의 입금 확인이 결제 `CONFIRMED`와 주문 `PAID`를 함께 변경합니다.
- 취소 시 재고를 복구하고 조정 사유 및 상태 변경을 감사 기록에 남깁니다.

## 검증

```bash
npm run typecheck
npm run lint
npm test
```

운영 전 실제 Supabase 프로젝트에서 테이블 QR, 중복 요청, 재고 경합, 관리자 권한, 전체 주문 상태 흐름을 한 번 더 점검하세요.
