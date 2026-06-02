/**
 * Slider Mapper — 머리 roll 기울임으로 슬라이더 값(0..1)을 조절.
 *
 * 조이스틱(rate control) 방식:
 *   engage 시작 시점의 roll 을 neutral(0)로 캡처하고, 그 기준에서 기운 정도에 비례해
 *   값을 *지속적으로* 증감시킨다 (위치 매핑이 아니라 속도 매핑).
 *     - 오른쪽 어깨로 기울임 → 값 증가 (계속 기울이고 있으면 계속 증가)
 *     - 왼쪽 어깨로 기울임   → 값 감소
 *     - 중앙(neutral ± 데드존) → 정지 ("꾹 누르기" 를 떼는 느낌)
 *   시작 값은 그 control 의 현재 저장값에서 출발해 상대적으로 조정된다.
 *
 * 활성화 정책:
 *   - GazeBar 의 한 항목이 1초 dwell 로 select 되어 latch 된 동안만 engage.
 *   - select 가 풀리면 마지막 값이 commit 된다 (OS bridge 가 이걸 받음).
 *
 * 의도 판별 (보고서 §3.3 Modes — Sidenmark & Gellersen 2019, BimodalGaze 2020):
 *   사용자가 다른 곳을 보려고 고개를 *돌리는*(yaw) 동안 동반되는 roll 까지 조작으로
 *   반영되면 안 된다. → yaw 각속도가 임계 이상인 동안은 "둘러봄" 으로 보고 적분을 멈춘다.
 */

export interface SliderMapperConfig {
  /** neutral 기준 ± 이 각도(도) 안에서는 값 변화 정지 (조이스틱 데드존). */
  neutralDeadzoneDeg: number
  /** 이 기울임(도)에서 최대 속도에 도달. 이상은 동일 속도로 clamp. */
  fullTiltDeg: number
  /** 최대 기울임에서의 변화 속도 (value/s). 0→1 도달 시간 = 1 / maxRatePerSec. */
  maxRatePerSec: number
  /** yaw 각속도(deg/s) 임계 — 이상이면 둘러봄으로 보고 적분 정지. */
  lookAroundYawRate: number
  /** yaw 각속도 EMA 평활 계수(0..1). 높을수록 즉응, 낮을수록 게이트가 안정적. */
  yawRateSmoothing: number
}

export const DEFAULT_SLIDER_CONFIG: SliderMapperConfig = {
  neutralDeadzoneDeg: 3,
  fullTiltDeg: 22,
  maxRatePerSec: 1 / 1.2, // ≈0.83 → 풀 틸트에서 0→100% 약 1.2초
  lookAroundYawRate: 30,
  yawRateSmoothing: 0.35
}

export interface SliderUpdate {
  /** 현재 슬라이더 값(0..1) */
  value: number
  /** 지금 적분(값 변화) 중인지 — 데드존 밖 + 둘러봄 아님 */
  active: boolean
  /** 현재 변화 속도 (value/s, 부호 포함) — 디버그/시각화용 */
  rate: number
  /** 평활된 yaw 각속도(deg/s) — 디버그/시각화용 */
  yawRate: number
}

/**
 * 조이스틱형 슬라이더 매퍼 (stateful).
 *
 * 새 engage 시작 시 reset(startValue) 로 시작 값을 시드한다. neutral roll 은 다음 update 의
 * roll 로 자동 캡처된다. 이후 매 프레임 roll/yaw/timestamp 를 받아 값을 적분한다.
 */
export class SliderIntentMapper {
  private neutralRoll: number | null = null
  private value = 0.5
  private lastYaw: number | null = null
  private lastT: number | null = null
  private yawRateEma = 0

  constructor(public cfg: SliderMapperConfig = DEFAULT_SLIDER_CONFIG) {}

  /** 새 engage 시작 — 시작 값 시드. neutral 은 다음 update 의 roll 로 캡처. */
  reset(startValue = 0.5): void {
    this.value = Math.max(0, Math.min(1, startValue))
    this.neutralRoll = null
    this.lastYaw = null
    this.lastT = null
    this.yawRateEma = 0
  }

  update(roll: number, yaw: number, t: number): SliderUpdate {
    // dt(초) — face 손실 후 재개 시 값 점프를 막기 위해 100ms 로 clamp.
    let dtS = 0
    if (this.lastT != null) dtS = Math.max(0, Math.min(0.1, (t - this.lastT) / 1000))

    // yaw 각속도 — 필터된 yaw 의 미분에 EMA 를 걸어 게이트 깜빡임 방지.
    if (this.lastYaw != null && dtS > 1e-3) {
      const raw = Math.abs(yaw - this.lastYaw) / dtS
      const a = this.cfg.yawRateSmoothing
      this.yawRateEma = a * raw + (1 - a) * this.yawRateEma
    }
    this.lastYaw = yaw
    this.lastT = t

    // 첫 프레임 — neutral 캡처, 적분 없음.
    if (this.neutralRoll == null) {
      this.neutralRoll = roll
      return { value: this.value, active: false, rate: 0, yawRate: this.yawRateEma }
    }

    const looking = this.yawRateEma >= this.cfg.lookAroundYawRate
    // 오른쪽 어깨로 기울임 = 값 증가, 왼쪽 = 감소 (실측 기준 부호).
    // tilt > 0 = 오른쪽 기울임 = 값 증가.
    const tilt = roll - this.neutralRoll
    const mag = Math.abs(tilt)

    let rate = 0
    if (!looking && mag > this.cfg.neutralDeadzoneDeg) {
      const span = Math.max(0.001, this.cfg.fullTiltDeg - this.cfg.neutralDeadzoneDeg)
      const norm = Math.min(1, (mag - this.cfg.neutralDeadzoneDeg) / span)
      rate = Math.sign(tilt) * norm * this.cfg.maxRatePerSec
    }

    this.value = Math.max(0, Math.min(1, this.value + rate * dtS))
    return { value: this.value, active: rate !== 0, rate, yawRate: this.yawRateEma }
  }
}
