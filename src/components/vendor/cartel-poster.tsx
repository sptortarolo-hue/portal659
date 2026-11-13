import {
  cartelCopy,
  cartelDomain,
  cartelHoursSummary,
  cartelPalette,
  cartelPhone,
  cartelRubro,
  type CartelTarget,
  type CartelTemplate,
} from "@/lib/cartel";

/**
 * Cartel imprimible con QR — render único.
 *
 * El MISMO componente se usa en dos lugares:
 *  - la página /vendor/carta-qr (preview en el navegador + impresión), y
 *  - la ruta /api/vendor/cartel/[slug] (PNG/PDF con satori).
 *
 * Por eso va con estilos INLINE y un subconjunto de CSS compatible con
 * satori (flex, absolute, border-radius, gradientes, rgba). Sin Tailwind
 * (satori no lo interpreta), sin emojis (satori no trae fuente de emoji),
 * sin box-shadow/filter/transform (no los soporta de forma fiable).
 *
 * Todo se dimensiona con `u(n)`: el diseño base es de 800px de ancho y
 * `u()` escala a cualquier ancho (preview 420px, PNG 1240px, impresión
 * 794px). Así preview y archivo salen idénticos.
 */

export type CartelPosterData = {
  storeName: string;
  slug: string;
  vertical: string | null;
  target: CartelTarget;
  rubro: string | null;
  barrio: string | null;
  address: string | null;
  hours: string | null;
  whatsapp: string | null;
  instagram: string | null;
  logoUrl: string | null;
  imageUrl: string | null;
  /** QR como data URL (nunca <img> de un archivo plano). */
  qrDataUrl: string;
  siteUrl: string;
};

type Props = {
  data: CartelPosterData;
  template: CartelTemplate;
  width: number;
  height: number;
  /** Versión corta (stickers chicos): menos texto, QR grande. */
  compact?: boolean;
};

const BASE_W = 800;
const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

type Tone = {
  bg: string;
  bgImage: string | null;
  overlay: string | null;
  text: string;
  sub: string;
  card: string;
  cardBorder: string;
  pillBg: string;
  pillText: string;
  pillBorder: string;
  numBg: string;
  numText: string;
  badgeBg: string;
  badgeText: string;
  footer: string;
  info: string;
  decor: string | null;
};

export function CartelPoster({ data, template, width, height, compact = false }: Props) {
  const scale = width / BASE_W;
  const u = (n: number) => Math.round(n * scale);

  const palette = cartelPalette(data.vertical);
  const copy = cartelCopy(data.vertical, data.target);
  const rubro = cartelRubro(data.rubro);
  const barrio = (data.barrio || "").trim();
  const address = (data.address || "").trim();
  const hours = cartelHoursSummary(data.hours);
  const phone = cartelPhone(data.whatsapp);
  const domain = cartelDomain(data.siteUrl);

  const isMinimal = template === "minimal";
  const usePhoto = template === "foto" && !!data.imageUrl;

  const tone: Tone = isMinimal
    ? {
        bg: "#ffffff",
        bgImage: null,
        overlay: null,
        text: "#111827",
        sub: "#4b5563",
        card: "#ffffff",
        cardBorder: "#111827",
        pillBg: "#f3f4f6",
        pillText: "#111827",
        pillBorder: "#e5e7eb",
        numBg: "#111827",
        numText: "#ffffff",
        badgeBg: "#111827",
        badgeText: "#ffffff",
        footer: "#6b7280",
        info: "#374151",
        decor: null,
      }
    : {
        bg: palette.hex,
        bgImage: usePhoto ? data.imageUrl : null,
        overlay: usePhoto ? "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.80) 100%)" : null,
        text: "#ffffff",
        sub: "rgba(255,255,255,0.88)",
        card: "#ffffff",
        cardBorder: "rgba(255,255,255,0.55)",
        pillBg: "rgba(255,255,255,0.18)",
        pillText: "#ffffff",
        pillBorder: "rgba(255,255,255,0.35)",
        numBg: "#ffffff",
        numText: isMinimal ? "#111827" : palette.dark,
        badgeBg: "#ffffff",
        badgeText: isMinimal ? "#ffffff" : palette.dark,
        footer: "rgba(255,255,255,0.78)",
        info: "rgba(255,255,255,0.94)",
        decor: "rgba(255,255,255,0.12)",
      };

  const backgroundImage = isMinimal
    ? null
    : usePhoto
      ? `url(${data.imageUrl})`
      : `linear-gradient(135deg, ${palette.hex} 0%, ${palette.dark} 100%)`;

  const initial = (data.storeName || "?").trim().charAt(0).toUpperCase();

  // satori NO tolera `undefined`/`null` en los estilos (falla el render):
  // las claves opcionales se agregan recién cuando tienen valor.
  const rootStyle: Record<string, unknown> = {
    width,
    height,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "hidden",
    backgroundColor: tone.bg,
    fontFamily: FONT,
    paddingTop: u(compact ? 28 : 40),
    paddingBottom: u(compact ? 28 : 46),
    paddingLeft: u(40),
    paddingRight: u(40),
  };
  if (backgroundImage) {
    rootStyle.backgroundImage = backgroundImage;
    if (usePhoto) {
      rootStyle.backgroundSize = "cover";
      rootStyle.backgroundPosition = "center";
    }
  }

  const infoLines: string[] = [];
  if (address) infoLines.push(address);
  if (barrio && !address.toLowerCase().includes(barrio.toLowerCase())) infoLines.push(barrio);
  if (hours) infoLines.push(hours);
  if (phone) infoLines.push(phone);
  if (data.instagram) infoLines.push(`@${data.instagram.replace(/^@/, "")}`);

  const steps = copy.steps;

  return (
    <div style={rootStyle}>
      {/* Formas decorativas (solo en las plantillas con color). */}
      {tone.decor && (
        <>
          <div
            style={{
              position: "absolute",
              top: -u(90),
              right: -u(80),
              width: u(260),
              height: u(260),
              borderRadius: 999,
              background: tone.decor,
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: -u(120),
              left: -u(90),
              width: u(300),
              height: u(300),
              borderRadius: 999,
              background: tone.decor,
            }}
          />
        </>
      )}

      {/* Overlay para legibilidad sobre la foto del local. */}
      {tone.overlay && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: tone.overlay,
          }}
        />
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          position: "relative",
          width: "100%",
        }}
      >
        {/* Logo */}
        {data.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.logoUrl}
            alt={data.storeName}
            width={u(compact ? 100 : 112)}
            height={u(compact ? 100 : 112)}
            style={{
              width: u(compact ? 100 : 112),
              height: u(compact ? 100 : 112),
              borderRadius: 999,
              objectFit: "cover",
              border: `${u(isMinimal ? 3 : 4)}px solid ${isMinimal ? "#111827" : "rgba(255,255,255,0.9)"}`,
              backgroundColor: "#ffffff",
            }}
          />
        ) : (
          <div
            style={{
              width: u(compact ? 100 : 112),
              height: u(compact ? 100 : 112),
              borderRadius: 999,
              backgroundColor: tone.card,
              color: palette.dark,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: u(compact ? 42 : 48),
              fontWeight: 800,
              border: `${u(isMinimal ? 3 : 4)}px solid ${isMinimal ? "#111827" : "rgba(255,255,255,0.9)"}`,
            }}
          >
            {initial}
          </div>
        )}

        {/* Nombre + rubro */}
        <div
          style={{
            fontSize: u(compact ? 38 : 46),
            fontWeight: 800,
            color: tone.text,
            textAlign: "center",
            lineHeight: 1.12,
            marginTop: u(16),
            maxWidth: "92%",
          }}
        >
          {data.storeName}
        </div>
        {(rubro || barrio) && (
          <div
            style={{
              fontSize: u(compact ? 18 : 21),
              color: tone.sub,
              textAlign: "center",
              marginTop: u(8),
              maxWidth: "90%",
            }}
          >
            {[rubro, barrio].filter(Boolean).join(" · ")}
          </div>
        )}

        {/* Título + bajada */}
        <div
          style={{
            fontSize: u(compact ? 25 : 30),
            fontWeight: 700,
            color: tone.text,
            textAlign: "center",
            marginTop: u(18),
            maxWidth: "92%",
            lineHeight: 1.15,
          }}
        >
          {copy.title}
        </div>
        {!compact && (
          <div
            style={{
              fontSize: u(20),
              color: tone.sub,
              textAlign: "center",
              marginTop: u(8),
              maxWidth: "88%",
              lineHeight: 1.3,
            }}
          >
            {copy.subtitle}
          </div>
        )}

        {/* QR */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: tone.card,
            borderRadius: u(28),
            border: `${u(isMinimal ? 3 : 2)}px solid ${tone.cardBorder}`,
            padding: u(compact ? 16 : 22),
            marginTop: u(compact ? 20 : 26),
          }}
        >
          {/* El QR es una grilla de píxeles generada por nosotros (data URL):
              no es una foto de galería, así que va con <img> directo. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.qrDataUrl}
            alt={`QR de ${data.storeName}`}
            width={u(compact ? 300 : 300)}
            height={u(compact ? 300 : 300)}
            style={{ width: u(compact ? 300 : 300), height: u(compact ? 300 : 300) }}
          />
        </div>

        {/* 3 pasos */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            marginTop: u(compact ? 18 : 24),
            gap: u(compact ? 8 : 10),
            maxWidth: "100%",
          }}
        >
          {steps.map((st, i) => (
            <div
              key={st.full}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: tone.pillBg,
                border: `${u(1)}px solid ${tone.pillBorder}`,
                borderRadius: 999,
                paddingLeft: u(compact ? 9 : 12),
                paddingRight: u(compact ? 12 : 16),
                paddingTop: u(compact ? 7 : 9),
                paddingBottom: u(compact ? 7 : 9),
              }}
            >
              <div
                style={{
                  width: u(compact ? 24 : 28),
                  height: u(compact ? 24 : 28),
                  borderRadius: 999,
                  backgroundColor: tone.numBg,
                  color: tone.numText,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: u(compact ? 13 : 15),
                  fontWeight: 800,
                  marginRight: u(8),
                }}
              >
                {i + 1}
              </div>
              <div
                style={{
                  fontSize: u(compact ? 15 : 16),
                  color: tone.pillText,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {compact ? st.short : st.full}
              </div>
            </div>
          ))}
        </div>

        {/* Badge (0% comisión, etc.) */}
        {copy.badge && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              backgroundColor: tone.badgeBg,
              color: tone.badgeText,
              borderRadius: 999,
              paddingLeft: u(20),
              paddingRight: u(20),
              paddingTop: u(9),
              paddingBottom: u(9),
              fontSize: u(compact ? 16 : 18),
              fontWeight: 800,
              marginTop: u(20),
            }}
          >
            {copy.badge}
          </div>
        )}

        {/* Datos del local */}
        {!compact && infoLines.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginTop: u(18),
              fontSize: u(16),
              color: tone.info,
              textAlign: "center",
              lineHeight: 1.55,
            }}
          >
            {infoLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        )}
      </div>

      {/* Pie */}
      <div
        style={{
          position: "absolute",
          bottom: u(compact ? 16 : 24),
          left: u(30),
          right: u(30),
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          fontSize: u(compact ? 13 : 14),
          color: tone.footer,
          lineHeight: 1.4,
        }}
      >
        <div style={{ fontWeight: 700 }}>Portal 659 · El centro comercial de tu barrio</div>
        {/* Una sola cadena: satori exige un solo hijo por div (o display:flex). */}
        <div style={{ marginTop: u(2) }}>
          {`${domain}/${data.target === "tienda" ? "tienda" : "carta"}/${data.slug}`}
        </div>
      </div>
    </div>
  );
}

/**
 * Hoja A4 con 4 stickers (2×2). Cada sticker es el mismo cartel en versión
 * compacta: se imprime una hoja y se recortan cuatro.
 */
export function CartelHoja({
  data,
  template,
  width,
  height,
}: {
  data: CartelPosterData;
  template: CartelTemplate;
  width: number;
  height: number;
}) {
  const cellW = Math.round(width / 2);
  const cellH = Math.round(height / 2);
  const cells = [0, 1, 2, 3];

  const cell = (i: number) => {
    const cellStyle: Record<string, unknown> = {
      width: cellW,
      height: cellH,
      display: "flex",
      overflow: "hidden",
    };
    if (i % 2 === 0) cellStyle.borderRight = "1px solid #e5e7eb";
    if (i < 2) cellStyle.borderBottom = "1px solid #e5e7eb";
    return (
      <div key={i} style={cellStyle}>
        <CartelPoster data={data} template={template} width={cellW} height={cellH} compact />
      </div>
    );
  };

  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#ffffff",
        fontFamily: FONT,
      }}
    >
      <div style={{ display: "flex", flexDirection: "row" }}>{cells.slice(0, 2).map(cell)}</div>
      <div style={{ display: "flex", flexDirection: "row" }}>{cells.slice(2, 4).map(cell)}</div>
    </div>
  );
}
