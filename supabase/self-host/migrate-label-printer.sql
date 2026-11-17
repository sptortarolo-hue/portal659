-- ============================================================================
-- Impresora de etiquetas adhesivas (productos por unidad y pesables)
-- ============================================================================
-- La impresora de etiquetas es DISTINTA a la de tickets: rollo de etiquetas
-- (50x30 / 40x30 / 58x40 mm), lenguaje propio (TSPL / ZPL / ESC-POS) y cola
-- USB propia. Todo eso vive en un único jsonb por comercio para no sumar
-- cinco columnas y para poder evolucionar el formato sin migrar de nuevo.
--
-- Forma del jsonb (siempre saneado en `readLabelPrinterConfig`):
--   {
--     "enabled": false,
--     "language": "auto" | "tspl" | "zpl" | "escpos",
--     "size": "50x30" | "40x30" | "58x40" | "custom",
--     "widthMm": 50, "heightMm": 30,
--     "tpl": "envasado" | "gondola",
--     "usbName": "Elitronic PL-500",
--     "autoPrint": false,
--     "shelfLifeDays": null
--   }
--
-- Sin esta migración: el panel muestra el aviso "falta aplicar", la sección
-- de etiquetas no guarda y `/api/print` con type=sticker responde 503 con el
-- nombre del archivo. Nada más se rompe (el Mostrador y la lectura de
-- etiquetas de balanza siguen funcionando igual).
--
-- Idempotente: se puede correr varias veces sin efecto.
--   docker exec -i portal659-db psql -U portal659 -d portal659 \
--     < supabase/self-host/migrate-label-printer.sql
-- ============================================================================

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS label_printer_config jsonb;

COMMENT ON COLUMN vendors.label_printer_config IS
  'Impresora de etiquetas adhesivas (jsonb): enabled/language/size/widthMm/heightMm/tpl/usbName/autoPrint/shelfLifeDays';
