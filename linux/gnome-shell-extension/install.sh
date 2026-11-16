#!/usr/bin/env bash
# Cài tiện ích GNOME Shell của DopaDam vào thư mục người dùng (không cần sudo).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
uuid="dopadam@dang"
dest="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"
mkdir -p "$dest"
cp -f "$here/$uuid/"* "$dest/"
echo "Đã chép tiện ích vào: $dest"
echo
echo "Bước tiếp theo:"
echo "  1. Đăng xuất rồi đăng nhập lại (trên Wayland, GNOME Shell chỉ nạp tiện ích mới khi đăng nhập)."
echo "  2. Chạy: gnome-extensions enable $uuid"
echo "Chạy lại tập lệnh này bất cứ lúc nào để cập nhật; nó an toàn khi chạy nhiều lần."
