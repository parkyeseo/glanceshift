/**
 * GazeDot — 디버그용 시선 도트.
 * 보고서 §3.2 Feel(cool 매체)에 따라 평소엔 보이지 않게,
 * 디버그 HUD가 켜져 있을 때만 표시한다.
 *
 * snapAnimating=true (lock 진입 220ms) 일 때는 rail 로 흡수되는 transition 을 강하게.
 * snap=true (snapping mode 전반) 이면 도트 자체에 옅은 강조 (조작 가능 상태 단서).
 */

import { memo } from 'react'

type Props = {
  x: number
  y: number
  visible: boolean
  /** snapping mode 가 활성화된 동안 true. 도트에 약간의 강조. */
  snap?: boolean
  /** lock 진입 직후 ~220ms 동안 true. rail 로 끌리는 강한 transition. */
  snapAnimating?: boolean
}

function GazeDotImpl({ x, y, visible, snap, snapAnimating }: Props): JSX.Element | null {
  if (!visible || x < 0 || y < 0) return null
  const cls = [
    'gaze-dot',
    snap ? 'snap-active' : '',
    snapAnimating ? 'snapping-in' : ''
  ]
    .filter(Boolean)
    .join(' ')
  return <div className={cls} style={{ left: x, top: y }} />
}

export const GazeDot = memo(GazeDotImpl)
