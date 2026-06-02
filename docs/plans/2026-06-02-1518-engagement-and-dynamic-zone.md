# Engagement(조작 유지/이탈) 재설계 + 동적 enter/exit Zone

> **Status**: Phase 1 + Phase 2 구현 완료 (2026-06-02). Phase 3 대기(선택).
> 결정: active 중 hold=유한 확장 · idle grace=1200ms · upright 기준 통일(6°).
> **관련 코드**: `App.tsx`(latch/engagement), `perception/edge-detector.ts`(rail lock),
> `perception/intent-score.ts`(zone/score), `perception/slider-mapper.ts`(tilt active).
> 권위 있는 현재 상태: [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

---

## 1. 문제 정의

현재 컨트롤 조작은 **고정 3초(`LATCH_MS = 3000`) 타임아웃**으로 유지된다. dwell 로 항목을
select 하면 3초 동안만 head-tilt 로 조절 가능하고, 3초가 지나면 자동으로 해제된다.

- 원래 의도: "유저가 시선을 항목에 고정하지 않아도 편하게 조작" — 즉 조작 중 시선이 자유롭게
  움직여도 되도록 gaze 와 조작을 분리하려는 것.
- 실제 결과: **조작 도중 3초가 지나면 끊긴다.** 사용자가 천천히/신중히 조절하거나, 조작
  결과(밝기·볼륨 변화)를 보는 동안 시간이 가면 의도와 무관하게 해제 → 오히려 불편.

→ **시간이 아니라 "사용자가 실제로 조작에서 이탈했는가"를 판단**하는 로직이 필요하다.

추가로, 교수님이 제안하신 **동적 enter/exit zone**(조작으로 인식되는 gaze 영역의 진입/이탈
범위를 상황에 따라 동적으로 조정)을 함께 적용한다. 이 둘은 사실 같은 문제의 두 측면이다.

## 2. 현재 구조 분석

조작 "유지"에는 **분리된 두 개의 메커니즘**이 겹쳐 있다.

### (1) Rail Lock — gaze 기반, edge-detector
- `intent-score.ts`: gaze 가 `intentZoneFrac`(0.18) 안에 있을 때 변별 intent score 누적,
  `intentThreshold`(150) 도달 시 lock.
- `edge-detector.ts` `inLockZone`: lock 유지는 `lockZoneFrac`(0.24, 더 넓음) 기준 →
  **공간 hysteresis**(enter 좁게/exit 넓게)가 이미 존재. lock zone 이탈 후 `exitGraceMs`(250ms)
  지나면 `exit` 이벤트 → rail 해제.
- 즉 "gaze 가 가장자리에서 충분히 멀어지면" rail 이 풀린다.

### (2) Control Latch — 시간 기반, App.tsx
- dwell-to-select(`SELECT_DWELL_MS` 1초)로 `selectedControlId` commit.
- 동시에 `LATCH_MS`(3초) 타이머 시작. 3초 뒤 `selectedControlId = null`.
- `engaged = selectedControlId != null && head.detected` → engaged 동안만 head-tilt 반영.
- rail 이 풀려도(시선이 중앙으로 와도) latch 동안 `gazeBarEdge` 를 유지해 GazeBar 를 띄워둔다.

**문제의 핵심**: (2)가 (1)을 시간으로 덮어쓰는 구조. gaze 가 떠나도 조작 가능하게 하려고
시간 latch 를 얹었는데, 시간이라는 축이 "이탈 판단"으로는 부적절하다.

### 관련 신호(이미 계산되어 있음)
- head tilt 활성: `slider-mapper.ts` `SliderIntentMapper.update()` 가 `active`(데드존 밖 +
  둘러봄 아님), `rate` 를 이미 반환 → "지금 조작 중인가" 신호로 바로 쓸 수 있다.
- gaze 속도: `intent-score.ts` 가 `approachVelocity`/`lateralVelocity` 계산.
- gaze 위치/zone 여부: `perpendicularDistance` / `vpDim`.

## 3. 설계 목표

1. **시간 컷오프 제거** — 조작 중에는 무한히 유지.
2. **이탈을 의도 신호로 판단** — "조작도 안 하고(head neutral) 시선도 떠났을 때"만 해제.
3. **gaze 비고정 유지** — 조작 중 시선이 자유롭게 움직여도 끊기지 않음(원래 의도 보존).
4. **Midas touch 방지** — 진입(acquire)은 여전히 보수적으로.
5. (교수님 아이디어) **enter/exit 범위를 상황에 따라 동적으로** — 신호 품질/조작 상태에 적응.

## 4. 제안 A — 이탈 판단 로직 (LATCH_MS 대체)

시간 타이머를 **"활동 기반 idle 해제"** 로 교체한다.

### 유지(engaged) 조건 — 다음 중 하나라도 참이면 계속 engaged
- gaze 가 lock(hold) zone 안에 있음 (rail 사실상 유지), **또는**
- head-tilt 가 **active** (|tilt − neutral| > deadzone; `SliderUpdate.active`), **또는**
- 위 둘이 마지막으로 참이었던 시점부터 **idle grace**(`idleReleaseMs`, 제안 1200ms) 이내.

### 해제(disengage) 조건
- 위 어느 것도 아닌 상태가 `idleReleaseMs` 동안 연속 지속 → `selectedControlId = null`,
  마지막 값 commit.
- 활동(tilt)이나 gaze 재진입이 생기면 idle 카운트다운 리셋.

### 효과 (현재 문제 대비)
| 시나리오 | 현재(3초 latch) | 제안 A |
| --- | --- | --- |
| 조작을 천천히 5초 | 3초에 끊김 ✗ | tilt active 동안 계속 ✓ |
| 조작 끝, 결과 응시(시선은 바 근처) | 3초에 끊김 ✗ | hold zone 안이면 유지 ✓ |
| 조작 끝, 시선 중앙으로 복귀 | 3초 대기 | ~1.2초 후 해제 ✓ |
| 잠깐 다른 곳 보고 다시 조작 | 타이머 흐름 | 활동 감지 시 즉시 유지 ✓ |

### 구현 메모
- engaged 평가를 head-sample effect 안에서 매 프레임 수행 + `selectedControlId != null` 동안
  돌아가는 작은 타이머(또는 RAF)로 idle 카운트다운(샘플이 안 와도 해제 보장).
- 얼굴 일시 손실(`head.detected=false`): 조작은 일시정지하되 즉시 해제하지 않음. idle grace 가
  흐르고, 얼굴 복귀 + 활동 시 재개. (현재는 `engaged=false` 로 단순 정지)
- `LATCH_MS`, `latchTimerRef` 제거. dwell-select 는 그대로(진입 트리거로만).

## 5. 제안 B — 동적 enter/exit Zone (교수님 아이디어)

현재 zone 은 정적(`intentZoneFrac` 0.18 / `lockZoneFrac` 0.24). 이를 **상황 적응형**으로.

핵심 원칙: **acquire(enter)는 보수적으로 유지, hold(exit)는 상황에 따라 넓힌다.**

### B-1. 상태/활동 의존 (권장, 제안 A 와 직결)
- `enterZoneFrac`: 정적(0.18). 진입은 까다롭게 → Midas touch 방지.
- `holdZoneFrac`: **동적**.
  - lock 후 **active(조작 중)** 이면 크게 확장 (예: 0.24 → 0.6, 혹은 사실상 gaze-exit 무시).
    조작 중에는 시선이 결과를 보러 떠나도 lock 유지.
  - active 가 아니면 base(0.24)로 부드럽게 수축(시상수 ~400ms, 급변 방지).
- 결과: 제안 A 의 "active 중 유지"를 **공간(zone) 차원**에서도 자연스럽게 표현 →
  두 메커니즘이 하나로 수렴.

### B-2. 신호 품질(정확도) 적응 (선택, 보고서용으로 가치 큼)
- 최근 ~500ms gaze 분산 σ(표준편차) 추정(OneEuro 전/후 좌표로).
- σ 가 크면(노이즈 큰 사용자/환경) enter·hold zone 을 비례 확대 → 같은 의도라도 트리거 가능.
- 단 enter 확대는 **상한 cap** 으로 Midas touch 방어. hold 는 더 관대해도 안전.
- "동적 범위"의 가장 원리적인 해석. §4.5 Boundary Conditions 정량화에 직접 기여.

### B-3. 속도 적응 enter (선택)
- 접근 속도 높고 lateral 낮음(=의도적 접근) → enter zone 확대.
- lateral 높음(=가로로 훑어보는 중) → enter zone 축소 → 스캔 중 false trigger 감소.
- IntentTracker 가 이미 두 속도를 계산하므로 score 가 아니라 **경계 자체**를 움직이는 확장.

> 권장 적용 순서: **B-1 먼저**(문제 해결 직결) → 여유 시 **B-2**(연구/보고서) → **B-3**(튜닝).

## 6. 통합 모델 (A + B-1)

조작 유지를 **하나의 engagement 판단**으로 통합한다.

```
acquire:  intent score ≥ threshold  (enterZoneFrac, 정적/보수적)   ── B-3 로 enter 동적화 가능
hold:     gaze ∈ holdZone(dynamic)  OR  tilt active  OR  idle-grace 이내
release:  위 모두 거짓이 idleReleaseMs 동안 지속 → 해제 + commit
          holdZone = base + (active ? activeBonus : 0), 부드럽게 decay      ── B-1
```

- `selectedControlId` 수명을 이 engagement 에 묶는다 (시간 latch 제거).
- 구현 위치 선택지:
  - (a) `edge-detector.ts` `update(point, vp, now, hint)` 에 `hint.active`(head-tilt) 전달 →
    detector 가 dynamic holdZone + hold 판정까지 담당. App 은 hint 만 넘김. **권장**(상태 일원화).
  - (b) detector 는 gaze 만, engagement 판정은 App/별도 `EngagementController` 로 분리.
  - 트레이드오프는 §9 결정사항 참고.

## 7. 파라미터 (제안 초기값, 실측 튜닝 전제)

| 이름 | 값 | 의미 |
| --- | --- | --- |
| `idleReleaseMs` | 1200 | 비활동+시선이탈 지속 시 해제까지 (LATCH_MS 의미 대체) |
| `activeTiltDeg` | = `neutralDeadzoneDeg`(3°) | 이 이상 기울이면 active 로 간주 |
| `holdZoneFracBase` | 0.24 | idle-locked 시 hold zone (현행 유지) |
| `holdZoneFracActive` | 0.55–0.6 | active 중 확장된 hold zone (또는 ∞=gaze 무시) |
| `holdZoneDecayMs` | ~400 | active→idle 시 hold zone 수축 시상수 |
| `enterZoneFrac` | 0.18 | acquire zone (정적; B-3 적용 시 0.14–0.22 가변) |
| (B-2) `gazeSigmaWindowMs` | 500 | 분산 추정 창 |
| (B-2) `sigmaToFrac` k, cap | TBD | σ→zone 확대 계수/상한 |

## 8. 코드 변경 지점

- `App.tsx`
  - `LATCH_MS`, `latchTimerRef`, dwell-commit 의 setTimeout 제거.
  - engagement hold/idle 평가 추가(head-sample effect + idle 타이머/RAF).
  - `SliderIntentMapper.update` 의 `active` 를 hold 신호로 사용(이미 반환됨).
  - detector 에 활동 hint 전달(통합 모델 (a) 채택 시).
- `perception/edge-detector.ts`
  - `update(..., hint?)` 시그니처 + dynamic `holdZoneFrac` 계산(`inLockZone` 에 동적 frac).
  - hold 조건에 active/idle-grace 반영(또는 App 으로 위임).
  - `EdgeSnapshot` 에 현재 `holdZoneFrac`(동적), `holdReason`('zone'|'active'|'grace') 노출.
- `perception/intent-score.ts`
  - (B-2/B-3) 분산 추정 / 속도 기반 enter frac 동적화.
- `slider-mapper.ts` — 변경 없음(이미 `active` 제공). 필요 시 `active` 임계 노출.

## 9. 디버그 / 검증

- **DebugHud** 추가 행: engagement 상태(`hold reason`), 현재 동적 `holdZoneFrac`,
  idle 카운트다운(ms), (B-2 적용 시) gaze σ.
- **EdgeZones**: hold zone 을 동적 값으로 그려 확장/수축을 시각화.
- **Evaluation(trigger eval / FTR)**: enter 를 건드리는 변경(B-2/B-3)은 **FTR(오발동률)**
  증가 여부로 검증. hold 변경(A/B-1)은 "조작 중 의도치 않은 해제 횟수"를 새 지표로 측정 고려.
- 수동 시나리오: §4 표의 4가지 시나리오를 직접 재현해 통과 확인.

## 10. 단계적 적용 (Phases)

- **Phase 1** ✅ (2026-06-02) — 제안 A(활동 기반 idle 해제)로 `LATCH_MS` 교체. 정적 zone 유지.
  - `App.tsx`: `LATCH_MS`/`latchTimerRef` 제거 → `IDLE_RELEASE_MS=1200` + 활동 기반 idle 모니터
    (interval). 유지 조건 = `edgeSnapshot.state==='entered'`(zone) OR `sliderDebug.active`(tilt).
  - DebugHud: `engage` 행(reason active/zone/idle + idle ms) 추가.
- **Phase 2** ✅ (2026-06-02) — B-1(동적 hold zone, operating 시 유한 확장).
  - `SnapConfig`: `lockZoneFracActive`(0.55) + `holdZoneDecayMs`(400) 추가.
  - `EdgeDetector`: 동적 `holdFrac` (operating 시 즉시 확장, idle 시 시상수로 수축),
    `update(point, vp, now, operating)` 시그니처, `inLockZone` 이 holdFrac 사용,
    snapshot.lockZoneFrac 를 동적값으로 노출(EdgeZones/HUD 시각화).
  - `App`: `operatingRef`(=upright 벗어남) 단일 신호로 edge-detector hint + 이탈 판정 공유.
  - DebugHud: `hold zone` 행 추가.
- **Phase 3** — (선택) B-2(정확도 적응) / B-3(속도 적응 enter). 보고서 §4.5 정량화.

각 Phase 끝에 typecheck/build + 수동 시나리오 통과, DebugHud 로 신호 확인.

## 11. 결정 필요 사항 (열린 질문)

1. **이탈 grace 길이** `idleReleaseMs`: 1.2초가 적절한가? (짧으면 답답, 길면 잔존)
2. **active 중 hold zone**: 유한 확장(0.55)인가, 아예 gaze 무시(∞)인가? 후자는 "조작 중엔
   순수 head 제어"가 되어 단순하지만, 잘못 lock 됐을 때 빠져나오기 어려울 수 있음.
3. **통합 위치**: edge-detector 에 head hint 주입(일원화) vs 별도 EngagementController(분리).
4. **B-2/B-3 적용 범위**: 이번에 enter 동적화까지 갈지, 우선 hold 만 동적화할지.
5. **재진입 정책**: idle grace 중 다시 active/zone 진입 시 같은 컨트롤로 즉시 복귀(권장) 확정.

---

### 요약 추천
- 먼저 **Phase 1(활동 기반 idle 해제)** 로 3초 컷오프를 없앤다 — 가장 큰 불편 즉시 해결.
- 이어 **Phase 2(active 시 hold zone 동적 확장)** 로 교수님 아이디어를 hold 축에 적용,
  시간 개념을 공간/활동 개념으로 대체해 두 메커니즘을 하나로 통합.
- enter 동적화(B-2/B-3)는 FTR 검증과 함께 연구 단계로.
