ALTER TABLE vendors ADD COLUMN IF NOT EXISTS printer_ip text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS printer_port integer DEFAULT 9100;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS paper_size text DEFAULT '80mm';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS auto_print boolean DEFAULT false;
