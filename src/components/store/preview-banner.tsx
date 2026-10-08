export function PreviewBanner({ menuQrOnly = false, catalog = false }: { menuQrOnly?: boolean; catalog?: boolean }) {
  return (
    <div className="bg-amber-400 text-amber-950 text-center text-xs sm:text-sm font-semibold px-4 py-2">
      🧪 Modo prueba — este comercio aún no es público. Solo visible con este link.
      {menuQrOnly && (
        <span className="block font-normal">
          {catalog ? "El catálogo está en Solo-QR" : "El menú está en Solo-QR"}: el público no lo ve en tu tienda (solo por QR).
        </span>
      )}
    </div>
  );
}
