import { encodePng, FONT_NAME, loadPureImage, loadSharp, regularFontName } from "./printer-image";
import { measureTextPx, type LabelOp, type LabelSpec } from "./label-spec";

/**
 * Renderer server-side de la etiqueta adhesiva (pureimage + sharp).
 *
 * Dibuja EXACTAMENTE las operaciones que armó `buildLabelSpec` — las mismas
 * que dibuja el canvas del panel — así el papel sale igual que el preview.
 * La salida es un PNG en blanco y negro (umbral) de 1 bit por píxel, que es lo
 * que necesitan los tres lenguajes de impresora.
 */

function baselineY(op: Extract<LabelOp, { kind: "text" }>): number {
  // Roboto asienta la línea base ~0.78 em por debajo del borde superior.
  return op.y + Math.round(op.size * 0.78);
}

export async function renderLabelPng(spec: LabelSpec): Promise<Buffer> {
  const PI = await loadPureImage();
  const sharp = await loadSharp();

  const canvas = PI.make(spec.widthPx, spec.heightPx);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, spec.widthPx, spec.heightPx);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  for (const op of spec.ops) {
    if (op.kind === "rect") {
      ctx.fillStyle = "black";
      ctx.fillRect(op.x, op.y, op.w, op.h);
      continue;
    }
    if (op.kind === "chip") {
      // El ancho del chip lo decide el texto: se mide con la misma tabla que
      // usó el layout (la operación trae el alto, no el ancho).
      const w = Math.round(measureTextPx(op.text, op.size) + op.padX * 2);
      ctx.fillStyle = "black";
      ctx.fillRect(op.x, op.y, w, op.h);
      ctx.fillStyle = "white";
      ctx.font = `${op.size}px ${FONT_NAME}`;
      ctx.fillText(op.text, op.x + op.padX, op.y + Math.round(op.h * 0.74));
      ctx.fillStyle = "black";
      continue;
    }
    if (op.kind === "text") {
      ctx.fillStyle = "black";
      ctx.font = `${op.size}px ${op.bold ? FONT_NAME : regularFontName()}`;
      ctx.fillText(op.text, op.x, baselineY(op));
      continue;
    }
    if (op.kind === "bars") {
      ctx.fillStyle = "black";
      let x = op.x;
      for (let i = 0; i < op.runs.length; i++) {
        const w = op.runs[i] * op.module;
        if (i % 2 === 0) ctx.fillRect(Math.round(x), op.y, Math.max(1, Math.round(w)), op.h);
        x += w;
      }
      continue;
    }
  }

  const raw = await encodePng(PI, canvas);
  return await sharp(raw).grayscale().threshold(160).png().toBuffer();
}
