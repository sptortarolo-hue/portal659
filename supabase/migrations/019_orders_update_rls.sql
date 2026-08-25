-- Policy: vendors can update their own orders
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Vendedores actualizan sus pedidos' AND tablename = 'orders') THEN
    CREATE POLICY "Vendedores actualizan sus pedidos"
      ON orders FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM vendors
          WHERE vendors.id = orders.vendor_id
            AND vendors.user_id = auth.uid()
        )
      );
  END IF;
END $$;
