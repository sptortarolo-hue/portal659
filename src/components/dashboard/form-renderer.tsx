"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { isAffirmative, type FormField, type ShowIf } from "@/lib/ficha-templates";

function showIfMet(showIf: ShowIf | null | undefined, answers: Record<string, unknown>): boolean {
  if (!showIf || typeof showIf !== "object") return true;
  const current = answers[showIf.field];
  const want = showIf.equals;
  if (Array.isArray(want)) {
    if (Array.isArray(current)) return current.some((c) => want.map(String).includes(String(c)));
    return want.map(String).includes(String(current ?? ""));
  }
  if (Array.isArray(current)) return current.map(String).includes(String(want));
  return String(current ?? "") === String(want);
}

function SignaturePad({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !value) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pos(e: React.PointerEvent): [number, number] {
    const canvas = ref.current!;
    const r = canvas.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * canvas.width,
      ((e.clientY - r.top) / r.height) * canvas.height,
    ];
  }

  function finish() {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = ref.current;
    if (canvas) onChange(canvas.toDataURL("image/png"));
  }

  return (
    <div>
      <canvas
        ref={ref}
        width={600}
        height={220}
        className={`w-full rounded-md border border-input bg-white touch-none ${disabled ? "opacity-60" : "cursor-crosshair"}`}
        style={{ height: 140 }}
        onPointerDown={(e) => {
          if (disabled) return;
          drawing.current = true;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const ctx = ref.current?.getContext("2d");
          if (ctx) {
            const [x, y] = pos(e);
            ctx.lineWidth = 3;
            ctx.lineCap = "round";
            ctx.strokeStyle = "#111";
            ctx.beginPath();
            ctx.moveTo(x, y);
          }
        }}
        onPointerMove={(e) => {
          if (!drawing.current || disabled) return;
          const ctx = ref.current?.getContext("2d");
          if (!ctx) return;
          const [x, y] = pos(e);
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={finish}
        onPointerLeave={finish}
      />
      {!disabled && (
        <div className="flex gap-2 mt-1.5">
          <Button
            size="sm"
            variant="outline"
            type="button"
            onClick={() => {
              const canvas = ref.current;
              canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
              onChange("");
            }}
          >
            Limpiar firma
          </Button>
          {value && <span className="text-xs text-green-700 self-center">✅ Firmado</span>}
        </div>
      )}
    </div>
  );
}

/**
 * Renderiza un modelo de ficha (panel y público). Interpreta show_if en vivo,
 * firma en canvas y fotos vía service-upload del comercio.
 */
export function FormRenderer({
  fields,
  answers,
  onChange,
  disabled = false,
  vendorId,
  uploadNote,
}: {
  fields: FormField[];
  answers: Record<string, unknown>;
  onChange: (fieldId: string, value: unknown) => void;
  disabled?: boolean;
  /** vendorId para subir fotos (service-upload público). Sin esto, photo queda deshabilitado. */
  vendorId?: string | null;
  uploadNote?: string;
}) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadMsg, setUploadMsg] = useState("");
  const [otherOn, setOtherOn] = useState<Record<string, boolean>>({});

  function set(id: string, value: unknown) {
    onChange(id, value);
  }

  async function uploadPhotos(field: FormField, files: FileList | null) {
    if (!files || files.length === 0 || !vendorId) return;
    setUploading(field.id);
    setUploadMsg("");
    try {
      const form = new FormData();
      Array.from(files).slice(0, field.maxPhotos || 3).forEach((f) => form.append("files", f));
      const res = await fetch(`/api/service-upload?vendorId=${vendorId}`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (data.error || !Array.isArray(data.urls)) {
        setUploadMsg(data.error || "No se pudieron subir");
        return;
      }
      const prev = Array.isArray(answers[field.id]) ? (answers[field.id] as string[]) : [];
      set(field.id, [...prev, ...data.urls].slice(0, field.maxPhotos || 3));
    } catch {
      setUploadMsg("Error de conexión");
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="space-y-4">
      {fields.map((f) => {
        if (!showIfMet(f.show_if, answers)) return null;
        const val = answers[f.id];
        switch (f.type) {
          case "section":
            return (
              <h4 key={f.id} className="font-semibold text-sm pt-2 border-b border-border pb-1">
                {f.label}
              </h4>
            );
          case "text":
          case "date":
            return (
              <div key={f.id}>
                <Label className="text-xs">{f.label}{f.required ? " *" : ""}</Label>
                <Input
                  type={f.type === "date" ? "date" : "text"}
                  value={typeof val === "string" ? val : ""}
                  onChange={(e) => set(f.id, e.target.value)}
                  disabled={disabled}
                  className="mt-1 h-9 text-sm"
                />
              </div>
            );
          case "textarea":
            return (
              <div key={f.id}>
                <Label className="text-xs">{f.label}{f.required ? " *" : ""}</Label>
                <Textarea
                  value={typeof val === "string" ? val : ""}
                  onChange={(e) => set(f.id, e.target.value)}
                  disabled={disabled}
                  rows={2}
                  className="mt-1 text-sm"
                />
              </div>
            );
          case "scale": {
            const min = f.min ?? 0;
            const max = f.max ?? 10;
            const cur = Number(val);
            return (
              <div key={f.id}>
                <Label className="text-xs">{f.label}{f.required ? " *" : ""}</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
                    <button
                      key={n}
                      type="button"
                      disabled={disabled}
                      onClick={() => set(f.id, String(n))}
                      className={`h-9 w-9 rounded-full border text-sm font-medium transition-colors ${
                        cur === n ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            );
          }
          case "check": {
            const cur = typeof val === "string" ? val : "";
            const detailKey = `${f.id}__detail`;
            const detail = typeof answers[detailKey] === "string" ? (answers[detailKey] as string) : "";
            return (
              <div key={f.id} className="rounded-lg border border-border px-3 py-2.5">
                <p className="text-sm font-medium">
                  {f.alert && isAffirmative(cur) && <span title={f.alertLabel || "Riesgo"}>🚨 </span>}
                  {f.label}{f.required ? " *" : ""}
                </p>
                <div className="flex gap-2 mt-2">
                  {(["no", "sí"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      disabled={disabled}
                      onClick={() => set(f.id, opt)}
                      className={`flex-1 h-9 rounded-md border text-sm font-medium capitalize transition-colors ${
                        cur === opt ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                      }`}
                    >
                      {opt === "no" ? "No" : "Sí"}
                    </button>
                  ))}
                </div>
                {f.detail && isAffirmative(cur) && (
                  <Input
                    value={detail}
                    onChange={(e) => onChange(detailKey, e.target.value)}
                    disabled={disabled}
                    placeholder={f.detailLabel || "Detalle"}
                    className="mt-2 h-9 text-sm"
                  />
                )}
              </div>
            );
          }
          case "multiselect": {
            const cur: string[] = Array.isArray(val) ? val.map(String) : [];
            const otherKey = `${f.id}__other`;
            const other = typeof answers[otherKey] === "string" ? (answers[otherKey] as string) : "";
            const usesOther = !!otherOn[f.id] || cur.includes(OTRO_LABEL) || other !== "";
            return (
              <div key={f.id}>
                <Label className="text-xs">{f.label}{f.required ? " *" : ""}</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {(f.options || []).map((opt) => {
                    const active = cur.includes(opt);
                    return (
                      <button
                        key={opt}
                        type="button"
                        disabled={disabled}
                        onClick={() =>
                          set(f.id, active ? cur.filter((c) => c !== opt) : [...cur, opt])
                        }
                        className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                          active ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground"
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                  {f.allowOther && (
                    <button
                      key="__other"
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        const on = !usesOther;
                        setOtherOn((p) => ({ ...p, [f.id]: on }));
                        if (!on) {
                          onChange(otherKey, "");
                          set(f.id, cur.filter((c) => c !== OTRO_LABEL));
                        } else if (!cur.includes(OTRO_LABEL)) {
                          set(f.id, [...cur, OTRO_LABEL]);
                        }
                      }}
                      className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                        usesOther ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground"
                      }`}
                    >
                      Otra
                    </button>
                  )}
                </div>
                {f.allowOther && usesOther && (
                  <Input
                    value={other}
                    onChange={(e) => onChange(otherKey, e.target.value)}
                    disabled={disabled}
                    placeholder="¿Cuál?"
                    className="mt-2 h-9 text-sm"
                  />
                )}
              </div>
            );
          }
          case "select-one":
            return (
              <div key={f.id}>
                <Label className="text-xs">{f.label}{f.required ? " *" : ""}</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {(f.options || []).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      disabled={disabled}
                      onClick={() => set(f.id, opt)}
                      className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                        String(val ?? "") === opt ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            );
          case "photo": {
            const urls: string[] = Array.isArray(val) ? val.map(String) : [];
            return (
              <div key={f.id}>
                <Label className="text-xs">{f.label}{f.required ? " *" : ""}</Label>
                {urls.length > 0 && (
                  <div className="flex gap-2 flex-wrap mt-1.5">
                    {urls.map((u, i) => (
                      <div key={`${u}-${i}`} className="relative">
                        <img src={u} alt="" className="h-20 w-20 rounded-lg object-cover border border-border" />
                        {!disabled && (
                          <button
                            type="button"
                            onClick={() => set(f.id, urls.filter((_, j) => j !== i))}
                            className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white text-[10px] leading-none"
                            title="Quitar"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {!disabled && vendorId && urls.length < (f.maxPhotos || 3) && (
                  <div className="mt-1.5">
                    <label className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-2 text-xs font-medium cursor-pointer hover:bg-muted">
                      📷 {uploading === f.id ? "Subiendo..." : "Agregar foto"}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => uploadPhotos(f, e.target.files)}
                      />
                    </label>
                    {uploadNote && <p className="text-[11px] text-muted-foreground mt-1">{uploadNote}</p>}
                  </div>
                )}
                {!disabled && !vendorId && (
                  <p className="text-[11px] text-muted-foreground mt-1">Fotos no disponibles acá.</p>
                )}
                {uploading === f.id && uploadMsg && <p className="text-xs text-red-600 mt-1">{uploadMsg}</p>}
              </div>
            );
          }
          case "signature":
            return (
              <div key={f.id}>
                <Label className="text-xs">{f.label}{f.required ? " *" : ""}</Label>
                <div className="mt-1.5">
                  <SignaturePad
                    value={typeof val === "string" ? val : ""}
                    onChange={(d) => set(f.id, d)}
                    disabled={disabled}
                  />
                </div>
              </div>
            );
          case "consent":
            return (
              <div key={f.id} className="rounded-lg bg-muted px-3 py-2.5">
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{f.text || f.label}</p>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

const OTRO_LABEL = "Otro";
