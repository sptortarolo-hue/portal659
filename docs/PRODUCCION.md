# Portal 659 — Checklist Producción

## 1. Supabase (Producción)

### Crear proyecto
- [ ] Ir a https://supabase.com y crear proyecto
- [ ] Copiar URL del proyecto (ej: `https://xxxxx.supabase.co`)
- [ ] Copiar `anon key` y `service_role key`

### Configurar variables de entorno
```bash
# .env.local (producción)
NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Aplicar migraciones
- [ ] Copiar archivos de `supabase/migrations/` al SQL Editor de Supabase
- [ ] Ejecutar en orden: 001 → 015
- [ ] Verificar que todas las tablas existen

### Configurar Storage
- [ ] Crear bucket `vendor-images`
- [ ] Hacerlo público (para que se vean las fotos)
- [ ] Configurar políticas de upload (solo usuarios autenticados)

### Configurar Auth
- [ ] Habilitar Email/Password login
- [ ] (Opcional) Habilitar Magic Link
- [ ] Configurar URL de redirección: `https://tudominio.com`

---

## 2. Variables de Entorno

### Requeridas
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# App
NEXT_PUBLIC_SITE_URL=https://tudominio.com
```

### Opcionales (funcionalidades extra)
```bash
# Mercado Pago (pagos online)
MP_ACCESS_TOKEN=APP_USR-...
MP_PUBLIC_KEY=APP_USR-...

# Resend (emails transaccionales)
RESEND_API_KEY=re_...

# Google Maps (mapa de locales)
NEXT_PUBLIC_GOOGLE_MAPS_KEY=AIza...
```

---

## 3. Deploy (Vercel)

### Pasos
1. [ ] Crear cuenta en https://vercel.com
2. [ ] Conectar repositorio de GitHub
3. [ ] Configurar variables de entorno en Vercel Dashboard
4. [ ] Deploy automático

### Configuración Vercel
```
Framework Preset: Next.js
Build Command: next build
Output Directory: .next
Node.js Version: 20.x
```

### Dominio personalizado
- [ ] Comprar dominio (ej: portal659.com)
- [ ] Agregar dominio en Vercel
- [ ] Configurar DNS (CNAME → cname.vercel-dns.com)
- [ ] Habilitar HTTPS automático

---

## 4. Dominio y SSL

### Opciones de dominio
- **Gratis**: `portal659.vercel.app` (generado por Vercel)
- **Personalizado**: `portal659.com` (~$10/año en Namecheap/GoDaddy)

### SSL
- Vercel genera certificado SSL automáticamente
- No hay que configurar nada

---

## 5. Seed de Datos Iniciales

### Después de deploy, ejecutar en Supabase
```sql
-- Crear comprador de prueba
-- (se crea al registrarse)

-- Crear vendedores de prueba
-- Ejecutar: POST /api/seed

-- O insertar manualmente:
INSERT INTO vendors (user_id, store_name, slug, vertical, neighborhood, whatsapp, description)
VALUES
  ('UUID_DEL_USUARIO', 'Mi Local', 'mi-local', 'gastronomia', 'Sicardi', '2215550000', 'Descripción del local');
```

### Modifier de ejemplo
```sql
INSERT INTO product_modifiers (product_id, group_name, options, required, max_selections, position)
VALUES
  ('UUID_PRODUCTO', 'Tamaño', '[{"label":"Individual","price_mod":0},{"label":"Familiar","price_mod":3000}]'::jsonb, true, 1, 1);
```

---

## 6. Verificación Post-Deploy

### URLs a testear
- [ ] `https://tudominio.com` — Home
- [ ] `https://tudominio.com/login` — Login
- [ ] `https://tudominio.com/register` — Registro
- [ ] `https://tudominio.com/buscar?q=pizza` — Búsqueda
- [ ] `https://tudominio.com/tienda/SLUG` — Micrositio
- [ ] `https://tudominio.com/checkout` — Checkout
- [ ] `https://tudominio.com/mis-pedidos` — Tracking
- [ ] `https://tudominio.com/vendor/dashboard` — Dashboard vendedor
- [ ] `https://tudominio.com/admin` — Admin

### APIs a testear
- [ ] `GET /api/health` — Health check
- [ ] `GET /api/reviews?vendor_id=xxx` — Reviews
- [ ] `GET /api/favorites` — Favoritos
- [ ] `GET /api/notifications` — Notificaciones

### Features a verificar
- [ ] Login/logout funciona
- [ ] Registro de vendedor crea vendor
- [ ] Login de vendedor muestra dashboard
- [ ] Crear producto aparece en micrositio
- [ ] Agregar al carrito funciona
- [ ] Checkout envía WhatsApp
- [ ] Reseñas se guardan
- [ ] Favoritos togglean
- [ ] Notificaciones aparecen
- [ ] Admin muestra datos (con vendedor1@test.com)
- [ ] Modificadores aparecen en platos gastronómicos
- [ ] Stock bajo muestra badge "¡Últimas!"
- [ ] Promo price muestra tachado

---

## 7. Monitoring

### Logs
- Vercel Dashboard → Logs (ver errores en tiempo real)
- Supabase Dashboard → Logs → Postgres (ver queries lentas)

### Métricas
- Vercel Analytics (gratis) — visitas, performance
- Supabase Dashboard — conexiones activas, almacenamiento

### Alertas
- [ ] Configurar alerta de errores en Vercel
- [ ] Monitorear uso de Supabase (plan gratuito: 500MB DB, 1GB storage)

---

## 8. Backup

### Supabase
- Backups automáticos diarios (plan gratuito: 7 días)
- [ ] Verificar en Dashboard → Database → Backups

### Manual
```bash
# Exportar DB
pg_dump -h db.xxx.supabase.co -U postgres -d postgres > backup.sql
```

---

## 9. Costos Estimados

| Servicio | Plan | Costo |
|----------|------|-------|
| Vercel | Hobby | Gratis |
| Supabase | Free | Gratis |
| Dominio | (opcional) | ~$10/año |
| Mercado Pago | (por transacción) | 4.79% + $0.30/txn |
| Resend | Free | 100 emails/día gratis |

**Total mínimo: $0/mes** (sin dominio ni pagos online)
**Total con dominio: ~$1/mes**

---

## 10. Roadmap Futuro

### Prioridad Alta
- [ ] Tests E2E (Playwright)
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Error tracking (Sentry)
- [ ] Analytics de negocio (chart de pedidos por día en dashboard)

### Prioridad Media
- [ ] Multi-idioma (i18n)
- [ ] Dark mode
- [ ] Push notifications (web)
- [ ] Mapa de locales (Google Maps)

### Prioridad Baja
- [ ] App móvil (React Native / Expo)
- [ ] Sistema de cupones
- [ ] Programa de fidelidad
- [ ] Chat vendedor-comprador
