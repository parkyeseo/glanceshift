/**
 * Slider Mapper — 머리 roll 기울임으로 슬라이더 값(0..1)을 조절.
 *
 * 조이스틱(rate control) 방식 — **절대(머리 수평=0) 기준**:
 *   머리가 "꼿꼿이(upright)" 서 있으면(|roll| <= uprightMaxDeg) 값이 변하지 않는다(=조작 안 함).
 *   그 범위를 벗어나 기울이면 기운 방향·정도에 비례해 값을 *지속* 증감시킨다(속도 매핑).
 *     - 오른쪽 어깨로 기울임 → 값 증가 (계속 기울이고 있으면 계속 증가)
 *     - 왼쪽 어깨로 기울임   → 값 감소
 *     - 꼿꼿(upright)        → 정지
 *   시작 값은 그 control 의 현재 저장값에서 출발해 상대적으로 조정된다.
 *
 *   ⚠️ 조작 인식 기준(uprightMaxDeg)은 engagement 이탈 판정(App)과 **동일한 기준**을 쓴다.
 *      이전엔 engage 시점 머리 기울기를 neutral 로 캡처해 ramp 했는데, 이탈 판정(절대 upright)과
 *      기준이 달라 혼란스러웠다. 둘 다 "절대 upright" 로 통일.
 *
 * 활성화 정책:
 *   - GazeBar 의 한 항목이 1초 dwell 로 select 되어 engage 된 동안만.
 *   - engage 해제 시 마지막 값이 commit 된다 (OS bridge 가 이걸 받음).
 *
 * 의도 판별 (보고서 §3.3 Modes — Sidenmark & Gellersen 2019, BimodalGaze 2020):
 *   고개를 *돌리는*(yaw) 동안 동반되는 roll 은 조작이 아니다 → yaw 각속도가 임계 이상이면
 *   "둘러봄" 으로 보고 ramp 를 멈춘다.
 */

export interface SliderMapperConfig {
  /**
   * 머리가 "꼿꼿(upright)" 으로 간주되는 절대 roll 범위(도). 이 안에서는 값 변화 없음(=조작 안 함).
   * engagement 이탈 판정과 **동일한 기준**으로 공유된다.
   */
  uprightMaxDeg: number
  /** 이 기울임(도, 절대)에서 최대 속도에 도달. 이상은 동일 속도로 clamp. */
  fullTiltDeg: number
  /** 최대 기울임에서의 변화 속도 (value/s). 0→1 도달 시간 = 1 / maxRatePerSec. */
  maxRatePerSec: number
  /** yaw 각속도(deg/s) 임계 — 이상이면 둘러봄으로 보고 ramp 정지. */
  lookAroundYawRate: number
  /** yaw 각속도 EMA 평활 계수(0..1). 높을수록 즉응, 낮을수록 게이트가 안정적. */
  yawRateSmoothing: number
}

export const DEFAULT_SLIDER_CONFIG: SliderMapperConfig = {
  uprightMaxDeg: 6,
  fullTiltDeg: 22,
  maxRatePerSec: 1 / 1.2, // ≈0.83 → 풀 틸트에서 0→100% 약 1.2초
  lookAroundYawRate: 30,
  yawRateSmoothing: 0.35
}

export interface SliderUpdate {
  /** 현재 슬라이더 값(0..1) */
  value: number
  /** 지금 적분(값 변화) 중인지 — upright 범위 밖 + 둘러봄 아님 */
  active: boolean
  /** 현재 변화 속도 (value/s, 부호 포함) — 디버그/시각화용 */
  rate: number
  /** 평활된 yaw 각속도(deg/s) — 디버그/시각화용 */
  yawRate: number
}

/**
 * 조이스틱형 슬라이더 매퍼 (stateful) — 절대 roll 기준.
 *
 * 새 engage 시작 시 reset(startValue) 로 시작 값을 시드한다. 이후 매 프레임 roll/yaw/timestamp
 * 를 받아 값을 적분한다. (neutral 캡처 없음 — 머리 수평이 0.)
 */
export class SliderIntentMapper {
  private value = 0.5
  private lastYaw: number | null = null
  private lastT: number | null = null
  private yawRateEma = 0

  constructor(public cfg: SliderMapperConfig = DEFAULT_SLIDER_CONFIG) {}

  /** 새 engage 시작 — 시작 값 시드. */
  reset(startValue = 0.5): void {
    this.value = Math.max(0, Math.min(1, startValue))
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

    const looking = this.yawRateEma >= this.cfg.lookAroundYawRate
    // 절대 기준: 머리가 꼿꼿(|roll| <= uprightMaxDeg)하면 조작 안 함. 벗어나면 그 방향으로 ramp.
    // 오른쪽 어깨로 기울임(roll > 0) = 값 증가.
    const mag = Math.abs(roll)
    let rate = 0
    if (!looking && mag > this.cfg.uprightMaxDeg) {
      const span = Math.max(0.001, this.cfg.fullTiltDeg - this.cfg.uprightMaxDeg)
      const norm = Math.min(1, (mag - this.cfg.uprightMaxDeg) / span)
      rate = Math.sign(roll) * norm * this.cfg.maxRatePerSec
    }

    this.value = Math.max(0, Math.min(1, this.value + rate * dtS))
    return { value: this.value, active: rate !== 0, rate, yawRate: this.yawRateEma }
  }
}
