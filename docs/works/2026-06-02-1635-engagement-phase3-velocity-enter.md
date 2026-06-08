# 2026-06-02 — Engagement Phase 3 (B-3): enter zone 속도 적응

브랜치: `refactor/dead-code-cleanup`.
계획: [`../plans/2026-06-02-1518-engagement-and-dynamic-zone.md`](../plans/2026-06-02-1518-engagement-and-dynamic-zone.md) (Phase 3 / B-3).

## 목적

Phase 2 가 exit(hold) 범위를 동적화했으니, Phase 3 은 **enter(acquire) 범위**를 동적화.
교수님 "들어갈 때/나올 때 범위 모두 동적" 의 나머지 절반. 방식은 B-3(속도 적응) — 이미
계산되는 approach/lateral velocity 사용(새 추정기 불필요, 낮은 위험).

## 변경

- `intent-score.ts`:
  - `SnapConfig`: `enterFracMin`(0.12), `enterFracMax`(0.26), `enterApproachRefPxs`(600),
    `enterLateralRefPxs`(500) 추가.
  - `IntentTracker.dynamicEnterFrac(approachV, lateralV)`: base(0.18)에서 approach 빠르면
    enterFracMax 로 확장, lateral 빠르면 enterFracMin 로 수축.
  - update() 재구성: 속도 먼저 계산 → 동적 enterFrac 으로 primary in-zone 판정 + closeness 계산.
  - `IntentSample.enterFrac` 노출.
- `edge-detector.ts`: snapshot.intentZoneFrac 를 lastIntentSample.enterFrac(동적)으로 노출.
- `DebugHud`: `enter zone` 행 추가(동적 frac %). EdgeZones 는 자동 시각화.

## 의미

- 가장자리로 **곧장 접근**(approach↑, lateral↓) → enter zone 확장 → 더 빨리/멀리서 trigger.
- 가로로 **훑어보는 중**(lateral↑) → enter zone 수축 → 스캔 중 false trigger 감소.

## 검증

- `npm run typecheck` (node+web) 통과, `npm run build` 통과.
- ⚠️ enter 변경 → **FTR(오발동률) 검증 필요**. `⌘⇧E` trigger eval(특히 free-30s FTR) 로 확인.
- HUD `enter zone` 행에서 접근/스캔에 따라 12~26% 로 변하는지 확인.

## 후속

- (보류) B-2 정확도/노이즈 적응 — gaze 분산 추정기 구현 시.
- 파라미터 실측 튜닝: enterFracMin/Max, enterApproachRefPxs, enterLateralRefPxs.
- 브랜치 `refactor/dead-code-cleanup` → `main` 병합(PR) 시점 검토.
