@echo off
rem Desktop-shortcut launcher: rebuilds from current source, then runs the
rem production server in a visible window rather than auto-starting at login
rem (see scripts\start-hidden.vbs for that alternative, currently unused).
rem
rem Rebuilding on every launch is what "syncs automatically" — the server
rem always serves whatever is in src\ right now, not whatever dist\ happened
rem to hold last time somebody remembered to build it.
rem
rem Binds to 0.0.0.0 rather than the default 127.0.0.1 so it's reachable over
rem Tailscale (and the local LAN) from other devices — see the README's
rem "Serving it to your network" section for what that exposes, since it has
rem no login of its own.
rem
rem Close this window (or Ctrl+C) to stop the server.
cd /d "C:\Users\Sherman\bot-crossing"
title Bot Crossing
echo Updating...
call npm run build
if errorlevel 1 (
  echo(
  echo Build failed - see the error above. Not starting a stale server.
  pause
  exit /b 1
)
echo(
set BOT_CROSSING_HOST=0.0.0.0
echo Starting Bot Crossing...
echo(
node server\serve.mjs
pause
