-- Bot Studio — backfill de la configuración que hoy vive en el código.
-- Aplicar:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-bot-studio-backfill.sql
--
-- Llena nombre, saludo, tono y brief "inicial" para que la ficha del agente
-- NO aparezca vacía. Lo que el usuario haya editado se respeta (solo llena vacíos).

UPDATE public.bot_agents
SET
  greeting = COALESCE(NULLIF(greeting, ''),
    CASE WHEN key = 'portal' THEN '¡Hola! 👋 Soy el asistente de Portal 659, el centro comercial de tu barrio.'
         ELSE '¡Hola! 👋 Mirá lo que tenemos y pedilo por acá.' END),
  brief = CASE
    WHEN key = 'portal' THEN COALESCE(NULLIF(brief, '{}'::jsonb), '{
      "instructions":"Ayudar a los vecinos a descubrir comercios de la zona y armar pedidos por WhatsApp de un solo comercio a la vez.",
      "business":"Portal 659 — el centro comercial de tu barrio. Sicardi y Garibaldi.",
      "products":"Productos y servicios de los comercios de la zona activa.",
      "audience":"Vecinos del barrio que quieren comprar cerca.",
      "always":["Usar español rioplatense","Respetar el catálogo real del comercio elegido","Ofrecer el link del micrositio cuando ayude"],
      "never":["Inventar productos, precios ni disponibilidad","Mezclar productos de dos comercios en un pedido","Pedir datos sensibles"]
    }'::jsonb)
    WHEN brief IS NULL OR brief = '{}'::jsonb THEN '{
      "instructions":"Mostrar el catálogo del comercio y tomar pedidos o consultas por WhatsApp.",
      "products":"Productos y servicios del comercio.",
      "audience":"Clientes del barrio.",
      "always":["Usar el nombre real del comercio","Respetar stock y precios"],
      "never":["Inventar productos","Prometer disponibilidad sin confirmar"]
    }'::jsonb
    ELSE brief
  END
WHERE greeting IS NULL OR greeting = '' OR brief IS NULL OR brief = '{}'::jsonb;
