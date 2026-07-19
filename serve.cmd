@echo off
rem 純麻雀サーバー起動 — iPhoneのSafariで http://192.168.1.19:8642 を開く
cd /d "%~dp0"
echo ============================================
echo  純麻雀 サーバー起動中
echo  このPCのブラウザ:  http://localhost:8642
echo  iPhone (同じWi-Fi): http://192.168.1.19:8642
echo  終了するにはこのウィンドウを閉じる
echo ============================================
py -m http.server 8642
