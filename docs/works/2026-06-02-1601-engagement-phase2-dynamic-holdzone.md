# 2026-06-02 — Engagement Phase 2: 동적 hold zone (B-1)

브랜치: `refactor/dead-code-cleanup`.
계획: [`../plans/2026-06-02-1518-engagement-and-dynamic-zone.md`](../plans/2026-06-02-1518-engagement-and-dynamic-zone.md) (Phase 2 / B-1).

## 목적

조작 중(head-tilt operating)에는 시선이 결과를 보러 떠나도 rail lock 이 풀리지 않도록
hold(lock) zone 을 동적으로 확장. 시선 jitter/이탈에도 railCursor·snap 시각이 안정.

## 변경

- `intent-score.ts` `SnapConfig`: `lockZoneFracActive`(0.55) + `holdZoneDecayMs`(400) 추가.
- `edge-detector.ts`:
  - 동적 `holdFrac` 필드 — operating 시 target(0.55)로 **즉시 확장**, idle 시 base(0.24)로
    `holdZoneDecayMs` 시상수로 **부드럽게 수축**.
  - `update(point, viewport, now, operating=false)` — operating hint 수신.
  - rail_locked hold 판정(`inLockZone`)이 정적 lockZoneFrac → 동적 `holdFrac` 사용.
  - `snapshot().lockZoneFrac` 를 동적 holdFrac 로 노출 → EdgeZones/HUD 가 확장/수축 시각화.
- `App.tsx`: `operatingRef`(= 얼굴 검출 + |head roll| > UPRIGHT_MAX_DEG) 단일 신호를
  edge-detector update hint(effect #6/#7) 와 engagement 이탈 판정(§8b) 양쪽에서 공유.
  (기존 headRollRef/headDetectedRef 통합 제거.)
- `DebugHud`: `hold zone` 행(현재 동적 frac %) 추가.

## 검증

- `npm run typecheck` (node+web) 통과, `npm run build` 통과.
- HUD: 조작(머리 기울임) 시작 → `hold zone` 24%→55% 즉시 확장, 머리 세우면 ~400ms 로 수축 확인 예정(실측).

## 후속

- Phase 3(선택): enter zone 정확도(B-2)/속도(B-3) 적응 + FTR 검증.
- 파라미터 실측 튜닝: `lockZoneFracActive`, `holdZoneDecayMs`, `UPRIGHT_MAX_DEG`.
