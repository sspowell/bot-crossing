/**
 * A quiet hum while you fly: a soft wash of low noise that opens up a little as you speed up,
 * under a slow, open chord. Everything is synthesised — no audio files — and it only starts after
 * you've clicked or pressed something, which browsers require anyway.
 */
export function createHum() {
  let ctx = null
  let master = null
  let wash = null
  let on = false

  function build() {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)

    // Brown noise: random steps, each leaning on the last — a low rumble rather than a hiss.
    const seconds = 4
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < data.length; i++) {
      last = (last + (Math.random() * 2 - 1) * 0.02) / 1.02
      data[i] = last * 3.2
    }
    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    noise.loop = true
    wash = ctx.createBiquadFilter()
    wash.type = 'lowpass'
    wash.frequency.value = 180
    const washGain = ctx.createGain()
    washGain.gain.value = 0.55
    noise.connect(wash).connect(washGain).connect(master)
    noise.start()

    // An open fifth plus a ninth, each voice breathing on its own slow cycle.
    for (const [freq, level, rate] of [[73.42, 0.05, 0.05], [110, 0.035, 0.07], [164.81, 0.022, 0.043], [246.94, 0.01, 0.031]]) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      const gain = ctx.createGain()
      gain.gain.value = level
      const lfo = ctx.createOscillator()
      lfo.frequency.value = rate
      const depth = ctx.createGain()
      depth.gain.value = level * 0.6
      lfo.connect(depth).connect(gain.gain)
      osc.connect(gain).connect(master)
      osc.start()
      lfo.start()
    }
  }

  function start() {
    if (!ctx) build()
    ctx.resume()
    on = true
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setTargetAtTime(0.5, ctx.currentTime, 1.2)
  }

  function stop() {
    on = false
    if (!ctx) return
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.4)
  }

  /** Speed in world units per second. */
  function setSpeed(speed) {
    if (!ctx || !on) return
    wash.frequency.setTargetAtTime(160 + Math.min(80, speed) * 9, ctx.currentTime, 0.3)
  }

  /** A rising swell while energy gathers. */
  function charge(seconds, strength = 1) {
    if (!ctx || !on) return
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(70, now)
    osc.frequency.exponentialRampToValueAtTime(260 + strength * 200, now + seconds)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(300, now)
    filter.frequency.exponentialRampToValueAtTime(1800, now + seconds)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.05 * strength, now + seconds)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds + 0.25)
    osc.connect(filter).connect(gain).connect(master)
    osc.start(now)
    osc.stop(now + seconds + 0.3)
  }

  /** A deep, soft impact — felt more than heard. */
  function boom(strength = 1) {
    if (!ctx || !on) return
    const now = ctx.currentTime
    const length = 1.2 + strength * 1.3
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(900 + strength * 600, now)
    filter.frequency.exponentialRampToValueAtTime(60, now + length)
    const gain = ctx.createGain()
    gain.gain.value = 0.35 * strength
    const thump = ctx.createOscillator()
    thump.frequency.setValueAtTime(90, now)
    thump.frequency.exponentialRampToValueAtTime(30, now + 0.6)
    const thumpGain = ctx.createGain()
    thumpGain.gain.setValueAtTime(0.25 * strength, now)
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8)
    src.connect(filter).connect(gain).connect(master)
    thump.connect(thumpGain).connect(master)
    src.start(now)
    thump.start(now)
    thump.stop(now + 0.9)
  }

  return {
    charge,
    boom,
    start,
    stop,
    setSpeed,
    get on() {
      return on
    },
  }
}
