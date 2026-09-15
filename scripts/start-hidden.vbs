' Launches the Bot Crossing production server with no visible console window.
' Used by the "BotCrossing" Scheduled Task so it starts automatically at logon.
'
' Binds to 0.0.0.0 rather than the default 127.0.0.1 so it's reachable over
' Tailscale (and the local LAN) from other devices, per the project's own
' README warning that this has no login of its own — do not port-forward it
' to the public internet.

Set objShell = CreateObject("WScript.Shell")
repoDir = "C:\Users\Sherman\bot-crossing"
objShell.CurrentDirectory = repoDir
objShell.Environment("Process")("BOT_CROSSING_HOST") = "0.0.0.0"
objShell.Run "cmd /c node server\serve.mjs >> logs\server.log 2>&1", 0, False
