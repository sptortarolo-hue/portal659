Colocá acá el binario compilado del relay (`services/wa-bot/relay`), por ABI:

  relay/relay-arm64    (Android arm64)
  relay/relay-x86_64   (Android x86_64)

Ejemplo de compilado (desde services/wa-bot/relay, con Go):
  go mod tidy
  CGO_ENABLED=0 GOOS=android GOARCH=arm64 go build -ldflags="-s -w" -o relay-arm64 .
  CGO_ENABLED=0 GOOS=android GOARCH=amd64 go build -ldflags="-s -w" -o relay-x86_64 .

Luego copiá los binarios acá:
  portal-wa-link/app/src/main/assets/relay/relay-arm64
  portal-wa-link/app/src/main/assets/relay/relay-x86_64

La app (RelayService) los copia a filesDir, les da permiso de ejecución y los
corre como subproceso.

Nota: el relay usa `modernc.org/sqlite` (driver sqlite PURO Go), así que
CGO_ENABLED=0 es correcto y NO hace falta el NDK.