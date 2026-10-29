# build-android.ps1 — compila el relay whatsmeow para Android (arm64) y lo
# instala en el APK "Portal Wa Link".
#
# POR QUÉ EXISTE ESTE SCRIPT (incidente oct-2026):
#   compilar con `go build -o relay-arm64 .` en Windows, sin GOOS/GOARCH,
#   produce un PE de Windows (bytes "MZ"). El APK lo empaqueta igual, pesa
#   lo mismo que el ELF y nadie se da cuenta... hasta que Android intenta
#   ejecutarlo: el kernel devuelve ENOEXEC, el sistema cae al fallback de
#   /system/bin/sh, que parsea el binario como script y responde
#   `syntax error: unexpected (` → exit code 1 → RelayService reintenta en
#   loop → la app queda en "Reconectando...".
#   Por eso acá se VALIDA la cabecera ELF antes de copiar nada.
#
# Uso:
#   pwsh -File services/wa-bot/relay/build-android.ps1
#   powershell -ExecutionPolicy Bypass -File services/wa-bot/relay/build-android.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$relayDir = $PSScriptRoot
$repoRoot = Resolve-Path (Join-Path $relayDir '..\..\..')
$out      = Join-Path $relayDir 'relay-arm64'
$jnilibs  = Join-Path $repoRoot 'portal-wa-link\app\src\main\jniLibs\arm64-v8a\librelay.so'

# 1) Cross-compile: sin CGO (modernc.org/sqlite es sqlite puro Go), Android arm64.
$env:CGO_ENABLED = '0'
$env:GOOS        = 'android'
$env:GOARCH      = 'arm64'
$env:GOFLAGS     = ''

Write-Host "==> go build (GOOS=$env:GOOS GOARCH=$env:GOARCH CGO=$env:CGO_ENABLED)" -ForegroundColor Cyan
Push-Location $relayDir
try {
  & go build -trimpath -ldflags='-s -w' -o $out .
  if ($LASTEXITCODE -ne 0) { throw "go build falló con código $LASTEXITCODE" }
} finally {
  Pop-Location
}

# 2) Validar la cabecera: ELF + AArch64 + PIE. Si no, abortar sin tocar jniLibs.
function Assert-AndroidElf([string] $path) {
  if (-not (Test-Path $path)) { throw "No existe el binario: $path" }
  # ReadAllBytes: funciona igual en Windows PowerShell 5.1 y en pwsh 7
  # (Get-Content -Encoding Byte / -AsByteStream cambian de nombre entre ambos).
  $all = [System.IO.File]::ReadAllBytes($path)
  if ($all.Length -lt 20) { throw "El binario es demasiado chico ($($all.Length) bytes)." }
  $b = $all[0..19]
  $magic = -join ($b[0..3] | ForEach-Object { [char]$_ })
  # e_type   little-endian en 0x10: 03 00 = DYN (PIE, lo que exige Android 10+)
  $eType = $b[16] + ($b[17] -shl 8)
  # e_machine little-endian en 0x12: 0xB7 = EM_AARCH64
  $eMach = $b[18] + ($b[19] -shl 8)

  if ($magic -eq 'MZ') {
    throw ("El binario es un PE de WINDOWS (magic 'MZ'). Faltó GOOS/GOARCH: " +
           "en Android da 'syntax error: unexpected (' y exit 1. Abortado.")
  }
  if ($magic -ne ([string][char]0x7F + 'ELF')) { throw "El binario no es ELF (magic='$magic')." }
  if ($eMach -ne 0xB7) { throw ("El ELF no es AArch64 (e_machine=0x{0:X2})." -f $eMach) }
  if ($eType -ne 3)    { throw ("El ELF no es PIE/DYN (e_type=0x{0:X2}); Android 10+ exige PIE." -f $eType) }

  $size = $all.Length
  Write-Host ("    OK: ELF AArch64 PIE, {0:N0} bytes" -f $size) -ForegroundColor Green
  return $size
}

Write-Host "==> validando $out" -ForegroundColor Cyan
$size = Assert-AndroidElf $out

# 3) Instalar en jniLibs (es lo que Android extrae a nativeLibraryDir).
Write-Host "==> copiando a jniLibs" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path (Split-Path $jnilibs) | Out-Null
Copy-Item -Force $out $jnilibs
Assert-AndroidElf $jnilibs | Out-Null

Write-Host ""
Write-Host "Listo. Ahora:" -ForegroundColor Yellow
Write-Host "  1) bump versionCode/versionName en portal-wa-link/app/build.gradle"
Write-Host "  2) cd portal-wa-link && gradlew assembleRelease"
Write-Host "  3) VALIDAR el binario DENTRO del apk (no el archivo suelto):"
Write-Host "     jar xf app-release.apk lib/arm64-v8a/librelay.so   # y repetir el chequeo ELF"
Write-Host "  4) copiar el .apk a public/downloads/portal-wa-link.apk y bump ?v=N"
