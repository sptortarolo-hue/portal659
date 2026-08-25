ALTER TABLE vendors ADD COLUMN IF NOT EXISTS transfer_cbu text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS transfer_alias text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS transfer_qr_url text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS accepting_quotes boolean DEFAULT true;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'whatsapp';

CREATE TABLE IF NOT EXISTS quotes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  service_name text,
  description text NOT NULL,
  preferred_date text,
  preferred_time text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'responded', 'accepted', 'cancelled')),
  vendor_notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS product_name text;
