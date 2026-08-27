# 컴공 52 — 축제 QR 주문 시스템

테이블 QR 주문과 포장 주문을 하나의 주문 모델로 처리하는 축제 운영 웹앱입니다. 고객은 메뉴 선택, 계좌이체 확인 요청, 주문 상태 확인을 할 수 있고 운영자는 입금·조리·전달 상태, 매출, 재고, 테이블 QR, 매장 설정을 관리합니다.

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

1. Supabase 프로젝트에 `supabase/migrations`의 SQL을 파일명 순서대로 적용합니다.
2. 필요하면 `supabase/seed.sql`로 예시 테이블과 메뉴를 추가합니다.
3. `.env.example`을 참고해 프로젝트 URL과 publishable key를 설정합니다.
4. `FESTIVAL_DEMO_MODE=false`로 변경합니다.
5. 새 운영팀을 처음 만들 때만 `FESTIVAL_ALLOW_SIGNUP=true`로 잠시 설정해 `/admin`에서 운영자를 등록합니다. 등록 직후 반드시 다시 `false`로 잠급니다. 운영 배포의 기본값은 `false`입니다.
6. `FESTIVAL_PUBLIC_ORIGIN`에는 실제 배포 주소를 넣습니다. 이 값만 인증 리디렉션과 공유 미리보기 주소로 신뢰합니다.
7. 관리자 화면의 **매장 설정**에서 실제 입금 계좌를 입력하고 주문 접수를 켭니다.

publishable key는 RLS와 함수 권한으로 보호되는 공개 클라이언트용 키입니다. secret/service-role key는 이 앱에 저장하지 않습니다.

## 데이터 무결성

- 주문 생성, 주문 항목 스냅샷, 재고 차감, 결제 행 생성을 하나의 PostgreSQL 함수에서 처리합니다.
- `client_request_id` 고유 제약으로 새로고침·재시도에 따른 중복 주문을 막습니다.
- 고객이 보내는 가격은 사용하지 않고 DB의 현재 메뉴 가격으로 계산합니다.
- 고객의 입금 표시는 `CUSTOMER_MARKED_TRANSFERRED`까지만 변경합니다.
- 관리자의 입금 확인이 결제 `CONFIRMED`와 주문 `PAID`를 함께 변경합니다.
- 취소 시 재고를 복구하고 조정 사유 및 상태 변경을 감사 기록에 남깁니다.
- 매장 계좌가 설정되지 않았거나 주문 접수가 꺼져 있으면 UI와 DB 함수에서 모두 주문을 차단합니다.
- 관리자 쓰기는 서비스 계층과 권한 검사 RPC를 통하며, 공개 역할에는 필요한 함수 실행 권한만 부여합니다.
- 여러 메뉴의 재고는 메뉴 ID 순서로 잠가 동시 주문의 교착 가능성을 낮춥니다.
- 모든 고객용 RPC는 Sites 서버의 짧은 HMAC 서명을 요구하므로 publishable key만으로 직접 호출할 수 없습니다.
- 주문·결제·재고·감사·테이블 관계는 `(team_id, id)` 복합 외래키로 교차 운영팀 연결을 DB에서 거부합니다.
- 운영자 RPC는 JWT의 `session_id`가 실제 `auth.sessions`에 남아 있는지 확인해 로그아웃된 토큰을 즉시 차단합니다.
- 주문·QR·관리자/API 응답은 캐시와 검색 색인을 금지하고, API 본문은 JSON 64KB로 제한합니다.
- 포장 주문의 이름·휴대폰은 서버 서명에 포함하고 같은 운영팀 관리자에게만 표시합니다. 수령 완료 또는 취소 시 DB 트리거가 두 값을 자동 삭제합니다.

## 축제 전 보안 확인

- Sites 운영 변수에서 `FESTIVAL_DEMO_MODE=false`, `FESTIVAL_ALLOW_SIGNUP=false`인지 확인합니다.
- Supabase Auth에서 이메일 확인, CAPTCHA, 유출 비밀번호 차단과 운영자 MFA를 활성화합니다.
- 운영자마다 계정을 따로 사용하고 공유 비밀번호를 금지합니다. 분실 기기는 즉시 로그아웃하고 비밀번호를 변경합니다.
- 테이블 QR이 훼손·촬영·공유되면 관리자 화면에서 해당 테이블 QR만 재발급합니다. 기존 주문 기록은 유지됩니다.
- 실제 휴대전화 2대로 같은 테이블의 동시 주문, 포장 연락처·전화 연결, 중복 제출, 입금 표시, 취소 재고 복구, 세션 만료를 최종 리허설합니다.

## 코드 구조

- `domain`: 주문·메뉴·매장 규칙과 타입
- `application`: 유스케이스와 게이트웨이 계약
- `infrastructure`: Supabase/Auth 구현
- `presentation`: 요청 검증, 컨트롤러, HTTP 응답
- `app/api`: 컨트롤러를 노출하는 얇은 라우트

## 검증

```bash
npm run typecheck
npm run lint
npm test
```

운영 전 실제 Supabase 프로젝트에서 테이블 QR, 중복 요청, 재고 경합, 관리자 권한, 전체 주문 상태 흐름을 한 번 더 점검하세요.
