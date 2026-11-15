@echo off
chcp 65001 >nul
cd /d %~dp0
if not exist node_modules (
  echo 第一次執行，安裝套件中...
  call npm install
)
if not exist .env copy .env.example .env >nul
start "" http://localhost:3000
node server.js
pause
