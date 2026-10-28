#!/usr/bin/env bash
# Liora · 灵探 SQLite 管理员密码重置。
# 用法：./reset-password.sh
# 数据库使用 LIORA_SQLITE_PATH / LIORA_CONFIG / data/liora.db。
# 密码仅经标准输入传给程序，不进入命令行或环境变量。
set -euo pipefail
cd "$(dirname "$0")"
case "${1:-}" in
  -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
esac
[[ $# -eq 0 ]] || { echo "用法：$0" >&2; exit 1; }
read -r -s -p "Liora 新密码（8–72 字节）：" password; echo >&2
read -r -s -p "再次输入新密码：" confirmation; echo >&2
[[ "$password" == "$confirmation" ]] || { echo "两次密码不一致" >&2; exit 1; }
if [[ -x ./liora ]]; then
  printf '%s\n' "$password" | ./liora -reset-password
elif [[ -x ./liora.exe ]]; then
  printf '%s\n' "$password" | ./liora.exe -reset-password
else
  printf '%s\n' "$password" | go run ./cmd/liora -reset-password
fi
unset password confirmation
