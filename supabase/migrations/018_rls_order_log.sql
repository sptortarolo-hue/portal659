ALTER TABLE order_status_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role can insert log' AND tablename = 'order_status_log') THEN
    DROP POLICY "Service role can insert log" ON order_status_log;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role can read log' AND tablename = 'order_status_log') THEN
    DROP POLICY "Service role can read log" ON order_status_log;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Vendors can insert status log' AND tablename = 'order_status_log') THEN
    CREATE POLICY "Vendors can insert status log" ON order_status_log
      FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM orders
          WHERE orders.id = order_status_log.order_id
          AND orders.vendor_id IN (
            SELECT id FROM vendors WHERE user_id = auth.uid()
          )
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read order log' AND tablename = 'order_status_log') THEN
    CREATE POLICY "Anyone can read order log" ON order_status_log
      FOR SELECT
      USING (true);
  END IF;
END $$;
