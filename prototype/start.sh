#!/usr/bin/env bash
# เปิดเซิร์ฟเวอร์ดูต้นแบบ — รันจาก WSL:  bash start.sh
cd "$(dirname "$0")" || exit 1
PORT="${1:-8080}"
echo "เปิดที่  http://localhost:$PORT/"
echo "กด Ctrl+C เพื่อหยุด"
python3 -m http.server "$PORT"
