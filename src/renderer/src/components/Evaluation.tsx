/**
 * Evaluation — 5×5 grid 시선 정확도 평가 (보고서 §5/6 의 정량 근거 생성).
 *
 * 절차:
 *   1. intro     — condition 라벨 입력 + (선택) 화면 거리·폭, 시작
 *   2. running   — 25 개 target 을 차례로 표시. 각 target 마다:
 *                    · prep 0.5s : 점이 페이드인 (사용자가 시선을 옮길 시간)
 *                    · measure 1.5s : 점이 펄스, 마지막 1s 동안 gaze 샘플 수집
 *   3. complete  — mean/max error, 도(°) 환산, target 별 결과 표시
 *                  Save CSV 버튼 → main process IPC 로 userData 폴더에 저장
 *                  Done 버튼 → 종료
 *
 * Cmd/Ctrl+Shift+E 로 진입 (App 에서 IPC 단축키 등록).
 *
 * 가정:
 *   - 평가 동안 click-through OFF (App 이 처리). ESC 로 취소.
 *   - 사용자가 정직하게 매 target 을 응시한다는 가정 위에서 통계 의미가 있음.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { computePerTarget, aggregate, toCSV, type Sample, type PerTargetResult, type AggregateResult } from '../perception/eval-stats'

type Phase = 'intro' | 'running' | 'complete'

type Props = {
  /** 현재 gaze 좌표 (있으면 사용; 없으면 평가 자체 무의미) */
  gazePoint: { x: number; y: number } | null
  /** 종료 콜백 */
  onDone: () => void
  /** 현재 edge mode — condition 라벨에 자동 prefix */
  edgeMode?: string
}

const N_ROWS = 5
const N_COLS = 5
const MARGIN_FRAC = 0.1   // viewport 가장자리 마진
const PREP_MS = 500       // 점이 등장하고 사용자가 시선을 옮기는 시간
const MEASURE_MS = 1500   // 측정 window (마지막 1s 가 실제 sample 수집)
const SAMPLING_START_MS = PREP_MS + 500  // measure 시작 후 500ms 부터 샘플 수집

function makeTargets(width: number, height: number): { x: number; y: number; idx: number }[] {
  const out: { x: number; y: number; idx: number }[] = []
  const cols: number[] = []
  const rows: number[] = []
  for (let c = 0; c < N_COLS; c++) {
    cols.push(MARGIN_FRAC + (1 - 2 * MARGIN_FRAC) * (c / (N_COLS - 1)))
  }
  for (let r = 0; r < N_ROWS; r++) {
    rows.push(MARGIN_FRAC + (1 - 2 * MARGIN_FRAC) * (r / (N_ROWS - 1)))
  }
  let idx = 0
  for (let r = 0; r < N_ROWS; r++) {
    for (let c = 0; c < N_COLS; c++) {
      out.push({ x: cols[c] * width, y: rows[r] * height, idx: idx++ })
    }
  }
  return out
}

/** Condition 선택지 — 자세 변화 비교용 (mode prefix 는 자동 추가) */
const POSE_PRESETS = [
  { id: 'baseline-frontal', label: '정면 baseline' },
  { id: 'yaw-15deg', label: '좌/우 15° 회전' },
  { id: 'dist-far', label: '거리 +20cm' },
  { id: 'dist-near', label: '거리 -10cm' },
  { id: 'drift-5min', label: '5분 자유작업 후' }
]

export function Evaluation({ gazePoint, onDone, edgeMode }: Props): JSX.Element {
  const [phase, setPhase] = useState<Phase>('intro')
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [pose, setPose] = useState<string>('baseline-frontal')
  const condition = edgeMode ? `${edgeMode}__${pose}` : pose
  const [screenWidthCm, setScreenWidthCm] = useState<string>('')
  const [screenDistanceCm, setScreenDistanceCm] = useState<string>('')
  const [targetIdx, setTargetIdx] = useState(0)
  const [phaseInTarget, setPhaseInTarget] = useState<'prep' | 'measure'>('prep')
  const [results, setResults] = useState<PerTargetResult[]>([])
  const [aggResult, setAggResult] = useState<AggregateResult | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const startedAtRef = useRef<number>(0)
  // gazePoint 의 최신 reference 를 ref 로 보관 — 타이머 콜백에서 stale 방지
  const gazeRef = useRef<{ x: number; y: number } | null>(gazePoint)
  gazeRef.current = gazePoint
  // onDone 도 ref (App 이 매 render 마다 새 arrow function 내려보내므로)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  // viewport 갱신
  useEffect(() => {
    const onResize = (): void => setViewport({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ESC 취소
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDoneRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const targets = useMemo(() => makeTargets(viewport.w, viewport.h), [viewport])

  // running 단계: target 별 prep → measure → 다음
  useEffect(() => {
    if (phase !== 'running') return
    if (targetIdx >= targets.length) {
      // 모두 완료 → aggregate + complete
      const widthCm = parseFloat(screenWidthCm)
      const distCm = parseFloat(screenDistanceCm)
      const agg = aggregate(results, {
        condition,
        startedAt: startedAtRef.current,
        viewport,
        screenWidthCm: Number.isFinite(widthCm) && widthCm > 0 ? widthCm : null,
        screenDistanceCm: Number.isFinite(distCm) && distCm > 0 ? distCm : null
      })
      setAggResult(agg)
      setPhase('complete')
      return
    }
    const target = targets[targetIdx]
    setPhaseInTarget('prep')
    // measure 단계로 진입
    const measureTimer = window.setTimeout(() => {
      setPhaseInTarget('measure')
    }, PREP_MS)
    // sample 수집 시작 (prep 끝나고 500ms 추가 안정화 후)
    const samples: Sample[] = []
    let samplingActive = false
    const samplingStartTimer = window.setTimeout(() => {
      samplingActive = true
    }, SAMPLING_START_MS)
    // 매 frame 마다 gaze 를 buffer 에 추가
    let raf = 0
    const collect = (): void => {
      if (samplingActive) {
        const g = gazeRef.current
        if (g && g.x >= 0 && g.y >= 0) {
          samples.push({ tx: target.x, ty: target.y, gx: g.x, gy: g.y, t: performance.now() })
        }
      }
      raf = requestAnimationFrame(collect)
    }
    raf = requestAnimationFrame(collect)
    // measure window 끝나면 결과 push + 다음 target
    const endTimer = window.setTimeout(() => {
      const r = computePerTarget(target.idx, { x: target.x, y: target.y }, samples)
      setResults((cur) => [...cur, r])
      setTargetIdx((i) => i + 1)
    }, PREP_MS + MEASURE_MS)
    return () => {
      clearTimeout(measureTimer)
      clearTimeout(samplingStartTimer)
      clearTimeout(endTimer)
      cancelAnimationFrame(raf)
    }
  }, [phase, targetIdx, targets, condition, screenWidthCm, screenDistanceCm, viewport])
  // ☝️ results 가 deps 에 없는 건 의도적 — results 변경이 이 effect 를 재실행시켜선 안 됨

  const handleStart = (): void => {
    setResults([])
    setTargetIdx(0)
    setAggResult(null)
    setSavedPath(null)
    startedAtRef.current = Date.now()
    setPhase('running')
  }

  const handleSaveCSV = async (): Promise<void> => {
    if (!aggResult) return
    const csv = toCSV(aggResult)
    const ts = new Date(aggResult.startedAt).toISOString().replace(/[:.]/g, '-')
    const safeCondition = aggResult.condition.replace(/[^\w가-힣-]/g, '_')
    const filename = `eval_${safeCondition}_${ts}.csv`
    try {
      const fullPath = await window.glanceshift.saveEvalCsv(filename, csv)
      setSavedPath(fullPath)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[eval] save failed:', e)
    }
  }

  // ===== UI =====

  if (phase === 'intro') {
    return (
      <div className="eval-root">
        <div className="eval-prompt">
          <h3>시선 정확도 평가</h3>
          <p>
            화면에 25 개의 점이 순서대로 표시됩니다. 각 점이 나타나면
            <strong> 점의 중심을 응시해 주세요</strong>. ESC 로 취소.
          </p>
          <div className="eval-field">
            <label>pose / condition</label>
            <div className="eval-pose-grid">
              {POSE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`eval-pose-btn${pose === p.id ? ' active' : ''}`}
                  onClick={() => setPose(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
              저장될 condition: <code style={{ color: '#a8d2ff' }}>{condition}</code>
            </div>
          </div>
          <div className="eval-field-row">
            <div className="eval-field">
              <label>화면 가로 (cm, 선택)</label>
              <input
                type="number"
                value={screenWidthCm}
                onChange={(e) => setScreenWidthCm(e.target.value)}
                placeholder="34.5"
                step="0.1"
              />
            </div>
            <div className="eval-field">
              <label>화면까지 거리 (cm, 선택)</label>
              <input
                type="number"
                value={screenDistanceCm}
                onChange={(e) => setScreenDistanceCm(e.target.value)}
                placeholder="55"
                step="1"
              />
            </div>
          </div>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: -8 }}>
            (둘 다 입력하면 결과가 픽셀 외에 도(°) 단위로도 환산됩니다)
          </p>
          <button type="button" className="calib-continue" onClick={handleStart}>
            시작
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'running' && targetIdx < targets.length) {
    const target = targets[targetIdx]
    const isPrep = phaseInTarget === 'prep'
    return (
      <div className="eval-root running">
        <div className="eval-progress">
          <div className="eval-progress-text">
            {targetIdx + 1} / {targets.length}
          </div>
          <div className="eval-progress-bar">
            <div
              className="eval-progress-fill"
              style={{ width: `${((targetIdx + 1) / targets.length) * 100}%` }}
            />
          </div>
        </div>
        <div
          className={`eval-target${isPrep ? ' prep' : ' measure'}`}
          style={{ left: target.x, top: target.y }}
        />
      </div>
    )
  }

  if (phase === 'complete' && aggResult) {
    const { meanErrorPx, maxErrorPx, meanErrorDeg, perTarget } = aggResult
    return (
      <div className="eval-root">
        <div className="eval-prompt eval-prompt-wide">
          <h3>완료 — {aggResult.condition}</h3>
          <div className="eval-stats">
            <div className="eval-stat">
              <span className="eval-stat-label">mean error</span>
              <span className="eval-stat-value">
                {meanErrorPx.toFixed(1)} px
                {meanErrorDeg != null && (
                  <span className="eval-stat-sub"> · {meanErrorDeg.toFixed(2)}°</span>
                )}
              </span>
            </div>
            <div className="eval-stat">
              <span className="eval-stat-label">max error</span>
              <span className="eval-stat-value">{maxErrorPx.toFixed(1)} px</span>
            </div>
            <div className="eval-stat">
              <span className="eval-stat-label">samples / target</span>
              <span className="eval-stat-value">
                {Math.round(perTarget.reduce((a, b) => a + b.samples.length, 0) / Math.max(1, perTarget.length))}
              </span>
            </div>
          </div>
          {/* per-target preview: 작은 grid 시각화 — target dot + measured mean */}
          <EvalMiniPlot viewport={viewport} perTarget={perTarget} />
          <div className="eval-actions">
            <button type="button" className="calib-continue" onClick={handleSaveCSV}>
              CSV 저장
            </button>
            <button type="button" className="calib-reset" onClick={handleStart}>
              다시 측정
            </button>
            <button type="button" className="calib-reset" onClick={() => onDoneRef.current()}>
              완료
            </button>
          </div>
          {savedPath && (
            <p style={{ fontSize: 11, marginTop: 8, color: '#7be38a', wordBreak: 'break-all' }}>
              저장됨: {savedPath}
            </p>
          )}
        </div>
      </div>
    )
  }

  return <div className="eval-root" />
}

function EvalMiniPlot({
  viewport,
  perTarget
}: {
  viewport: { w: number; h: number }
  perTarget: PerTargetResult[]
}): JSX.Element {
  const SIZE = 280
  const sx = SIZE / viewport.w
  const sy = (SIZE * viewport.h / viewport.w) / viewport.h
  const h = (SIZE * viewport.h) / viewport.w
  return (
    <svg
      className="eval-miniplot"
      width={SIZE}
      height={h}
      viewBox={`0 0 ${SIZE} ${h}`}
    >
      {/* viewport 테두리 */}
      <rect x={0} y={0} width={SIZE} height={h} fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.18)" />
      {perTarget.map((r) => {
        const tx = r.target.x * sx
        const ty = r.target.y * sy
        const mx = r.mean.x * sx
        const my = r.mean.y * sy
        return (
          <g key={r.targetIdx}>
            <line x1={tx} y1={ty} x2={mx} y2={my} stroke="rgba(90, 169, 255, 0.6)" strokeWidth={1} />
            <circle cx={tx} cy={ty} r={2.5} fill="rgba(255,255,255,0.7)" />
            <circle cx={mx} cy={my} r={2.5} fill="rgba(90, 169, 255, 0.95)" />
          </g>
        )
      })}
    </svg>
  )
}
