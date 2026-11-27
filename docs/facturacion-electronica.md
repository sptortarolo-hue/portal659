# Facturación electrónica (ARCA) — conexión y emisión

Runbook del circuito de **Factura C** de Portal 659. Cada comercio conecta **su propio
CUIT y certificado** de ARCA (antes AFIP): no hay una credencial global del portal,
a diferencia de Mercado Pago. La factura se emite a nombre del comercio y el portal
solo guarda el comprobante, el CAE y el PDF.

> La facturación de las **suscripciones del portal** es otro circuito: hoy se emite un
> **Recibo X** (documento no válido como factura) desde `/admin/suscripciones`. No
> confundirlo con este runbook.

## Alcance y límites de la v1

| Ítem | Valor |
|---|---|
| Comprobantes | **Factura C** (`cbte_tipo = 11`) y **Nota de Crédito C** (`cbte_tipo = 13`, anulación total) |
| Régimen | Monotributo — Concepto 1, **neto = total**, sin IVA discriminado |
| Servicio ARCA | **WSFEv1** (facturación) + **WSAA** (autenticación) |
| Entornos | `homo` (WSASS) y `prod` (Administración de Certificados), elegibles por comercio |
| Plan | Solo **Gestión integral vigente** (`can("fiscal")`) |
| Verticales | Gastronomía, comercio, moda, estética, taller y salud |
| Excluidos | **Oficios / servicios**: `SERVICIO_FEATURE_MASK` fuerza `fiscal: false` aunque haya plan pago |
| Desarrollo / preview | `can()` devuelve `true` (no se conecta a ARCA salvo que se configure) |

La factura se identifica por `UNIQUE (vendor_id, order_id)` o, para turnos, por
`UNIQUE (vendor_id, booking_id)`. Eso hace que un reintento no duplique comprobante.

## Mapa del código

### `src/lib/arca/`

| Archivo | Responsabilidad |
|---|---|
| `issue-invoice.ts` | Orquestador de emisión + INSERT en `invoices`. Maneja el duplicado por UNIQUE devolviendo el comprobante existente (`recovered: true`). Define `FiscalIssueError` (`status`/`code`/`hint`/`detail`). **No valida plan ni config**: lo delega al caller. |
| `emit.ts` | Último autorizado → próximo número → pedir CAE → recupero por duplicado (10016) → QR. Emite Factura C y NC C. Sin DB. |
| `wsaa.ts` | Login `loginCms` (TRA firmado en CMS/PKCS#7), token con validez 12 h, cache en memoria + tabla `fiscal_ta_cache` cifrada, con coalescencia de requests. |
| `wsfe.ts` | Constantes de comprobante, normalización del receptor, `FECompUltimoAutorizado`, `FECAESolicitar`, `FECompConsultar`, traducción de errores/observaciones. |
| `crypto.ts` | Cifrado AES-256-GCM (`iv.tag.data` en base64) de certificado, clave y TA. Validador de CUIT con dígito verificador. |
| `csr.ts` | Genera RSA 2048 + CSR PKCS#10 con `node-forge` (sin OpenSSL). El subject lleva `C=AR`, `O=<comercio>`, `2.5.4.5 = CUIT <cuit>`. |
| `qr.ts` | QR obligatorio: payload JSON → base64 → `https://www.arca.gob.ar/fe/qr/?p=...`. |
| `pdf.ts` | PDF A4 con `pdf-lib`: emisor, receptor, ítems, TOTAL, CAE + vencimiento + QR. **v1: una sola página** (los tickets chicos entran). |
| `invoice-pdf.ts` | Carga la invoice, genera el PDF, lo guarda en `UPLOAD_DIR/fiscal/<vendor>/` y actualiza `invoices.pdf_url`. |
| `faults.ts` | Traduce faults de ARCA a pistas accionables en español (ver Troubleshooting). |

### Rutas API (`src/app/api/vendor/fiscal/`)

Todas resuelven el comercio con `getVendorByRequest`, rechazan sesiones `staff`/`delivery`
(403) y exigen `can("fiscal")` (403 `plan_limit`).

| Ruta | Método | Qué hace |
|---|---|---|
| `config` | GET | Devuelve `can_fiscal`, `cuit`, `fiscal_cond_iva`, `fiscal_env`, `has_cert`, `has_key`, `cert_info` y **`ready`**. Nunca devuelve secretos. |
| `config` | PATCH | Guarda CUIT, punto de venta, entorno, certificado y clave. Valida CUIT, rango de ptoVta (1..99999), entorno `homo\|prod` y el par clave/cert con `validateCertKeyPair`. Cifra antes de guardar. `clear_fiscal_creds` borra credenciales. |
| `csr` | POST | Genera la clave + CSR, guarda la clave cifrada y devuelve el CSR en PEM. Requiere CUIT cargado. |
| `ping` | POST | Solo `getWsaaTicket`: prueba el login **sin emitir ni gastar numeración**. |
| `emitir` | POST | Acepta `orderId`, `bookingId` u `orderIds[]` (hasta 50). Normaliza receptor, llama a `issueFiscalInvoice`. |
| `nota-credito` | POST | Solo por `orderId`. Busca la Factura C original, es idempotente por comprobante asociado, hereda el receptor. **v1: anulación total**. |
| `invoices` | GET | Últimos 50 comprobantes con datos del pedido. |
| `pdf` | GET | `?invoiceId=[&format=url]` → PDF inline o `{pdf_url, fname}`. |
| `enviar` | POST | Envía el PDF por email con `invoiceEmail` + Resend. |
| `reporte` | GET | `?desde&hasta&format=csv\|json` → `facturado (11) − anulado (13) = neto`, `by_day`. Base del libro IVA ventas. |

## Precondiciones

### 1. Plan

El comercio debe tener **Gestión integral** vigente o en gracia (`past_due` cuenta como
vigente mientras haya un reclamo de pago pendiente). Sin eso la sección muestra un
upsell o `PlanLock` en la pestaña "Facturación".

`fiscal` se enciende en DB **solo** en `migrate-fiscal.sql`:
```sql
UPDATE plans SET features = features || '{"fiscal": true}' WHERE slug = 'gestion';
```
⚠️ `schema.sql` no siembra esa clave y su seed usa `ON CONFLICT DO UPDATE features =
EXCLUDED.features`, así que **re-corregir el seed después de la migración puede pisar
el flag**. Verificar con:
```bash
docker exec portal659-db psql -U portal659 -d portal659 -c \
  "SELECT slug, features->>'fiscal' FROM plans;"
```

### 2. Migraciones aplicadas en el VPS

 Todas viven en el host (`/opt/portal659`), se pasan por stdin al contenedor:

```bash
docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-fiscal.sql
docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-fiscal-ta-cache.sql
docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-fiscal-receptor.sql
docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-fiscal-pdf.sql
docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-fiscal-nc.sql
docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-estetica-booking-payment.sql
docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-mp-qr.sql
```

Qué aporta cada una:

| Migración | Aporta |
|---|---|
| `migrate-fiscal.sql` | Columnas `cuit`, `fiscal_cond_iva`, `fiscal_punto_venta`, `fiscal_cert`, `fiscal_key`, `fiscal_env` en `vendors`; tabla `invoices`; flag `fiscal: true` en el plan `gestion`. |
| `migrate-fiscal-ta-cache.sql` | `fiscal_ta_cache`: token de WSAA persistente (sobrevive a un deploy del contenedor `app`). |
| `migrate-fiscal-receptor.sql` | `invoices.receptor_nombre` y `receptor_cond_iva`. Sin ella no se puede identificar al receptor. |
| `migrate-fiscal-pdf.sql` | `invoices.pdf_url`. |
| `migrate-fiscal-nc.sql` | `asoc_tipo/asoc_pto/asoc_nro` + índice/UNIQUE parcial para NC. |
| `migrate-estetica-booking-payment.sql` | `invoices.booking_id` (nullable) + UNIQUE parcial; `order_id` pasa a nullable. Sin ella no se facturan turnos. |
| `migrate-mp-qr.sql` | `vendors.fiscal_auto_emit` (emisión automática al cobrar con QR MP). |

El código es tolerante a migraciones parciales (`information_schema` / `to_regclass`),
pero varias funciones responden **503 nombrando el archivo** cuando falta la columna.

### 3. Variables de entorno

| Variable | Para qué | Dónde |
|---|---|---|
| `MP_TOKEN_KEY` | Clave AES-256-GCM por defecto para cifrar certificado, clave y TA | `.env.local` / secret de GitHub → `.env` del VPS (`deploy.yml` L54) / `docker-compose.yml` |
| `FISCAL_KEY` | **Opcional**. Si se define, reemplaza a `MP_TOKEN_KEY` para lo fiscal | Hoy **no** está en `deploy.yml`: se usa el fallback |
| `UPLOAD_DIR` | Donde se guardan los PDF (`/app/uploads`, volumen `uploads_data`) | `deploy.yml` L46 |
| `RESEND_API_KEY`, `FROM_EMAIL` | Envío de la factura por email (`fiscal/enviar`) | `deploy.yml` L47-48 |

⚠️ No cambiar `MP_TOKEN_KEY` en producción sin antes exportar y volver a cifrar las
credenciales fiscales: se usa como clave de cifrado y todos los secretos quedarían
ilegibles.

### 4. Red

Los endpoints están **hardcodeados** (no hay env vars `ARCA_*` / `AFIP_*`):

| Entorno | WSAA | WSFEv1 |
|---|---|---|
| Homo | `https://wsaahomo.afip.gov.ar/ws/services/LoginCms` | `https://wswhomo.afip.gov.ar/wsfev1/service.asmx` |
| Prod | `https://wsaa.afip.gov.ar/ws/services/LoginCms` | `https://servicios1.afip.gov.ar/wsfev1/service.asmx` |

El VPS debe poder salir por HTTPS (443) a esos hosts.

## Conexión paso a paso

Desde **Config → Facturación** en el panel del comercio (o la pestaña propia
"Facturación", accesible por deep-link `?seccion=fiscal`). El wizard tiene 5 pasos
visibles; el quinto (probar conexión) es confirmación, no entra en `ready`.

### Paso 1 — CUIT y punto de venta

Cargar CUIT (con dígito verificador válido) y punto de venta electrónico (1..99999).

```http
PATCH /api/vendor/fiscal/config
{ "cuit": "20-12345678-9", "fiscal_punto_venta": 1 }
```

Se guarda en `vendors.cuit` / `vendors.fiscal_punto_venta`. En el mismo paso se elige
la **condición frente al IVA** (`fiscal_cond_iva`: `monotributo` por defecto o
`responsable_inscripto`); solo cambia la etiqueta del encabezado, no el tipo de
comprobante (v1 emite siempre Factura C).

### Paso 2 — Clave + CSR

Botón "Generar clave + CSR" → `POST /api/vendor/fiscal/csr`.

- Genera RSA 2048 con `node-forge`, **sin OpenSSL**.
- Guarda la **clave privada cifrada** en `vendors.fiscal_key`.
- Devuelve el CSR en PEM para copiar o descargar.

Si se prefiere, se puede saltear el CSR y subir directamente `.crt` + `.key` juntos.

### Paso 3 — Trámite manual en ARCA, paso a paso

La app **no puede hacer este trámite por el comercio**: la clave privada debe quedarse
acá y a ARCA solo se le sube el CSR. El panel muestra este mismo texto con un link a
`arca.gob.ar` y un botón "Ya lo pegué" (solo UI) para marcar el avance.

**Antes de empezar**: se hace una vez; el certificado se guarda cifrado y no se vuelve
a ARCA hasta que venza (1 año). Necesitás el **CUIT del comercio** (no el del contador)
y su **Clave Fiscal** en [arca.gob.ar](https://www.arca.gob.ar/). Probá primero en
**Prueba** y recién después pasá a **Producción**.

**Prueba (homologación, WSASS):**

1. Entrar a `arca.gob.ar` y buscar **WSASS**. Si no aparece entre los servicios, primero
   **Adherir WSASS** en *Servicios interactivos*.
2. **Nuevo Certificado**. Alias: `portal659` (sin espacios).
3. En **Solicitud del certificado en formato PKCS#10**, pegar el CSR completo del paso 2.
4. **Crear DN y obtener certificado**. Copiar todo desde `-----BEGIN CERTIFICATE-----`
   hasta `-----END CERTIFICATE-----` en un Bloc de notas y guardarlo como
   `certificado-prueba.crt`. Volver al paso 4.
5. ⚠️ En WSASS, **Autorización de acceso a un servicio**: certificado recién creado +
   CUIT representado + servicio **`wsfe`** → Confirmar. **Sin esto la conexión da OK
   pero la factura falla con "no autorizado". Es el error más común.**
6. Volver al portal.

**Producción:**

1. `arca.gob.ar` con Clave Fiscal (nivel 2 o superior) → **Administración de
   Certificados Digitales** → **Agregar Alias**.
2. Alias `portal659` (sin espacios), pegar el CSR, confirmar.
3. En la lista, **Ver** el alias y **Descargar** el `.crt`. Volver al paso 4.
4. ⚠️ **Administrador de Relaciones de Clave Fiscal** → **Nueva Relación**: servicio
   **Factura Electrónica / WSFE** (no WSFEx ni otro), representante **el Computador
   Fiscal / alias `portal659`** → Confirmar.
5. Volver al portal.

Si los botones se llaman distinto, buscar las palabras **certificado**, **CSR** y
**wsfe**. La clave privada **nunca se sube a ARCA** ni se comparte con nadie.

### Paso 4 — Cargar el `.crt`

Pegar el certificado que devuelve ARCA (o subir el archivo):

```http
PATCH /api/vendor/fiscal/config
{ "cert_pem": "-----BEGIN CERTIFICATE-----..." }
```

El servidor descifra la clave guardada, valida que **certificado y clave sean un par**
y que el cert esté vigente (`validateCertKeyPair`), y guarda ambos cifrados con AES-GCM.
`GET config` devuelve `cert_info = { subject, notAfter }` para confirmarlo.

### Paso 5 — Entorno y prueba de conexión

Elegir **Prueba** o **Producción** (`fiscal_env`, default `homo`) y apretar
"Probar conexión" → `POST /api/vendor/fiscal/ping`. Hace solo el login WSAA: no emite
ni consume numeración. Escribir en el log `[fiscal] ... stage=ping-ok|ping-error`.

### Paso 6 — Verificación end-to-end (sin numeración)

`POST /api/vendor/fiscal/verify` valida en un solo paso lo que el `ping` no cubre:

1. `FECompUltimoAutorizado(ptoVta, 11)` → confirma **WSAA + autorización WSFE + PV**.
2. `FEParamGetPtosVenta` → lista los puntos de venta habilitados y avisa si el
   configurado no está (o está dado de baja). Si esta consulta secundaria falla, no
   invalida la verificación.
3. Respuesta: `{ ok, env, ms, ultimo, proximo, puntosVenta, warnings }`.
4. Errores: mismo mapeo que `ping` (`explainArcaFault`) + hint específico si el fault
   menciona `PtoVta`. Logs `[fiscal] ... stage=verify-ok|verify-error`.

**Nunca llama a `FECAESolicitar`**: no gasta numeración ni genera CAE. Es el paso 6
del wizard y tampoco entra en `ready` (es una comprobación adicional).

### Paso 7 — Probar de verdad y recién entonces producción

1. Hacer una venta de prueba con el check "Con comprobante fiscal" en Mostrador (o
   cobrar un turno).
2. Revisar que el ticket tenga **CAE + QR** y que el QR se lea con la app de ARCA.
3. Solo entonces cambiar a **Producción** y repetir pasos 3, 4, 5 y 6 con el
   certificado de producción.

### Renovación

Si `cert_info.notAfter` está a menos de 30 días, el panel muestra un aviso: se pide un
certificado nuevo en ARCA **con la misma clave privada** (no hace falta regenerar el
CSR) y se pega solo el `.crt` nuevo en el paso 4. Si ARCA exige CSR nuevo, repetir desde
el paso 2. El historial del wizard tiene link "📄 PDF" por comprobante.

### `ready`

El servidor lo recalcula en cada `GET config`:

```text
ready = can("fiscal")
     && CUIT válido
     && punto de venta cargado
     && fiscal_cert y fiscal_key presentes
     && cert_info válido (par clave/cert + vigencia)
```

Cuando es `true`, el badge pasa a **"✅ Lista para facturar (prueba/producción)"**.
El `ping` **no** es parte de `ready`; es una comprobación adicional que recomienda el panel.

### Opcional: emisión automática al cobrar con Mercado Pago

`POST /api/vendor/me { "fiscal_auto_emit": true }` (checkbox en Config → Facturación).
La emisión la hace **el servidor**, no el navegador:

- **QR de mostrador**: webhook `mpqr_` de `/api/webhooks/mercadopago` (rama `orders` y
  `payment`) y `markPaid` de `/api/vendor/mp-qr/[id]` (cubre el caso en que el polling
  acredita antes de que llegue el webhook).
- **Checkout online**: rama `portal659_<vendorId>_<ts>` del webhook, justo después de la
  transacción (antes de la impresión, para que el ticket salga con CAE + QR).
- **Pedido pesado**: rama `portal659_order_` del webhook, con el total real ya confirmado.

Todo es **best-effort**: si ARCA falla se loguea (`[fiscal]`, `mp-webhook/fiscal`) y el
webhook responde `ok`. Un 500 haría reintentar a MP y duplicar pedidos. El reintento
manual sigue en Facturación / el detalle del pedido. La idempotencia está en tres
niveles: pre-check por referencia, `UNIQUE` en `invoices` y recupero del CAE 10016.

⚠️ El receptor de estas emisiones automáticas es **consumidor final** (el checkout no
captura DNI/CUIT); se guarda `customer_name` como `receptor_nombre` para trazabilidad.
Las ventas al contado no usan este flag: el opt-in es el check "Con comprobante fiscal"
de esa venta y viaja en el cuerpo del cobro.

## Emisión

### Secuencia WSFE

1. `FECompUltimoAutorizado` → último número autorizado para `(ptoVta, cbteTipo)`.
2. Siguiente número → `FECAESolicitar` con Concepto 1, `ImpTotal`, `ImpNeto = ImpTotal`
   y `CondicionIVAReceptorId`.
3. Si ARCA responde **10016** (comprobante ya registrado), se recupera con
   `FECompConsultar` en vez de reemitir (`recovered: true`).
4. Se guarda la fila en `invoices` con `cae`, `cae_vto`, `total` y receptor.
5. Se construye el QR fiscal con CAE, CUIT, ptoVta, tipo/nro de comprobante e importe.

En `solicitarCaeC` **no hay reintento de red** (para no duplicar el CAE); el recupero
por 10016 cubre ese caso. El login WSAA sí reintenta y cachea el ticket 12 h.

### Puntos de disparo

| Origen | Archivo | Detalle |
|---|---|---|
| **Mostrador (al contado)** | `pos/order` → `emitFiscalForOrder` | El check "🧾 Con comprobante fiscal" y el receptor viajan en el body del cobro. El servidor emite **después de la transacción**, best-effort, y devuelve `fiscal: {ok, invoice, error}` en la respuesta. El panel solo muestra el CAE e imprime el ticket: ya no hay segundo fetch ni dependencia de que siga abierto. |
| **Auto MP (server)** | `webhooks/mercadopago` + `mp-qr/[id]` | Solo si `fiscal_auto_emit`. QR de mostrador, checkout online y pedido pesado. Nunca depende del navegador abierto. |
| **Mesas** | `tables/[id]/close` → `emitFiscalForOrder` | Una sola Factura C para toda la cuenta: el cierre manda `fiscal` + `orderIds[]`, el servidor emite contra el pedido principal (el más nuevo) y devuelve el comprobante en `fiscal`. Offline **no factura** (ARCA necesita red). |
| **Detalle del pedido** | `fiscal-bill-button.tsx` | Botón "Facturar"; también sirve para reintentar si la emisión falló. |
| **Cobro de turno / orden** | `booking-cobro-modal.tsx` → `bookings/[id]/cobro` | Check "Emitir comprobante fiscal (Factura C)" si `can("fiscal")` y `ready`. Total = seña pagada + saldo cobrado. Se emite en la **misma request** del cobro con `bookingId`. |
| **Nota de crédito** | `fiscal-bill-button.tsx` → `fiscal/nota-credito` | Anulación total de una Factura C por `orderId`. |

### Receptor

Por defecto **Consumidor final** (`tipoDocRec = 99`, `nroDocRec = 0`). Opcionalmente
se puede cargar DNI o CUIT, razón social y condición IVA desde
`fiscal-receptor.tsx` (Mostrador/Mesas) o el selector del detalle/cobro de turno.
Valores válidos de condición IVA receptor: `1`, `4`, `5`, `6` (5 = CF).

### Después de emitir

- **PDF A4**: se guarda en `UPLOAD_DIR/fiscal/<vendor>/<C|NC>-....pdf` y se registra
  en `invoices.pdf_url`. Se ve desde el historial de Facturación.
- **Email**: `POST /fiscal/enviar` adjunta el PDF (requiere Resend).
- **Ticket térmico**: `api/print` lee la invoice y agrega el bloque con **CAE +
  vencimiento + QR**. Si el ticket se imprimió antes de que llegara el CAE, hay que
  **reimprimirlo** desde el detalle del pedido.
- **Historial / reporte**: `GET /fiscal/invoices` y `GET /fiscal/reporte` (CSV con BOM,
  `facturado − anulado = neto`, desglose por día). Base para el libro IVA ventas.

## Troubleshooting

Ante cualquier fallo, primero `POST /fiscal/ping`: si el login falla, el problema es
de certificado/entorno/red; si el login anda pero la emisión falla, es de WSFE o de
numeración. Los logs del contenedor `app` llevan el prefijo `[fiscal]`.

| Mensaje / fault | Causa | Acción |
|---|---|---|
| "no es de confianza" / `authority` / `issuer` | Certificado del entorno equivocado | En Prueba usá el `.crt` de WSASS; en Producción, el de Administración de Certificados (o invertí el entorno en el panel). |
| `alreadyAuthenticated` | Login duplicado en curso en ARCA | Esperar unos segundos y reintentar. |
| "ya posee ... TA" | Ya hay un ticket válido vigente (login reciente, reinicio del portal u otro sistema con el mismo CUIT) | No se emite otro hasta el vencimiento (máx. 12 h). Reintentar después; una vez obtenido, el portal lo reutiliza solo. |
| "no respondió en" / "sin conexión" | ARCA lento o caído (homo falla seguido) | Reintentar en minutos. El cobro ya quedó registrado: se puede facturar después sin duplicar. |
| "no autorizado" / `not authorized` / `asociad` / `autorizaci` | El certificado no está asociado a WSFE | Asociarlo en WSASS (prueba) o Administrador de Relaciones (producción). |
| "vencido" / `expir` / `vigencia` | Certificado vencido o fuera de vigencia | Generar un CSR nuevo en el portal y pedir otro certificado en ARCA. |
| `cms` / "firma" / `signature` | El `.crt` no corresponde a la clave guardada | Regenerar el CSR y repetir el trámite. |
| `cuit` + "represent" / "dn" | El CUIT del certificado no coincide con el cargado | Verificar que el CSR se generó con el CUIT del comercio. |
| **10016** (comprobante duplicado) | Reintento / carrera | El portal lo recupera solo con `FECompConsultar`; no es un error para el usuario. |

**Renovación anual del certificado**: se pide el certificado nuevo en ARCA **con la misma
clave privada** (no hace falta regenerar el CSR) y se pega solo el `.crt` nuevo en el
paso 4. Si ARCA exige un CSR nuevo, regenerar desde el paso 2 (la clave anterior se
reemplaza).

## Deuda conocida

1. La **NC no soporta `booking_id`** (solo pedidos), aunque `invoices` ya lo permite.
   Las facturas de turno se anulan a mano desde ARCA.
2. `pdf.ts` arma el PDF en **una sola página**: facturas con muchos ítems se cortan.
3. `fiscal_cond_iva` solo cambia la **etiqueta impresa**: esta versión emite siempre
   Factura C, aunque se elija "Responsable inscripto".
4. El check "Con comprobante fiscal" con **QR MP** no fuerza la emisión por sí solo:
   en ese caso manda el flag global `fiscal_auto_emit` (el checkout no captura documento).

### Resuelto (nov-2026)

- ✅ `fiscal_cond_iva` editable en Config → Facturación (`PATCH fiscal/config`).
- ✅ El QR lleva el receptor real (`tipoDocRec`/`nroDocRec`) en emisión, PDF, ticket y
  comprobante compartido por WhatsApp; default 99/0 para consumidor final.
- ✅ Emisión automática server-side en el webhook de MP y en el polling del QR.
- ✅ Emisión al contado server-side: `pos/order` y `tables/[id]/close` reciben el
  opt-in y el receptor, emiten tras la transacción y devuelven el CAE en la respuesta.
- ✅ Fechas del QR, del `CbteFch`, del PDF y del ticket se calculan en TZ AR
  (`src/lib/arca/fecha.ts`), no con los getters UTC del servidor.
- ✅ Historial y reporte traen el cliente de turnos (`COALESCE(receptor_nombre,
  orders.customer_name, bookings.customer_name)`) y columna "Origen" en el CSV;
  `api/print` para turnos es tolerante a `migrate-fiscal-receptor.sql` sin aplicar.
- ✅ Verificación automática: `node scripts/check-fiscal-qr.mjs`.

## Checklist de puesta en marcha

- [ ] `SELECT slug, features->>'fiscal' FROM plans;` → `t true` para `gestion`.
- [ ] Las 7 migraciones figuran aplicadas en el VPS.
- [ ] `MP_TOKEN_KEY` (o `FISCAL_KEY`) presente en el `.env` del contenedor `app`.
- [ ] Salida HTTPS a los hosts WSAA/WSFE del entorno elegido.
- [ ] `GET /api/vendor/fiscal/config` → `can_fiscal: true`, `cert_info` con `notAfter`
      futuro, `ready: true`.
- [ ] `POST /api/vendor/fiscal/ping` → ok (sin gastar numeración).
- [ ] Factura de prueba en **homo**: CAE + QR legibles con la app de ARCA.
- [ ] Ticket reimpreso con el bloque fiscal y PDF generado en `UPLOAD_DIR/fiscal/`.
- [ ] Email con adjunto (si Resend está configurado).
- [ ] NC de prueba y `GET /fiscal/reporte` cuadrando (`facturado − anulado`, con
      "Origen" Pedido/Turno y el cliente en ambas).
- [ ] `node scripts/check-fiscal-qr.mjs` → OK (receptor real + fecha AR).
- [ ] Si `fiscal_auto_emit` está activo: pagar con MP y verificar que la factura nace
      sin abrir el panel del comercio.
- [ ] Recién entonces cambiar el comercio a **prod** y repetir ping + factura de prueba.
