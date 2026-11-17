/**
 * Renderer de la etiqueta adhesiva para el NAVEGADOR (preview en vivo).
 *
 * Recorre las MISMAS operaciones que el renderer del servidor — el preview
 * y el papel coinciden por construcción. La única diferencia permitida es la
 * fuente: acá se usa una sans bold del sistema; el ancho real del texto lo
 * fija la tabla de métricas del layout, no `ctx.measureText`.
 */
import { measureTextPx, type LabelSpec } from "./label-spec";

const WHITE = "#ffffff";
const BLACK = "#000000";

function font(size: number, bold: boolean): string {
  return `${bold ? "800" : "400"} ${size}px Arial, Helvetica, sans-serif`;
}

export function drawLabel(canvas: HTMLCanvasElement, spec: LabelSpec): void {
  canvas.width = spec.widthPx;
  canvas.height = spec.heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, spec.widthPx, spec.heightPx);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  for (const op of spec.ops) {
    if (op.kind === "rect") {
      ctx.fillStyle = BLACK;
      ctx.fillRect(op.x, op.y, op.w, op.h);
      continue;
    }
    if (op.kind === "chip") {
      const w = measureTextPx(op.text, op.size) + op.padX * 2;
      ctx.fillStyle = BLACK;
      ctx.fillRect(op.x, op.y, w, op.h);
      ctx.fillStyle = WHITE;
      ctx.font = font(op.size, true);
      ctx.fillText(op.text, op.x + op.padX, op.y + Math.round(op.h * 0.74));
      ctx.fillStyle = BLACK;
      continue;
    }
    if (op.kind === "text") {
      ctx.fillStyle = BLACK;
      ctx.font = font(op.size, op.bold !== false);
      ctx.fillText(op.text, op.x, op.y + Math.round(op.size * 0.78));
      continue;
    }
    if (op.kind === "bars") {
      ctx.fillStyle = BLACK;
      let x = op.x;
      for (let i = 0; i < op.runs.length; i++) {
        const w = op.runs[i] * op.module;
        if (i % 2 === 0) ctx.fillRect(Math.round(x), op.y, Math.max(1, Math.round(w)), op.h);
        x += w;
      }
      continue;
    }
  }
}
