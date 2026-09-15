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

  return {
    start,
    stop,
    setSpeed,
    get on() {
      return on
    },
  }
}
