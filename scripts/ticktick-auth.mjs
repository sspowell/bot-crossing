/**
 * One-time TickTick login for the colony.
 *
 *   node scripts/ticktick-auth.mjs            read-only: the colony can look at tasks
 *   node scripts/ticktick-auth.mjs --write    also lets you resolve tasks from the galaxy
 *
 * Opens TickTick's own consent page in your browser. You sign in and click Allow there — this
 * script never sees your password. TickTick hands back a one-time code to a tiny server this
 * script runs on your own machine, which trades it for an access token and saves it to
 * `data/ticktick-token.json`. That file is gitignored and never sent to the browser.
 *
 * Needs your developer app's client id and secret in `data/ticktick-app.json` (also gitignored).
 * Run it once with no such file and it writes a template and tells you what to paste where.
 */
import http from 'node:http'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(here, '..', 'data')
const APP_FILE = path.join(DATA, 'ticktick-app.json')
const TOKEN_FILE = path.join(DATA, 'ticktick-token.json')

const PORT = 5275
// 127.0.0.1 rather than "localhost": Windows may resolve localhost to IPv6 first, and the
// redirect has to match what's registered in the developer console character for character.
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`
// `--write` also grants `tasks:write`, which is what lets the galaxy's "Resolve" complete a task.
// Without it the colony can only look.
const SCOPE = process.argv.includes('--write') ? 'tasks:read tasks:write' : 'tasks:read'
const GIVE_UP_MS = 5 * 60_000

async function loadApp() {
  try {
    const app = JSON.parse(await fsp.readFile(APP_FILE, 'utf8'))
    if (app.client_id && app.client_secret && !String(app.client_id).startsWith('PASTE')) return app
  } catch {
    await fsp.mkdir(DATA, { recursive: true })
    await fsp.writeFile(
      APP_FILE,
      JSON.stringify({ client_id: 'PASTE_CLIENT_ID_HERE', client_secret: 'PASTE_CLIENT_SECRET_HERE' }, null, 2) + '\n'
    )
  }
  console.log(`
TickTick app credentials needed.

  1. Go to https://developer.ticktick.com and sign in
  2. Manage Apps → + App Name → give it any name (e.g. "Bot Crossing")
  3. Set the OAuth redirect URL to exactly:
       ${REDIRECT_URI}
  4. Copy the Client ID and Client Secret into:
       ${APP_FILE}
  5. Run this script again.
`)
  process.exit(1)
}

function openBrowser(url) {
  const opener =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  const child = spawn(opener[0], opener[1], { stdio: 'ignore', detached: true })
  child.on('error', () => {})
  child.unref()
}

async function exchange(app, code) {
  const res = await fetch('https://ticktick.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${app.client_id}:${app.client_secret}`).toString('base64'),
    },
    body: new URLSearchParams({
      client_id: app.client_id,
      client_secret: app.client_secret,
      code,
      grant_type: 'authorization_code',
      scope: SCOPE,
      redirect_uri: REDIRECT_URI,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    throw new Error(`Token exchange failed (${res.status}): ${body.error_description || body.error || 'no token returned'}`)
  }
  return body
}

const app = await loadApp()
const state = crypto.randomBytes(16).toString('hex')

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI)
  if (url.pathname !== '/callback') {
    res.writeHead(404).end()
    return
  }
  const page = (msg) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<body style="font:16px system-ui;padding:40px">${msg}</body>`)
  }
  try {
    if (url.searchParams.get('state') !== state) throw new Error('State mismatch — start the login again.')
    const code = url.searchParams.get('code')
    if (!code) throw new Error(url.searchParams.get('error') || 'TickTick did not send a code.')
    const token = await exchange(app, code)
    const saved = {
      access_token: token.access_token,
      token_type: token.token_type || 'bearer',
      scope: token.scope || SCOPE,
      obtained_at: new Date().toISOString(),
      expires_at: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
    }
    await fsp.writeFile(TOKEN_FILE, JSON.stringify(saved, null, 2) + '\n')
    page('Connected. You can close this tab — your colony will pick up TickTick within a minute.')
    console.log(`Saved token to ${TOKEN_FILE}${saved.expires_at ? ` (expires ${saved.expires_at})` : ''}`)
    server.close()
    process.exit(0)
  } catch (err) {
    page(`Login failed: ${err.message}`)
    console.error(err.message)
    server.close()
    process.exit(1)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  const authorize = new URL('https://ticktick.com/oauth/authorize')
  authorize.search = new URLSearchParams({
    scope: SCOPE,
    client_id: app.client_id,
    state,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
  }).toString()
  console.log(`Opening TickTick login. If no browser appears, open this yourself:\n\n${authorize}\n`)
  openBrowser(authorize.toString())
})

setTimeout(() => {
  console.error('Gave up waiting for TickTick after 5 minutes. Run the script again when ready.')
  process.exit(1)
}, GIVE_UP_MS).unref()
