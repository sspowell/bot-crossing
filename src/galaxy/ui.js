/**
 * Everything drawn in HTML over the sky: the untangle meter, sun names, the card for a
 * selected world, the panel for a focused system, filters, and toasts.
 *
 * It only ever describes what the web already shows. If this layer and the stars disagree about
 * a task, that's a bug — both read the same `stateOf`.
 */
import { stateOf } from './solar.js'

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const STATE_WORD = { tangled: 'Tangled · falling sunward', asking: 'Asking for you', drifting: 'In orbit' }

export const FILTERS = [
  { id: 'all', label: 'Everything', test: null },
  { id: 'tangled', label: 'Tangled', test: (t) => t.state === 'tangled' },
  { id: 'asking', label: 'Asking', test: (t) => t.state === 'asking' },
  { id: 'heavy', label: 'Heavy', test: (t) => (Number(t.thread.urgency) || 0) >= 0.4 },
  { id: 'woven', label: 'Woven', test: null }, // set at runtime: thoughts on a cross-node thread
]

export function createUi(root, actions) {
  root.insertAdjacentHTML(
    'beforeend',
    `
    <div class="g-cursor" aria-hidden="true"></div>
    <header class="g-top">
      <div class="g-brand">
        <span class="g-mark">✦</span>
        <div>
          <div class="g-title">thought galaxy</div>
          <div class="g-sub">untangle the orbits</div>
        </div>
      </div>
      <div class="g-meter" role="group" aria-label="State of the web">
        <button class="g-stat tangled" data-filter="tangled"><b>0</b><span>tangled</span></button>
        <button class="g-stat asking" data-filter="asking"><b>0</b><span>asking</span></button>
        <button class="g-stat calm" data-filter="all"><b>0</b><span>thoughts</span></button>
      </div>
      <div class="g-progress" title="Share of thoughts that aren't tangled or asking"><i></i></div>
      <div class="g-history" title="Tangled thoughts per day"><svg viewBox="0 0 120 28" preserveAspectRatio="none"><path class="line"/><circle class="dot" r="2"/></svg><span></span></div>
      <div class="g-actions">
        <button class="g-action capture" data-act="openCapture" hidden title="Add a thought (C)">＋ thought</button>
        <button class="g-action focus" data-act="enterFocus" title="One thought at a time (F)">Focus</button>
        <button class="g-action roll" data-act="pickRandom" title="Pick a random task (D)">Random</button>
        <button class="g-action fly" data-act="toggleFlight" title="Take flight (V)">Fly</button>
        <button class="g-action gear" data-act="toggleSettings" aria-label="Display settings" title="Display settings">⚙</button>
      </div>
    </header>

    <div class="g-settings" hidden>
      <div class="g-set-row"><span>Glow</span>
        <div class="g-seg" data-setting="bloom"><button data-value="on">On</button><button data-value="off">Off</button></div>
      </div>
      <div class="g-set-row"><span>Detail</span>
        <div class="g-seg" data-setting="detail"><button data-value="low">Low</button><button data-value="balanced">Balanced</button><button data-value="high">High</button></div>
      </div>
    </div>

    <form class="g-capture" hidden autocomplete="off">
      <input class="g-capture-input" maxlength="200" placeholder="a thought, in a few words…" aria-label="New thought" />
      <select class="g-capture-list" aria-label="Which list"></select>
      <button class="g-btn resolve" type="submit">Release</button>
    </form>

    <div class="g-labels" aria-hidden="true"></div>
    <div class="g-tooltip" hidden></div>

    <article class="g-card" hidden>
      <div class="g-card-node"><i></i><span></span></div>
      <h2 class="g-card-title"></h2>
      <div class="g-card-state"></div>
      <p class="g-card-notes"></p>
      <div class="g-card-tags"></div>
      <div class="g-card-actions">
        <button class="g-btn ghost" data-act="open">Open in TickTick</button>
        <button class="g-btn resolve" data-act="resolve">Resolve</button>
      </div>
      <div class="g-card-hint"></div>
      <div class="g-card-focus" hidden>
        <span class="g-focus-count"></span>
        <button class="g-btn ghost" data-act="skipFocus">Not now</button>
        <button class="g-btn ghost" data-act="exitFocus">Leave focus</button>
      </div>
      <button class="g-close" data-act="dismiss" aria-label="Close">×</button>
    </article>

    <aside class="g-panel" hidden>
      <button class="g-back" data-act="unfocus">← all systems</button>
      <h2 class="g-panel-title"></h2>
      <div class="g-panel-sub"></div>
      <ol class="g-panel-list"></ol>
    </aside>

    <nav class="g-filters" aria-label="Filter thoughts"></nav>
    <div class="g-flight" hidden>
      <div class="g-flight-near" aria-live="polite"></div>
      <div class="g-flight-keys"><kbd>W</kbd><kbd>S</kbd> fly · <kbd>A</kbd><kbd>D</kbd> turn · <kbd>R</kbd><kbd>F</kbd> rise / sink · <kbd>Shift</kbd> power up · <kbd>E</kbd> land · click a world to fly there · <kbd>Esc</kbd> stop</div>
      <div class="g-flight-row">
        <button class="g-chip g-flight-sound" data-act="toggleSound">Sound off</button>
        <button class="g-chip" data-act="toggleFlight">Stop flying</button>
      </div>
    </div>
    <div class="g-hint">drag a world onto another sun to move it · <kbd>N</kbd> next tangle · <kbd>F</kbd> focus · <kbd>D</kbd> random · <kbd>V</kbd> fly · <kbd>C</kbd> capture · <kbd>Esc</kbd> release</div>
    <a class="g-colony" href="/colony">colony view ↗</a>
    <div class="g-toast" role="status"></div>
    <div class="g-empty" hidden>
      <div class="g-title">the systems are quiet</div>
      <div class="g-sub">No open thoughts found. Add something in TickTick and it will appear here.</div>
    </div>
  `
  )

  const $ = (s) => root.querySelector(s)
  const labelsEl = $('.g-labels')
  const tooltip = $('.g-tooltip')
  const card = $('.g-card')
  const panel = $('.g-panel')
  const toastEl = $('.g-toast')
  const cursor = $('.g-cursor')

  // Filters
  const filterNav = $('.g-filters')
  for (const f of FILTERS) {
    const b = document.createElement('button')
    b.className = 'g-chip'
    b.dataset.filter = f.id
    b.textContent = f.label
    filterNav.appendChild(b)
  }
  root.addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]')
    if (f) actions.filter(f.dataset.filter)
    const act = e.target.closest('[data-act]')
    if (act) actions[act.dataset.act]?.()
    const item = e.target.closest('[data-thought]')
    if (item) actions.selectThought(item.dataset.thought)
    const seg = e.target.closest('.g-seg button')
    if (seg) actions.setSetting(seg.parentElement.dataset.setting, seg.dataset.value)
  })

  const captureForm = $('.g-capture')
  const captureInput = $('.g-capture-input')
  const captureList = $('.g-capture-list')
  captureForm.addEventListener('submit', (e) => {
    e.preventDefault()
    const title = captureInput.value.trim()
    if (!title) return
    actions.submitCapture(title, captureList.value, captureList.selectedOptions[0]?.dataset.node || '')
    captureInput.value = ''
  })
  captureInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeCapture()
    }
  })

  function openCapture(lists, preferred) {
    captureList.innerHTML =
      `<option value="" data-node="">Inbox</option>` +
      lists.map((l) => `<option value="${esc(l.id)}" data-node="${esc(l.name)}">${esc(l.name)}</option>`).join('')
    const pick = lists.find((l) => l.name === preferred)
    if (pick) captureList.value = pick.id
    captureForm.hidden = false
    requestAnimationFrame(() => captureInput.focus())
  }
  function closeCapture() {
    captureForm.hidden = true
    captureInput.blur()
  }

  function setWritable(on) {
    $('.g-action.capture').hidden = !on
  }

  function setSettings({ bloom, detail }) {
    for (const b of root.querySelectorAll('[data-setting="bloom"] button')) b.classList.toggle('on', b.dataset.value === (bloom ? 'on' : 'off'))
    for (const b of root.querySelectorAll('[data-setting="detail"] button')) b.classList.toggle('on', b.dataset.value === detail)
  }
  function toggleSettings(force) {
    const el = $('.g-settings')
    el.hidden = typeof force === 'boolean' ? !force : !el.hidden
  }

  /**
   * The daily record: a quiet line of tangled counts, and the change over the last week. With a
   * single day of data there's no line to draw — say that instead of drawing a flat one.
   */
  function setHistory(days) {
    const el = $('.g-history')
    const text = el.querySelector('span')
    if (days.length < 2) {
      el.classList.add('empty')
      text.textContent = 'history starts today'
      return
    }
    el.classList.remove('empty')
    const recent = days.slice(-14)
    const max = Math.max(1, ...recent.map((d) => d.tangled))
    const pts = recent.map((d, i) => [(i / (recent.length - 1)) * 116 + 2, 24 - (d.tangled / max) * 20])
    el.querySelector('.line').setAttribute('d', 'M' + pts.map((p) => p.map((n) => n.toFixed(1)).join(' ')).join(' L'))
    const [lx, ly] = pts[pts.length - 1]
    el.querySelector('.dot').setAttribute('cx', lx)
    el.querySelector('.dot').setAttribute('cy', ly)
    const weekAgo = days[Math.max(0, days.length - 8)]
    const delta = days[days.length - 1].tangled - weekAgo.tangled
    text.textContent = delta < 0 ? `${-delta} fewer tangled` : delta > 0 ? `${delta} more tangled` : 'holding steady'
    el.classList.toggle('better', delta < 0)
    el.classList.toggle('worse', delta > 0)
  }

  function setFlight(on) {
    $('.g-flight').hidden = !on
    root.classList.toggle('flight-mode', on)
    $('.g-action.fly').textContent = on ? 'Stop flying' : 'Fly'
    if (!on) setFlightNear(null)
  }

  /** What you're flying beside: a world you could land on, or the one you're sitting with. */
  function setFlightNear(info) {
    const el = $('.g-flight-near')
    if (!info) {
      el.className = 'g-flight-near'
      el.textContent = ''
      return
    }
    const { thought, landed } = info
    el.className = `g-flight-near show ${thought.state}`
    el.innerHTML = landed
      ? `Sitting with <b>${esc(thought.thread.title)}</b> · <kbd>E</kbd> or <kbd>W</kbd> to fly on`
      : `<kbd>E</kbd> land beside <b>${esc(thought.thread.title)}</b>`
  }

  function setSound(on) {
    $('.g-flight-sound').textContent = on ? 'Sound on' : 'Sound off'
    $('.g-flight-sound').classList.toggle('on', on)
  }

  function setFocus(info) {
    const row = card.querySelector('.g-card-focus')
    row.hidden = !info
    root.classList.toggle('focus-mode', Boolean(info))
    if (info) row.querySelector('.g-focus-count').textContent = `${info.index + 1} of ${info.total}`
  }

  // A soft light that trails the pointer — the only "effect" that isn't data, and it only
  // ever follows your hand.
  let cx = innerWidth / 2
  let cy = innerHeight / 2
  let tx = cx
  let ty = cy
  addEventListener('pointermove', (e) => {
    tx = e.clientX
    ty = e.clientY
  })

  const labels = new Map()

  function setFilter(id) {
    for (const b of root.querySelectorAll('[data-filter]')) b.classList.toggle('on', b.dataset.filter === id)
  }

  function setMeter({ tangled, asking, total }) {
    $('.g-stat.tangled b').textContent = tangled
    $('.g-stat.asking b').textContent = asking
    $('.g-stat.calm b').textContent = total
    const calm = total ? (total - tangled - asking) / total : 1
    $('.g-progress i').style.transform = `scaleX(${calm})`
    $('.g-empty').hidden = total > 0
  }

  function syncLabels(web) {
    for (const [name, n] of web.nodes) {
      let el = labels.get(name)
      if (!el) {
        el = document.createElement('button')
        el.className = 'g-label'
        el.innerHTML = `<i></i><span class="n"></span><span class="c"></span>`
        el.addEventListener('click', () => actions.focusNode(name))
        labelsEl.appendChild(el)
        labels.set(name, el)
      }
      const list = [...web.thoughts.values()].filter((t) => t.node === name && !t.leaving)
      const tangled = list.filter((t) => t.state === 'tangled').length
      const asking = list.filter((t) => t.state === 'asking').length
      el.querySelector('i').style.background = `#${n.color.getHexString()}`
      el.querySelector('.n').textContent = name
      el.querySelector('.c').textContent =
        `${list.length} thought${list.length === 1 ? '' : 's'}` +
        (tangled ? ` · ${tangled} tangled` : '') +
        (asking ? ` · ${asking} asking` : '')
    }
    for (const [name, el] of labels) {
      if (!web.nodes.has(name)) {
        el.remove()
        labels.delete(name)
      }
    }
  }

  function placeLabels(web, focusNode) {
    for (const [name, el] of labels) {
      const n = web.nodes.get(name)
      if (!n) continue
      const s = web.screenOf(n.pos)
      const fade = Math.max(0, Math.min(1, (1100 - s.depth) / 350)) * Math.min(1, n.glow)
      const dim = focusNode && focusNode !== name ? 0.2 : 1
      el.style.opacity = s.visible ? (fade * dim).toFixed(3) : '0'
      el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${(s.y + 18 + Math.min(320, (n.radius || 0) * s.ppu * 1.9)).toFixed(1)}px, 0) translate(-50%, 0)`
      el.style.pointerEvents = s.visible && fade * dim > 0.3 ? 'auto' : 'none'
    }
  }

  function showTooltip(web, h, x, y) {
    if (!h || h.kind !== 'thought') {
      tooltip.hidden = true
      return
    }
    const t = web.thoughts.get(h.id)
    if (!t) return
    tooltip.hidden = false
    tooltip.className = `g-tooltip ${t.state}`
    tooltip.textContent = t.thread.title
    tooltip.style.transform = `translate3d(${x + 16}px, ${y - 14}px, 0)`
  }

  function fillCard(web, id) {
    const t = web.thoughts.get(id)
    if (!t) {
      card.hidden = true
      return
    }
    const node = web.nodes.get(t.node)
    card.hidden = false
    card.dataset.state = t.state
    card.querySelector('.g-card-node i').style.background = node ? `#${node.color.getHexString()}` : '#fff'
    card.querySelector('.g-card-node span').textContent = t.node
    card.querySelector('.g-card-title').textContent = t.thread.title
    const parts = [STATE_WORD[stateOf(t.thread)]]
    if (t.thread.model) parts.push(t.thread.model)
    if (t.thread.effort) parts.push(t.thread.effort)
    card.querySelector('.g-card-state').textContent = parts.join(' · ')
    const notes = card.querySelector('.g-card-notes')
    notes.textContent = t.thread.preview || ''
    notes.hidden = !t.thread.preview
    card.querySelector('.g-card-tags').innerHTML = (t.thread.tags || []).map((g) => `<span>#${esc(g)}</span>`).join('')
    const resolve = card.querySelector('[data-act="resolve"]')
    resolve.disabled = !t.thread.canResolve
    card.querySelector('.g-card-hint').textContent = t.thread.canResolve
      ? ''
      : 'Resolving from here is off — run the TickTick login with --write to turn it on.'
    card.querySelector('[data-act="open"]').disabled = !t.thread.canOpen
  }

  function placeCard(web, id) {
    const t = web.thoughts.get(id)
    if (!t || card.hidden) return
    const s = web.screenOf(t.world)
    const w = card.offsetWidth || 320
    const h = card.offsetHeight || 200
    const panelRoom = panel.hidden ? 0 : 340
    // Clear the planet itself (and its rings, if it has them), not just its centre.
    const clear = 28 + Math.min(260, (t.size || 1) * s.ppu * 2.5)
    let x = s.x + clear
    let y = s.y - h / 2
    if (x + w > innerWidth - panelRoom - 16) x = s.x - w - clear
    x = Math.max(16, Math.min(innerWidth - w - 16, x))
    y = Math.max(84, Math.min(innerHeight - h - 90, y))
    card.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
    card.style.opacity = s.visible ? '1' : '0'
  }

  /** While sitting with a task in flight, the card waits at the right edge, clear of you and the world. */
  function dockCard() {
    if (card.hidden) return
    const w = card.offsetWidth || 320
    const h = card.offsetHeight || 200
    const x = innerWidth > 760 ? innerWidth - w - 32 : 16
    const y = innerWidth > 760 ? Math.max(84, innerHeight / 2 - h / 2) : 84
    card.style.transform = `translate3d(${x}px, ${y}px, 0)`
    card.style.opacity = '1'
  }

  let panelSig = ''
  function fillPanel(web, name) {
    if (!name) {
      panel.hidden = true
      panelSig = ''
      return
    }
    const node = web.nodes.get(name)
    const order = { tangled: 0, asking: 1, drifting: 2 }
    const list = [...web.thoughts.values()]
      .filter((t) => t.node === name && !t.leaving)
      .sort((a, b) => order[a.state] - order[b.state] || (Number(b.thread.urgency) || 0) - (Number(a.thread.urgency) || 0))
    // Rebuilding the list on every poll would swallow a click or keyboard focus mid-gesture —
    // only redraw when something in it actually changed.
    const sig = name + '|' + list.map((t) => `${t.id}:${t.state}:${t.thread.title}:${t.thread.model}`).join('|')
    panel.hidden = false
    if (sig === panelSig) return
    panelSig = sig
    panel.querySelector('.g-panel-title').textContent = name
    panel.querySelector('.g-panel-title').style.setProperty('--hue', node ? `#${node.color.getHexString()}` : '#fff')
    const tangled = list.filter((t) => t.state === 'tangled').length
    panel.querySelector('.g-panel-sub').textContent =
      `${list.length} thought${list.length === 1 ? '' : 's'}` + (tangled ? ` · ${tangled} tangled` : ' · nothing tangled')
    panel.querySelector('.g-panel-list').innerHTML = list
      .map(
        (t) => `<li><button class="${t.state}" data-thought="${esc(t.id)}"><i></i><span class="t">${esc(t.thread.title)}</span><span class="m">${esc(t.thread.model || '')}</span></button></li>`
      )
      .join('')
  }

  let toastTimer = 0
  function toast(msg, kind = '') {
    toastEl.textContent = msg
    toastEl.className = `g-toast show ${kind}`
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toastEl.className = 'g-toast'), 3600)
  }

  function frame(dt) {
    const k = 1 - Math.exp(-dt * 14)
    cx += (tx - cx) * k
    cy += (ty - cy) * k
    cursor.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`
  }

  return {
    setFilter, setMeter, syncLabels, placeLabels, showTooltip, fillCard, placeCard, dockCard, fillPanel, toast, frame, card, panel,
    openCapture, closeCapture, setWritable, setSettings, toggleSettings, setHistory, setFocus, setFlight, setFlightNear, setSound,
    get capturing() {
      return !captureForm.hidden
    },
  }
}
