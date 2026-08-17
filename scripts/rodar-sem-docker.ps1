# Script para rodar o projeto sem Docker (PocketBase.exe local + SvelteKit)

$ProjectRoot = Resolve-Path "$PSScriptRoot\.."
$PbExe = "$ProjectRoot\apps\pocketbase\pocketbase.exe"
$PbData = "$ProjectRoot\apps\pocketbase\pb_data"
$PbMigrations = "$ProjectRoot\apps\pocketbase\pb_migrations"
$PbEnvFile = "$ProjectRoot\apps\pocketbase\.env"

# Auto-setup .env se necessário
$WebEnv = "$ProjectRoot\apps\web\.env"
$WebEnvEx = "$ProjectRoot\apps\web\.env.example"
if (-not (Test-Path $WebEnv) -and (Test-Path $WebEnvEx)) { Copy-Item $WebEnvEx $WebEnv }

$PbEnvEx = "$ProjectRoot\apps\pocketbase\.env.example"
if (-not (Test-Path $PbEnvFile) -and (Test-Path $PbEnvEx)) { Copy-Item $PbEnvEx $PbEnvFile }

# Auto-setup node_modules se necessário
$NodeModules = "$ProjectRoot\apps\web\node_modules"
if (-not (Test-Path $NodeModules)) {
    Write-Host "📦 Primeira execução detectada! Instalando dependências..." -ForegroundColor Yellow
    Set-Location "$ProjectRoot\apps\web"
    npm install
    Set-Location $ProjectRoot
}

# Carrega variáveis de ambiente de apps/pocketbase/.env se existir
if (Test-Path $PbEnvFile) {
    Get-Content $PbEnvFile | ForEach-Object {
        if ($_ -match "^\s*([^#=]+)\s*=\s*(.*)\s*$") {
            [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
        }
    }
}

# Auto-download do PocketBase.exe se não existir
if (-not (Test-Path $PbExe)) {
    Write-Host "📥 pocketbase.exe não encontrado em apps/pocketbase. Baixando versão v0.39.4..." -ForegroundColor Yellow
    $ZipPath = "$ProjectRoot\apps\pocketbase\pocketbase.zip"
    $Url = "https://github.com/pocketbase/pocketbase/releases/download/v0.39.4/pocketbase_0.39.4_windows_amd64.zip"
    
    try {
        Invoke-WebRequest -Uri $Url -OutFile $ZipPath
        Expand-Archive -Path $ZipPath -DestinationPath "$ProjectRoot\apps\pocketbase" -Force
        Remove-Item $ZipPath -Force
        Remove-Item "$ProjectRoot\apps\pocketbase\CHANGELOG.md" -ErrorAction SilentlyContinue
        Remove-Item "$ProjectRoot\apps\pocketbase\LICENSE.md" -ErrorAction SilentlyContinue
        Write-Host "✅ PocketBase baixado com sucesso!" -ForegroundColor Green
    } catch {
        Write-Host "⚠️ Falha ao baixar o PocketBase automaticamente. Baixe de pocketbase.io e coloque em apps/pocketbase/pocketbase.exe" -ForegroundColor Red
        exit 1
    }
}

$PbHooks = "$ProjectRoot\apps\pocketbase\pb_hooks"

Write-Host "🚀 Iniciando PocketBase localmente..." -ForegroundColor Cyan
$pbProcess = Start-Process -FilePath $PbExe -ArgumentList "serve --dir=`"$PbData`" --migrationsDir=`"$PbMigrations`" --hooksDir=`"$PbHooks`"" -PassThru

Write-Host "⚡ Iniciando SvelteKit - apps/web..." -ForegroundColor Green
Set-Location "$ProjectRoot\apps\web"

try {
    npm run dev
} finally {
    Write-Host "🛑 Encerrando PocketBase..." -ForegroundColor Yellow
    if ($pbProcess -and -not $pbProcess.HasExited) {
        Stop-Process -Id $pbProcess.Id -Force
    }
}
