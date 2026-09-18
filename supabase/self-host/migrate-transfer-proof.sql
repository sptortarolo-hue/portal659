-- Comprobante de transferencia que llega por WhatsApp al bot:
-- el cliente manda foto/PDF del pago → el bot la guarda y queda en el pedido.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS transfer_proof_url text;
