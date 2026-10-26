/**
 * Día (date) de las métricas first-party del portal
 * (portal_page_views / portal_events) SIEMPRE en huso de Argentina.
 *
 * El contenedor de Postgres corre en UTC: con CURRENT_DATE (o el default de
 * columna) todo lo que pasa después de las 21:00 AR quedaba sellado con la
 * fecha del día siguiente y los gráficos de /admin "ya mostraban mañana".
 *
 * Este snippet es la ÚNICA fuente: lo usan los beacons al insertar (columna
 * day explícita) y las lecturas de /api/admin/traffic, así escritura y
 * lectura siempre coinciden.
 */
export const AR_DAY_SQL = `(now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date`;
