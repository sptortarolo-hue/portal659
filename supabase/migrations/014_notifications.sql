-- Notificaciones in-app
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  type TEXT NOT NULL DEFAULT 'info',
  read BOOLEAN DEFAULT false,
  link TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read) WHERE read = false;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios ven sus notificaciones" ON notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Sistema puede insertar notificaciones" ON notifications
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Usuarios pueden marcar como leídas" ON notifications
  FOR UPDATE USING (auth.uid() = user_id);
