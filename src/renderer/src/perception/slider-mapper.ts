/**
 * Slider Mapper — 머리 roll 각도 → 슬라이더 0..1 값.
 *
 * 보고서 §3.3 Mappings — Radi-Eye Look & Cross 스타일:
 *   머리를 어깨 쪽으로 갸웃한 정도가 슬라이더 값에 선형 매핑.
 *   - roll ≈ -25° (오른쪽 어깨로) → 0%
 *   - roll ≈   0° (정중)         → 50%
 *   - roll ≈ +25° (왼쪽 어깨로)  → 100%
 *
 * 활성화 정책:
 *   - GazeBar 의 한 항목이 1초 dwell 로 select 되어 latch 된 동안만 engage.
 *   - select 가 풀리면 마지막 값이 commit 된다 (Phase 7 의 OS bridge 가 이걸 받음).
 *
 * 의도 판별 (보고서 §3.3 Modes — Sidenmark & Gellersen 2019, BimodalGaze 2020):
 *   roll 을 그대로 값에 매핑하면, 사용자가 다른 곳을 보려고 고개를 *돌리는*(yaw) 동안
 *   동반되는 미세 roll 까지 값으로 반영돼 슬라이더가 의도치 않게 흔들린다.
 *   → yaw 각속도가 임계 이상인 동안은 "둘러봄" 으로 보고 직전 값을 hold,
 *     yaw 가 안정되면 roll → 값 매핑을 재개한다. SliderIntentMapper 가 담당.
 */

export interface SliderMapperConfig {
  /** 풀-스케일까지의 roll 각도(도). 기본 25°. */
  rollRange: number
  /** 데드존 — |roll| 이 이 값 이하면 50% 로 고정. 미세 떨림 차단. 기본 1.5°. */
  deadzone: number
  /**
   * yaw 각속도(deg/s) 임계. 이 이상이면 "고개를 돌려 둘러보는 중" 으로 보고
   * roll 입력을 의도로 받지 않고 직전 슬라이더 값을 유지(hold)한다.
   */
  lookAroundYawRate: number
  /** yaw 각속도 EMA 평활 계수(0..1). 높을수록 즉응, 낮을수록 게이트가 안정적. */
  yawRateSmoothing: number
}

export const DEFAULT_SLIDER_CONFIG: SliderMapperConfig = {
  rollRange: 25,
  deadzone: 1.5,
  lookAroundYawRate: 30,
  yawRateSmoothing: 0.35
}

/**
 * roll 도(°) → 0..1 값. clamp 포함. (순수 함수 — 의도 판별 없이 각도만 매핑)
 */
export function rollToValue(roll: number, cfg: SliderMapperConfig = DEFAULT_SLIDER_CONFIG): number {
  // 데드존: 작은 떨림은 무시
  let r = roll
  if (Math.abs(r) <= cfg.deadzone) r = 0
  else r = r - Math.sign(r) * cfg.deadzone

  // 데드존을 뺀 만큼 범위도 축소
  const effective = Math.max(0.001, cfg.rollRange - cfg.deadzone)
  const norm = (r + effective) / (2 * effective)
  return Math.max(0, Math.min(1, norm))
}

export interface SliderUpdate {
  /** 적용할 슬라이더 값(0..1) — 둘러보는 중이면 직전 값 유지 */
  value: number
  /** 이번 프레임의 roll 을 의도적 조작으로 판정했는지 (false = 둘러봄 → hold) */
  intentional: boolean
  /** 평활된 yaw 각속도(deg/s) — 디버그/시각화용 */
  yawRate: number
}

/**
 * 의도 판별형 슬라이더 매퍼 (stateful).
 *
 * 매 프레임 roll/yaw(도) + timestamp(ms) 를 받아, yaw 각속도로 "의도적 갸웃" 과
 * "둘러보다 딸려온 roll" 을 구분한다. yaw 가 빠르게 움직이는 동안엔 직전 값을 유지하고,
 * 안정되면 roll → 값 매핑을 재개한다.
 *
 * 선택(latch)이 새 control 로 바뀌면 reset() 으로 yaw 속도/hold 상태를 초기화해야 한다.
 */
export class SliderIntentMapper {
  private lastYaw: number | null = null
  private lastT: number | null = null
  private yawRateEma = 0
  private heldValue: number | null = null

  constructor(public cfg: SliderMapperConfig = DEFAULT_SLIDER_CONFIG) {}

  reset(): void {
    this.lastYaw = null
    this.lastT = null
    this.yawRateEma = 0
    this.heldValue = null
  }

  update(roll: number, yaw: number, t: number): SliderUpdate {
    // yaw 각속도 추정 — 필터된 yaw 의 미분에 EMA 를 한 번 더 걸어 게이트 깜빡임 방지.
    if (this.lastYaw != null && this.lastT != null) {
      const dt = (t - this.lastT) / 1000
      if (dt > 1e-3) {
        const raw = Math.abs(yaw - this.lastYaw) / dt
        const a = this.cfg.yawRateSmoothing
        this.yawRateEma = a * raw + (1 - a) * this.yawRateEma
      }
    }
    this.lastYaw = yaw
    this.lastT = t

    const target = rollToValue(roll, this.cfg)
    const intentional = this.yawRateEma < this.cfg.lookAroundYawRate
    // 의도적이거나 아직 hold 값이 없으면(첫 프레임) 현재 roll 값으로 갱신.
    if (intentional || this.heldValue == null) {
      this.heldValue = target
    }
    return { value: this.heldValue, intentional, yawRate: this.yawRateEma }
  }
}
