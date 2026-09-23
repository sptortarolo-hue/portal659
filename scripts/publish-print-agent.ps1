<#
.SYNOPSIS
  Publica el agente PC (Portal Print Agent) en el VPS.

.DESCRIPTION
  1. Compila el .zip (npm run build:win:zip) salvo -SkipBuild.
  2. Lo sube por scp a /tmp del VPS.
  3. Lo copia al volumen uploads con docker cp (sobrevive deploys).
  4. Verifica MD5 local vs remoto.

  El .zip está gitignored a propósito (binario ~220MB): no viaja con el
  deploy, por eso existe este script. Después de publicar, bumpear el ?v=
  del link en printer-config-section.tsx (?v=3 -> ?v=4...) + push.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\publish-print-agent.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\publish-print-agent.ps1 -SkipBuild -VpsHost 103.195.103.245
#>
[CmdletBinding()]
param(
  [string]$VpsHost = "103.195.103.245",
  [string]$VpsUser = "root",
  [string]$SshKey = "$env:USERPROFILE\.ssh\id_rsa",
  [string]$Container = "portal659",
  [string]$DestPath = "/app/uploads/downloads/portal-print-agent.zip",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$AgentDir = Join-Path $RepoRoot "services\print-agent"
$ZipPath = Join-Path $AgentDir "dist\portal-print-agent.zip"

function Invoke-Step([string]$Name, [scriptblock]$Block) {
  Write-Host ""
  Write-Host "== $Name ==" -ForegroundColor Cyan
  & $Block
  if (-not $?) { throw "Falló el paso: $Name" }
}

# 0. Pre-chequeos
if (-not (Test-Path -LiteralPath $AgentDir)) { throw "No existe $AgentDir (correr desde el repo)" }
foreach ($cmd in @("scp", "ssh")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "Falta '$cmd' (OpenSSH). Instalalo: Configuración > Aplicaciones > Características opcionales > Cliente OpenSSH."
  }
}
$SshArgs = @()
if ((Test-Path -LiteralPath $SshKey)) { $SshArgs += @("-i", $SshKey) }
else { Write-Host "Aviso: no existe $SshKey, ssh usará tus claves/agente por defecto." -ForegroundColor Yellow }

# 1. Build
if (-not $SkipBuild) {
  Invoke-Step "Compilando agente (build:win:zip)" {
    & npm --prefix $AgentDir run build:win:zip
  }
}
if (-not (Test-Path -LiteralPath $ZipPath)) { throw "No se encontró $ZipPath (¿falló el build?)" }
$LocalHash = (Get-FileHash -LiteralPath $ZipPath -Algorithm MD5).Hash.ToLower()
$LocalSize = [math]::Round((Get-Item -LiteralPath $ZipPath).Length / 1MB, 1)
Write-Host "ZIP local: $LocalSize MB, MD5 $LocalHash"

# 2. Subir a /tmp del VPS
Invoke-Step "Subiendo al VPS ($VpsHost)" {
  & scp @SshArgs $ZipPath "${VpsUser}@${VpsHost}:/tmp/portal-print-agent.zip"
}

# 3. docker cp al volumen uploads (container portal659 -> /app/uploads)
Invoke-Step "Publicando en el volumen uploads" {
  $RemoteCmd = "docker cp /tmp/portal-print-agent.zip ${Container}:${DestPath} && rm -f /tmp/portal-print-agent.zip && docker exec ${Container} ls -la ${DestPath}"
  $Out = & ssh @SshArgs "${VpsUser}@${VpsHost}" $RemoteCmd 2>&1
  if ($Out) { $Out | ForEach-Object { Write-Host "$_" } }
  if (-not $?) { throw "El VPS cerró la sesión o falló el docker cp (reintentá en un minuto; si persiste, revisá fail2ban/MaxStartups en el VPS)" }
}

# 4. Verificar MD5 remoto
Invoke-Step "Verificando MD5 remoto" {
  $RemoteOut = & ssh @SshArgs "${VpsUser}@${VpsHost}" "docker exec ${Container} md5sum ${DestPath}" 2>&1
  $RemoteHash = ""
  if ($RemoteOut) {
    $First = ([string]$RemoteOut).Trim()
    Write-Host $First
    if ($First -match "^([0-9a-f]{32})\b") { $RemoteHash = $Matches[1].ToLower() }
  }
  Write-Host "MD5 remoto: $RemoteHash"
  if (-not $RemoteHash) { throw "No se pudo leer el archivo remoto (¿falló el docker cp?)" }
  if ($RemoteHash -ne $LocalHash) { throw "MD5 distinto: la subida quedó corrupta" }
}

Write-Host ""
Write-Host "OK: agente publicado." -ForegroundColor Green
Write-Host "Falta: bumpear ?v= del link en src/components/dashboard/printer-config-section.tsx (hoy ?v=3) + push para que los locales descarguen el nuevo."
