import type { CommandTarget, MixerVolumes } from './pilot-types'

const CHANNEL_GAIN = 0.5

export class ExperimentAudioMixer {
  private ctx: AudioContext | null = null
  private gameGain: GainNode | null = null
  private voiceGain: GainNode | null = null
  private masterGain: GainNode | null = null
  private nodes: AudioNode[] = []

  async start(volumes: MixerVolumes): Promise<void> {
    if (this.ctx) {
      await this.ctx.resume()
      this.setVolumes(volumes)
      return
    }

    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) throw new Error('Web Audio API is not available')
    const ctx = new Ctx()
    this.ctx = ctx

    const master = ctx.createGain()
    const game = ctx.createGain()
    const voice = ctx.createGain()
    master.connect(ctx.destination)
    game.connect(master)
    voice.connect(master)
    this.masterGain = master
    this.gameGain = game
    this.voiceGain = voice
    this.setVolumes(volumes)

    const gameNodes = createGameLoop(ctx, game)
    const voiceNodes = createVoiceLoop(ctx, voice)

    this.nodes = [...gameNodes, ...voiceNodes, game, voice, master]
    await ctx.resume()
  }

  setVolumes(volumes: MixerVolumes): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    this.gameGain?.gain.setTargetAtTime(volumes.game * CHANNEL_GAIN, now, 0.02)
    this.voiceGain?.gain.setTargetAtTime(volumes.voice * CHANNEL_GAIN, now, 0.02)
    this.masterGain?.gain.setTargetAtTime(volumes.master, now, 0.02)
  }

  setVolume(target: CommandTarget, value: number, current: MixerVolumes): MixerVolumes {
    const next = { ...current, [target]: Math.max(0, Math.min(1, value)) }
    this.setVolumes(next)
    return next
  }

  tick(direction: 'up' | 'down'): void {
    if (!this.ctx || !this.masterGain) return
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = direction === 'up' ? 880 : 330
    gain.gain.setValueAtTime(0.0001, this.ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, this.ctx.currentTime + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.08)
    osc.connect(gain)
    gain.connect(this.ctx.destination)
    osc.start()
    osc.stop(this.ctx.currentTime + 0.09)
  }

  async stop(): Promise<void> {
    const ctx = this.ctx
    if (!ctx) return
    for (const node of this.nodes) {
      const source = node as AudioScheduledSourceNode
      if (typeof source.stop === 'function') {
        try {
          source.stop()
        } catch {
          /* already stopped */
        }
      }
      try {
        node.disconnect()
      } catch {
        /* already disconnected */
      }
    }
    this.nodes = []
    this.ctx = null
    this.gameGain = null
    this.voiceGain = null
    this.masterGain = null
    await ctx.close()
  }
}

function createGameLoop(ctx: AudioContext, destination: AudioNode): AudioNode[] {
  const mix = ctx.createGain()
  mix.gain.value = 0.28
  mix.connect(destination)

  const nodes: AudioNode[] = [mix]
  const freqs = [196, 246.94, 293.66, 392]
  freqs.forEach((freq, idx) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = idx % 2 === 0 ? 'triangle' : 'sine'
    osc.frequency.value = freq
    gain.gain.value = idx === 0 ? 0.11 : 0.045
    osc.connect(gain)
    gain.connect(mix)
    osc.start()
    nodes.push(osc, gain)
  })
  return nodes
}

function createVoiceLoop(ctx: AudioContext, destination: AudioNode): AudioNode[] {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < data.length; i++) {
    const envelope = 0.55 + 0.45 * Math.sin((2 * Math.PI * i) / (ctx.sampleRate * 0.42))
    last = last * 0.86 + (Math.random() * 2 - 1) * 0.14
    data[i] = last * envelope
  }

  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = true

  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 780
  filter.Q.value = 0.9

  const gain = ctx.createGain()
  gain.gain.value = 0.22

  source.connect(filter)
  filter.connect(gain)
  gain.connect(destination)
  source.start()

  return [source, filter, gain]
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}