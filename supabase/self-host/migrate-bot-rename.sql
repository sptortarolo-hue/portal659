-- ============================================================
-- Renombrar el vendor "Portal 659 Admin" (infraestructura del bot de WhatsApp)
-- a "Portal 659 Bot (sistema)" para que quede claro que NO es un comercio.
-- El row se mantiene como ancla del relay (vendor_wa_bots.vendor_id).
-- ============================================================

UPDATE public.vendors
SET store_name = 'Portal 659 Bot (sistema)',
    slug = 'portal659-bot',
    visible = false,
    is_admin = false
WHERE slug IN ('admin-portal659', 'portal-central');

-- Seguridad: si por algún motivo quedó el slug viejo, lo excluimos igual
-- (el código ya filtra ambos slugs en /admin/comercios y en la resolución).
