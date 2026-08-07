#!/bin/sh
set -e

# Start Xvfb virtual display server on :99
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
export DISPLAY=:99

sleep 1

# Start lightweight window manager fluxbox
fluxbox >/dev/null 2>&1 &

# Start x11vnc VNC server on port 5900
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -quiet &

# Symlink vnc.html to index.html if needed
if [ -d "/usr/share/novnc" ] && [ ! -f "/usr/share/novnc/index.html" ]; then
  cp /usr/share/novnc/vnc.html /usr/share/novnc/index.html 2>/dev/null || true
fi

# Start noVNC websockify web server on port 6080
websockify --web /usr/share/novnc 6080 localhost:5900 >/dev/null 2>&1 &

echo "=========================================================================="
echo " 🎥 Live noVNC Browser Stream active at: http://0.0.0.0:6080/vnc.html"
echo "=========================================================================="

exec node dist/main.js "$@"
