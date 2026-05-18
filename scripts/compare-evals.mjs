#!/usr/bin/env node
/**
 * compare-evals — userData/eval-logs/ 의 모든 CSV 결과를 condition 별로 묶고
 *                 보고서에 그대로 붙여 넣을 수 있는 markdown 표를 출력한다.
 *
 *   $ node scripts/compare-evals.mjs
 *   $ node scripts/compare-evals.mjs --out comparison.md
 *
 * macOS 의 경우 평가 CSV 가 다음 위치에 저장되어 있음:
 *   ~/Library/Application Support/glanceshift/eval-logs/
 *
 * 출력 표:
 *   condition | n_targets | mean_error_px | mean_error_deg | max_error_px | std_within
 *
 * 한 condition 에 여러 measurement (서로 다른 timestamp) 가 있으면 평균 + n 표시.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'

function defaultEvalDir() {
  if (platform() === 'darwin') {
    return join(homedir(), 'Library/Application Support/glanceshift/eval-logs')
  }
  if (platform() === 'win32') {
    return join(process.env.APPDATA ?? homedir(), 'glanceshift/eval-logs')
  }
  return join(homedir(), '.config/glanceshift/eval-logs')
}

const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const outFile = outIdx >= 0 ? args[outIdx + 1] : null
const dirIdx = args.indexOf('--dir')
const dir = dirIdx >= 0 ? args[dirIdx + 1] : defaultEvalDir()

if (!existsSync(dir)) {
  console.error(`[compare] not found: ${dir}`)
  console.error(`  앱에서 ⌘⇧E 평가를 한 번이라도 돌려야 폴더가 생깁니다.`)
  process.exit(1)
}

const files = readdirSync(dir).filter((f) => f.endsWith('.csv')).sort()
if (files.length === 0) {
  console.error(`[compare] no CSV in ${dir}`)
  process.exit(1)
}

// CSV 파싱 — 매우 단순 (eval-stats.ts 의 toCSV 출력 포맷에 맞춤).
function parseCsv(text) {
  // UTF-8 BOM 제거
  const noBom = text.replace(/^﻿/, '')
  const lines = noBom.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const header = parseRow(lines[0])
  return lines.slice(1).map((line) => {
    const cols = parseRow(line)
    const row = {}
    header.forEach((h, i) => (row[h] = cols[i] ?? ''))
    return row
  })
}
function parseRow(line) {
  // condition 컬럼이 따옴표로 둘러싸일 수 있으니 minimal CSV 파서
  const out = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') inQuote = false
      else cur += c
    } else {
      if (c === ',') { out.push(cur); cur = '' }
      else if (c === '"' && cur === '') inQuote = true
      else cur += c
    }
  }
  out.push(cur)
  return out
}

// condition 별로 그룹화: file → rows
const byCondition = new Map()
for (const f of files) {
  const rows = parseCsv(readFileSync(join(dir, f), 'utf8'))
  if (rows.length === 0) continue
  const condition = rows[0].condition || '(unknown)'
  if (!byCondition.has(condition)) byCondition.set(condition, [])
  byCondition.get(condition).push({ file: f, rows })
}

// 통계 계산
function mean(arr) {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}
function std(arr) {
  if (arr.length === 0) return 0
  const m = mean(arr)
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)))
}

// 한 condition 의 모든 measurement 의 모든 target row 를 평탄화해서 통계
function summarize(condition, measurements) {
  const allErrs = []
  const allErrsDeg = []
  const allStdsX = []
  const allStdsY = []
  let maxErr = 0
  let nTargets = 0
  let nMeasurements = measurements.length
  for (const m of measurements) {
    for (const r of m.rows) {
      const e = parseFloat(r.error_px)
      if (!Number.isFinite(e)) continue
      allErrs.push(e)
      if (e > maxErr) maxErr = e
      const ed = parseFloat(r.error_deg)
      if (Number.isFinite(ed)) allErrsDeg.push(ed)
      const sx = parseFloat(r.std_x)
      const sy = parseFloat(r.std_y)
      if (Number.isFinite(sx)) allStdsX.push(sx)
      if (Number.isFinite(sy)) allStdsY.push(sy)
      nTargets++
    }
  }
  return {
    condition,
    nMeasurements,
    nTargets,
    meanErrPx: mean(allErrs),
    stdErrPx: std(allErrs),
    maxErrPx: maxErr,
    meanErrDeg: allErrsDeg.length ? mean(allErrsDeg) : null,
    meanStdWithinTarget: (mean(allStdsX) + mean(allStdsY)) / 2
  }
}

const summaries = []
for (const [cond, ms] of byCondition.entries()) {
  summaries.push(summarize(cond, ms))
}
// condition 알파벳순 정렬 (mode__pose 구조이므로 mode 별로 묶임)
summaries.sort((a, b) => a.condition.localeCompare(b.condition))

// Markdown 출력
const lines = []
lines.push('# Gaze Accuracy Evaluation — Comparison\n')
lines.push(`*Source: ${dir} · ${files.length} CSV files · ${summaries.length} conditions*\n`)
lines.push('| condition | runs | n_targets | mean error (px) | mean error (°) | max (px) | within-target σ (px) |')
lines.push('| --- | --- | --- | --- | --- | --- | --- |')
for (const s of summaries) {
  lines.push(
    `| \`${s.condition}\` | ${s.nMeasurements} | ${s.nTargets} | ` +
    `${s.meanErrPx.toFixed(1)} ± ${s.stdErrPx.toFixed(1)} | ` +
    `${s.meanErrDeg != null ? s.meanErrDeg.toFixed(2) : '—'} | ` +
    `${s.maxErrPx.toFixed(1)} | ` +
    `${s.meanStdWithinTarget.toFixed(1)} |`
  )
}
lines.push('')
lines.push('## Notes')
lines.push('- *mean error (px)* — across all 25-target measurements, averaged over runs.  σ following ± is across all individual target errors.')
lines.push('- *mean error (°)* — 도(°) 환산은 사용자가 평가 시 화면 폭(cm)·거리(cm) 를 입력했을 때만 계산됨.')
lines.push('- *within-target σ* — 한 target 응시 동안의 시선 jitter. 시선 안정성 지표.')
lines.push('- condition 형식: `<mode>__<pose>` (예: `magnetic__yaw-15deg`).')

const md = lines.join('\n')
if (outFile) {
  writeFileSync(outFile, md, 'utf8')
  console.log(`[compare] wrote ${outFile}`)
} else {
  console.log(md)
}
