@echo off
chcp 65001 >nul
cd /d "%~dp0.."
if not exist "apps\web\.env" if exist "apps\web\.env.example" copy "apps\web\.env.example" "apps\web\.env" >nul
if not exist "apps\pocketbase\.env" if exist "apps\pocketbase\.env.example" copy "apps\pocketbase\.env.example" "apps\pocketbase\.env" >nul

echo 🐳 Subindo PocketBase e SvelteKit via Docker Compose...
docker compose --env-file apps/web/.env up --build
