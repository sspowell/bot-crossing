/**
 * The radio.
 *
 * Three stations, each generating its own music as it plays: a chord progression, a drum pattern, a
 * bass line, and enough randomness that no two flights sound the same. Nothing is a recording —
 * every note is synthesised in the browser, so there are no audio files to ship and nothing to
 * license. Flipping stations tunes through a burst of static, the way a car radio does.
 *
 * Under the music sits a thin layer of wind that opens up with your speed, so flying still has
 * something to push against.
 *
 * Audio can only start after a click or a key — a browser rule — so nothing here runs until you
 * turn the radio on.
 */

const A4 = 440
const hz = (midi) => A4 * 2 ** ((midi - 69) / 12)

/** Each station: its tempo, the roots it walks through, its chord shape, and a scale for flourishes. */
const STATIONS = [
  {
    id: 'ambient',
    name: 'Deep Field FM',
    tag: 'ambient',
    tempo: 58,
    trim: 1.25,
    roots: [50, 53, 48, 55],
    chord: [0, 7, 14, 23],
    bells: [0, 3, 5, 7, 10, 12],
  },
  {
    id: 'lofi',
    name: 'Low Orbit Lo-Fi',
    tag: 'lo-fi beats',
    tempo: 78,
    trim: 0.8,
    roots: [50, 55, 48, 57],
    chord: [0, 3, 7, 10, 14],
    bells: [0, 3, 5, 7, 10],
  },
  {
    id: 'dub',
    name: 'Nebula Dub',
    tag: 'deep dub',
    tempo: 70,
    trim: 0.85,
    roots: [45, 45, 50, 43],
    chord: [0, 7, 10, 15],
    bells: [0, 5, 7, 10],
  },
]

export function createRadio() {
  let ctx = null
  let master = null // everything, at the volume you set
  let music = null // the music bus: tape-warm, lightly compressed
  let verb = null // shared reverb send
  let wind = null // the speed wash
  let windFilter = null
  let noise = null // one white-noise buffer, reused everywhere
  let meter = null // taps the output, so the interface can show it playing
  let on = false
  let index = 0

  // The station playing right now: its own gain, so stations can cross-fade, and its own effects.
  let live = null
  let timer = 0
  let beat = 0
  let nextBeatAt = 0

  // ── the plumbing ────────────────────────────────────────────────────────────────────
  function build() {
    ctx = new AudioContext()

    master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)

    meter = ctx.createAnalyser()
    meter.fftSize = 1024
    master.connect(meter)

    const squeeze = ctx.createDynamicsCompressor()
    squeeze.threshold.value = -18
    squeeze.ratio.value = 3
    squeeze.attack.value = 0.008
    squeeze.release.value = 0.25
    squeeze.connect(master)

    music = ctx.createGain()
    music.gain.value = 1
    // Tape warmth: nothing sparkly at the top, nothing rumbling at the bottom.
    const warm = ctx.createBiquadFilter()
    warm.type = 'lowpass'
    warm.frequency.value = 5200
    warm.Q.value = 0.4
    const trim = ctx.createBiquadFilter()
    trim.type = 'highpass'
    trim.frequency.value = 42
    music.connect(warm).connect(trim).connect(squeeze)

    // Reverb from a synthesised impulse: noise fading out over three seconds.
    const length = Math.floor(ctx.sampleRate * 3)
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate)
    for (let c = 0; c < 2; c++) {
      const data = impulse.getChannelData(c)
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.6
    }
    const convolver = ctx.createConvolver()
    convolver.buffer = impulse
    verb = ctx.createGain()
    verb.gain.value = 0.9
    verb.connect(convolver).connect(music)

    // White noise, two seconds, looped wherever noise is needed.
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const n = noise.getChannelData(0)
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1

    // Wind: a low wash that opens with speed, under everything else.
    const air = ctx.createBufferSource()
    air.buffer = noise
    air.loop = true
    windFilter = ctx.createBiquadFilter()
    windFilter.type = 'lowpass'
    windFilter.frequency.value = 180
    wind = ctx.createGain()
    wind.gain.value = 0.02
    air.connect(windFilter).connect(wind).connect(squeeze)
    air.start()
  }

  // ── small instruments ───────────────────────────────────────────────────────────────
  const env = (node, t, attack, hold, release, peak) => {
    const g = node.gain
    g.setValueAtTime(0.0001, t)
    g.linearRampToValueAtTime(peak, t + attack)
    if (hold) g.setValueAtTime(peak, t + attack + hold)
    g.exponentialRampToValueAtTime(0.0001, t + attack + hold + release)
  }

  const burst = (t, { length = 0.2, type = 'bandpass', freq = 1200, q = 1, level = 0.3, out, sweep = 0 }) => {
    const src = ctx.createBufferSource()
    src.buffer = noise
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.setValueAtTime(freq, t)
    if (sweep) filter.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), t + length)
    filter.Q.value = q
    const gain = ctx.createGain()
    env(gain, t, 0.004, 0, length, level)
    src.connect(filter).connect(gain).connect(out)
    src.start(t)
    src.stop(t + length + 0.1)
  }

  const tone = (t, midi, { length = 0.5, type = 'sine', level = 0.2, attack = 0.01, out, detune = 0, glide = 0, cutoff = 0, send = 0 }) => {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(hz(midi + glide), t)
    if (glide) osc.frequency.exponentialRampToValueAtTime(hz(midi), t + Math.min(0.3, length))
    if (detune) osc.detune.value = detune
    const gain = ctx.createGain()
    env(gain, t, attack, Math.max(0, length - attack - length * 0.4), length * 0.5, level)
    let node = osc
    if (cutoff) {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(cutoff, t)
      filter.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.4), t + length)
      node = osc.connect(filter)
    }
    node.connect(gain).connect(out)
    if (send) {
      const wet = ctx.createGain()
      wet.gain.value = send
      gain.connect(wet).connect(verb)
    }
    osc.start(t)
    osc.stop(t + length + 0.3)
  }

  const kick = (t, out, level = 0.7) => {
    const osc = ctx.createOscillator()
    osc.frequency.setValueAtTime(120, t)
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.14)
    const gain = ctx.createGain()
    env(gain, t, 0.004, 0.02, 0.24, level)
    osc.connect(gain).connect(out)
    osc.start(t)
    osc.stop(t + 0.45)
    burst(t, { length: 0.03, type: 'lowpass', freq: 400, level: level * 0.25, out })
  }

  // ── stations ────────────────────────────────────────────────────────────────────────
  /** Whatever a station needs beyond the shared bus: vinyl hiss, a dub delay. */
  function openStation(station) {
    const gain = ctx.createGain()
    gain.gain.value = 0
    gain.connect(music)
    gain.gain.linearRampToValueAtTime(station.trim, ctx.currentTime + 1.2)
    const extras = { gain, parts: [] }

    if (station.id === 'lofi') {
      const hiss = ctx.createBufferSource()
      hiss.buffer = noise
      hiss.loop = true
      const shape = ctx.createBiquadFilter()
      shape.type = 'bandpass'
      shape.frequency.value = 3400
      shape.Q.value = 0.6
      const level = ctx.createGain()
      level.gain.value = 0.035
      hiss.connect(shape).connect(level).connect(gain)
      hiss.start()
      extras.parts.push(hiss)
    }

    if (station.id === 'dub') {
      // Three-quarters of a beat, fed back on itself, band-passed so the echoes get darker.
      const delay = ctx.createDelay(2)
      delay.delayTime.value = (60 / station.tempo) * 0.75
      const feedback = ctx.createGain()
      feedback.gain.value = 0.52
      const tint = ctx.createBiquadFilter()
      tint.type = 'bandpass'
      tint.frequency.value = 900
      tint.Q.value = 0.8
      delay.connect(tint).connect(feedback).connect(delay)
      tint.connect(gain)
      extras.echo = ctx.createGain()
      extras.echo.gain.value = 0.7
      extras.echo.connect(delay)
    }
    return extras
  }

  function closeStation(old) {
    if (!old) return
    const t = ctx.currentTime
    old.extras.gain.gain.cancelScheduledValues(t)
    old.extras.gain.gain.setTargetAtTime(0, t, 0.25)
    setTimeout(() => {
      for (const part of old.extras.parts) {
        try {
          part.stop()
        } catch {}
      }
      old.extras.gain.disconnect()
    }, 2500)
  }

  /** One beat of a station, lined up a fraction of a second before it should sound. */
  function playBeat(station, extras, b, t) {
    const spb = 60 / station.tempo
    const bar = Math.floor(b / 4)
    const inBar = b % 4
    const root = station.roots[Math.floor(b / 8) % station.roots.length]
    const out = extras.gain
    const swing = spb * 0.06

    if (station.id === 'ambient') {
      // A pad that changes every four bars, a drone underneath, and the odd bell.
      if (b % 16 === 0) {
        for (const step of station.chord) {
          tone(t, root + step, { length: 17, type: 'triangle', level: 0.085, attack: 5, out, send: 0.6, detune: (Math.random() - 0.5) * 8 })
          tone(t + 0.4, root + step + 12, { length: 15, type: 'sine', level: 0.04, attack: 6, out, send: 0.8 })
        }
      }
      if (b % 8 === 0) tone(t, root - 12, { length: 9, type: 'sine', level: 0.16, attack: 3, out })
      if (b % 4 === 2 && Math.random() < 0.55) {
        const note = station.bells[Math.floor(Math.random() * station.bells.length)]
        tone(t + Math.random() * spb, root + 24 + note, { length: 3.5, type: 'sine', level: 0.085, attack: 0.01, out, send: 1 })
      }
      return
    }

    if (station.id === 'lofi') {
      // Boom-bap with a lazy swing: kick and snare, hats on the eighths, warm bass, soft keys.
      if (inBar === 0 || inBar === 2) kick(t, out, inBar === 0 ? 0.75 : 0.5)
      if (inBar === 2 && Math.random() < 0.4) kick(t + spb * 0.75, out, 0.35)
      if (inBar === 1 || inBar === 3) burst(t, { length: 0.16, freq: 1700, q: 0.8, level: 0.22, out, sweep: 0.5 })
      burst(t, { length: 0.05, type: 'highpass', freq: 7200, level: 0.06, out })
      burst(t + spb * 0.5 + swing, { length: 0.04, type: 'highpass', freq: 8200, level: 0.045, out })
      if (inBar === 0 || inBar === 2) tone(t, root - 12, { length: spb * 1.4, type: 'triangle', level: 0.3, attack: 0.02, out, cutoff: 420, glide: inBar === 0 ? 0 : -0.2 })
      if (inBar === 3 && Math.random() < 0.5) tone(t + spb * 0.5, root - 5, { length: spb * 0.5, type: 'triangle', level: 0.22, attack: 0.02, out, cutoff: 380 })
      if (inBar === 0 || inBar === 2) {
        const late = inBar === 0 ? spb * 0.5 + swing : spb * 0.25
        for (const step of station.chord.slice(1)) {
          tone(t + late, root + 12 + step, { length: 1.1, type: 'sine', level: 0.075, attack: 0.02, out, send: 0.3, detune: (Math.random() - 0.5) * 6 })
        }
      }
      if (bar % 4 === 3 && inBar === 3) burst(t + spb * 0.5, { length: 0.4, freq: 2400, q: 0.5, level: 0.06, out, sweep: 0.3 })
      return
    }

    // Dub: deep and sparse, with everything off the beat disappearing into the echo.
    if (inBar === 0) kick(t, out, 0.85)
    if (inBar === 2) kick(t, out, 0.6)
    if (inBar === 1 || inBar === 3) burst(t, { length: 0.08, freq: 420, q: 4, level: 0.16, out })
    if (inBar === 0) tone(t, root - 12, { length: spb * 2.6, type: 'sine', level: 0.42, attack: 0.03, out, cutoff: 260 })
    if (inBar === 2) tone(t, root - 2, { length: spb * 1.2, type: 'sine', level: 0.3, attack: 0.03, out, cutoff: 240 })
    if (inBar === 1 || inBar === 3) {
      for (const step of station.chord) {
        tone(t + spb * 0.5, root + 12 + step, { length: 0.28, type: 'square', level: 0.045, attack: 0.005, out: extras.echo || out, cutoff: 1600 })
      }
    }
    if (bar % 8 === 7 && inBar === 3) burst(t, { length: 1.6, freq: 3000, q: 0.6, level: 0.05, out: extras.echo || out, sweep: 0.15 })
  }

  /** Tuning static, for the moment between one station and the next. */
  function staticSweep() {
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = noise
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(700, t)
    filter.frequency.exponentialRampToValueAtTime(2600, t + 0.45)
    filter.Q.value = 1.6
    const gain = ctx.createGain()
    env(gain, t, 0.02, 0.18, 0.3, 0.1)
    src.connect(filter).connect(gain).connect(master)
    src.start(t)
    src.stop(t + 0.7)
  }

  // ── the scheduler ───────────────────────────────────────────────────────────────────
  // Beats are scheduled slightly ahead against the audio clock, so the groove never wobbles even
  // while the galaxy is busy drawing.
  function tick() {
    if (!live) return
    const spb = 60 / live.station.tempo
    const horizon = ctx.currentTime + 0.35
    while (nextBeatAt < horizon) {
      playBeat(live.station, live.extras, beat, Math.max(nextBeatAt, ctx.currentTime + 0.02))
      beat++
      nextBeatAt += spb
    }
  }

  function tuneTo(i, { quiet = false } = {}) {
    index = ((i % STATIONS.length) + STATIONS.length) % STATIONS.length
    const station = STATIONS[index]
    if (!on) return station
    const old = live
    if (!quiet) staticSweep()
    live = { station, extras: openStation(station) }
    beat = 0
    nextBeatAt = ctx.currentTime + (quiet ? 0.2 : 0.5)
    closeStation(old)
    return station
  }

  function start() {
    if (!ctx) build()
    ctx.resume()
    on = true
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setTargetAtTime(0.55, ctx.currentTime, 0.8)
    if (!live) tuneTo(index, { quiet: true })
    clearInterval(timer)
    timer = setInterval(tick, 40)
  }

  function stop() {
    on = false
    if (!ctx) return
    clearInterval(timer)
    timer = 0
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.3)
    const closing = live
    live = null
    setTimeout(() => closeStation(closing), 900)
  }

  /** Speed in world units per second: this moves the wind, not the music. */
  function setSpeed(speed) {
    if (!ctx || !on) return
    const v = Math.min(80, speed) / 80
    windFilter.frequency.setTargetAtTime(150 + v * 700, ctx.currentTime, 0.3)
    wind.gain.setTargetAtTime(0.015 + v * 0.05, ctx.currentTime, 0.4)
  }

  /** Pull the music down for a moment so an attack lands over the top of it. */
  function duck(amount, seconds) {
    if (!ctx || !on) return
    music.gain.cancelScheduledValues(ctx.currentTime)
    music.gain.setTargetAtTime(1 - amount, ctx.currentTime, 0.08)
    music.gain.setTargetAtTime(1, ctx.currentTime + seconds, 0.4)
  }

  /** A rising swell while energy gathers. */
  function charge(seconds, strength = 1) {
    if (!ctx || !on) return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(70, t)
    osc.frequency.exponentialRampToValueAtTime(240 + strength * 200, t + seconds)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(320, t)
    filter.frequency.exponentialRampToValueAtTime(1900, t + seconds)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.06 * strength, t + seconds)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.3)
    osc.connect(filter).connect(gain).connect(master)
    osc.start(t)
    osc.stop(t + seconds + 0.35)
    duck(0.25 * strength, seconds)
  }

  /** A deep, soft impact — felt more than heard. */
  function boom(strength = 1) {
    if (!ctx || !on) return
    const t = ctx.currentTime
    const length = 1.2 + strength * 1.3
    const src = ctx.createBufferSource()
    src.buffer = noise
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(900 + strength * 600, t)
    filter.frequency.exponentialRampToValueAtTime(60, t + length)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.32 * strength, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length)
    const thump = ctx.createOscillator()
    thump.frequency.setValueAtTime(90, t)
    thump.frequency.exponentialRampToValueAtTime(30, t + 0.6)
    const thumpGain = ctx.createGain()
    thumpGain.gain.setValueAtTime(0.28 * strength, t)
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.8)
    src.connect(filter).connect(gain).connect(master)
    thump.connect(thumpGain).connect(master)
    src.start(t)
    src.stop(t + length + 0.2)
    thump.start(t)
    thump.stop(t + 0.9)
    duck(0.45 * strength, 0.5 + strength * 0.4)
  }

  return {
    start,
    stop,
    setSpeed,
    charge,
    boom,
    tuneTo,
    stations: STATIONS.map(({ id, name, tag }) => ({ id, name, tag })),
    next: () => tuneTo(index + 1),
    prev: () => tuneTo(index - 1),
    setStationId: (id) => tuneTo(Math.max(0, STATIONS.findIndex((station) => station.id === id))),
    get station() {
      return STATIONS[index]
    },
    /** How loud it is right now, 0 to about 1 — for a level display, or for checking it plays. */
    get level() {
      if (!ctx || !on) return 0
      const data = new Float32Array(meter.fftSize)
      meter.getFloatTimeDomainData(data)
      let sum = 0
      for (const v of data) sum += v * v
      return Math.sqrt(sum / data.length)
    },
    get on() {
      return on
    },
  }
}
