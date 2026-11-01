type Props = {
  /** Código corto de la pantalla (p. ej. "k7f2"), si la migración está aplicada. */
  shortCode?: string | null;
  /** URL corta ya armada (sin https://), para copiar/tipear en la tele. */
  shortUrl?: string | null;
};

/**
 * GUÍA DE USO DE LA PANTALLA TV.
 *
 * Contenido puro (sin estado ni fetch): lo renderiza el modal del panel y,
 * si algún día se publica como manual público, se reutiliza tal cual.
 *
 * El orden de las opciones para Android TV es a propósito:
 *   1. Chrome + "Instalar app" (la PWA): lo más simple, queda un ícono.
 *   2. Fully Kiosk Browser: la ÚLTIMA opción, para TVs sin navegador o sin
 *      la opción de instalar (kiosco real: sin barra, pantalla siempre on).
 */
export function TvGuideContent({ shortCode, shortUrl }: Props) {
  return (
    <div className="space-y-6 text-sm leading-relaxed">
      {/* 1. Los 3 pasos */}
      <section>
        <h3 className="font-display text-base font-bold">En 3 pasos</h3>
        <ol className="mt-2 space-y-2">
          <li className="flex gap-3">
            <span className="font-bold text-primary">1.</span>
            <span>
              Creá la pantalla y tocá <strong>Publicar</strong>. Si no publicás, la tele muestra la
              versión anterior.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-bold text-primary">2.</span>
            <span>
              Tocá <strong>Ver QR</strong> y escanealo con el celular (o copiá el link). El QR abre
              una pantalla desde la que le podés mandar la carta a la tele.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-bold text-primary">3.</span>
            <span>
              En la tele, abrí el link en Chrome y dejalo en pantalla completa. En menos de un minuto
              el panel te marca la pantalla como <strong>Conectada</strong>.
            </span>
          </li>
        </ol>
      </section>

      {/* 2. Android TV */}
      <section>
        <h3 className="font-display text-base font-bold">En Android TV</h3>
        <p className="mt-1 text-muted-foreground">
          Chromecast con Google TV, Nvidia Shield o un Smart TV con Android TV.
        </p>
        <ol className="mt-2 space-y-2">
          <li className="flex gap-3">
            <span className="font-bold text-primary">1.</span>
            <span>
              Abrí <strong>Chrome</strong> en la tele y entrá al link.
              {shortUrl && (
                <>
                  {" "}
                  Te queda más fácil con la dirección corta:{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] font-semibold text-foreground">
                    {shortUrl}
                  </code>
                  {shortCode && (
                    <span className="text-muted-foreground"> (código: {shortCode})</span>
                  )}
                </>
              )}
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-bold text-primary">2.</span>
            <span>
              Tocá el menú <strong>⋮</strong> → <strong>Instalar app</strong> (en algunos aparatos:
              “Agregar a pantalla de inicio”).
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-bold text-primary">3.</span>
            <span>
              Listo: queda un ícono en la tele que abre la carta <strong>sola y a pantalla
              completa</strong>, como si fuera una app. Si la tele se reinicia, un toque y vuelve.
            </span>
          </li>
        </ol>
        <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
          <strong className="text-foreground">Última opción — Fully Kiosk Browser:</strong> si tu tele
          no tiene Chrome, no aparece la opción de instalar o querés un kiosco 100% bloqueado,
          instalá <strong className="text-foreground">Fully Kiosk Browser</strong>: en{" "}
          <em>Settings → Start URL</em> pegá el link, activá <em>Kiosk mode</em> y{" "}
          <em>Keep screen on</em>. Es gratis y funciona en cualquier Android TV.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Y en <em>Ajustes → Pantalla</em> dejá el <strong>protector de pantalla desactivado</strong>,
          así la tele no se duerme a mitad de la carta.
        </p>
      </section>

      {/* 3. Otros televisores */}
      <section>
        <h3 className="font-display text-base font-bold">En otros televisores</h3>
        <ul className="mt-2 space-y-2">
          <li>
            <strong>Samsung (Tizen)</strong> — Abrí <em>Samsung Internet</em>, pegá el link, menú ☰ →{" "}
            <strong>Pantalla completa</strong>. Después: Configuración → General → Administración de
            energía → <strong>Apagado automático: desactivado</strong>.
          </li>
          <li>
            <strong>LG (webOS)</strong> — Instalá <em>Web Browser</em> desde LG Content Store, pegá el
            link, menú → <strong>Pantalla completa</strong>. Después: General → <strong>Modo de
            suspensión: desactivado</strong>.
          </li>
          <li>
            <strong>Amazon Fire TV</strong> — Abrí <em>Silk Browser</em>, pegá el link, menú →{" "}
            <strong>Pantalla completa</strong>. Después: Pantalla y sonidos → <strong>Protector de
            pantalla: desactivado</strong>.
          </li>
          <li>
            <strong>PC o Mac</strong> — Abrí el link en Chrome o Edge y presioná <strong>F11</strong>.
          </li>
        </ul>
      </section>

      {/* 4. Tips */}
      <section>
        <h3 className="font-display text-base font-bold">Tips</h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
          <li>La carta está diseñada para <strong className="text-foreground">1920×1080 (1080p)</strong> y en horizontal. En 4K se escala sin pérdida.</li>
          <li>En locales con mucha luz subí el brillo; de noche el tema <em>Noche</em> del editor se lee mejor.</li>
          <li>La tele <strong className="text-foreground">se actualiza sola</strong> cuando publicás cambios, y hace una recarga preventiva cada 6 horas.</li>
          <li>Si quedó con una carta vieja: presioná <strong className="text-foreground">F5</strong> o reiniciá el navegador.</li>
          <li>Si se perdió internet, la tele sigue mostrando la última carta que tenía cargada.</li>
          <li>¿Se filtró el link? Tocá <strong className="text-foreground">Rotar link</strong>: la tele vieja deja de recibir la carta.</li>
        </ul>
      </section>

      {/* 5. Problemas frecuentes */}
      <section>
        <h3 className="font-display text-base font-bold">Problemas frecuentes</h3>
        <div className="mt-2 overflow-hidden rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Qué pasa</th>
                <th className="px-3 py-2 font-semibold">Por qué</th>
                <th className="px-3 py-2 font-semibold">Qué hacer</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <td className="px-3 py-2 font-medium">Pantalla negra</td>
                <td className="px-3 py-2 text-muted-foreground">Rotaste el link o borraste la pantalla</td>
                <td className="px-3 py-2 text-muted-foreground">Copiá el link actual desde el panel</td>
              </tr>
              <tr className="border-t border-border">
                <td className="px-3 py-2 font-medium">“Sin señal” en el panel</td>
                <td className="px-3 py-2 text-muted-foreground">La tele no tiene la página abierta</td>
                <td className="px-3 py-2 text-muted-foreground">
                  Abrí el link en la tele y dejalo abierto (el panel se entera en menos de 1 minuto)
                </td>
              </tr>
              <tr className="border-t border-border">
                <td className="px-3 py-2 font-medium">Se apaga sola</td>
                <td className="px-3 py-2 text-muted-foreground">Protector de pantalla / suspensión</td>
                <td className="px-3 py-2 text-muted-foreground">Desactivá el apagado automático en el TV</td>
              </tr>
              <tr className="border-t border-border">
                <td className="px-3 py-2 font-medium">La carta no cambia</td>
                <td className="px-3 py-2 text-muted-foreground">Caché del navegador</td>
                <td className="px-3 py-2 text-muted-foreground">F5 o reiniciá el navegador</td>
              </tr>
              <tr className="border-t border-border">
                <td className="px-3 py-2 font-medium">No aparece el QR de “Pedí online”</td>
                <td className="px-3 py-2 text-muted-foreground">Falta un interruptor</td>
                <td className="px-3 py-2 text-muted-foreground">
                  En el editor: <em>QR de pedidos online → ON</em>, y el local tiene que vender online
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 6. La app de Portal 659 */}
      <section>
        <h3 className="font-display text-base font-bold">La app de Portal 659</h3>
        <p className="mt-1 text-muted-foreground">
          La app del <strong className="text-foreground">Play Store</strong> es para el{" "}
          <strong className="text-foreground">celular y la tablet</strong>: panel, pedidos, mensajes y
          favoritos. En la tele no hace falta instalar nada: abrís el link en Chrome y instalás la
          carta como app en un toque. (La app todavía está en prueba cerrada.)
        </p>
      </section>
    </div>
  );
}
