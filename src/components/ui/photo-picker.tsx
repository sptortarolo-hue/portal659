"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PhotoPickerProps {
  /** Recibe el archivo seleccionado (o null si se cancela). */
  onFile?: (file: File | null) => void;
  /** Permitir seleccionar múltiples archivos (galería). */
  multiple?: boolean;
  /** Callback para múltiples archivos. Si se pasa, tiene prioridad sobre onFile. */
  onFiles?: (files: File[]) => void;
  disabled?: boolean;
  accept?: string;
  className?: string;
  /** Etiqueta del botón de cámara. */
  cameraLabel?: string;
  /** Etiqueta del botón de galería. */
  galleryLabel?: string;
  /** Mostrar solo cámara, solo galería, o ambos (default). */
  mode?: "both" | "camera" | "gallery";
  /** Tamaño compacto. */
  size?: "sm" | "default";
}

/**
 * Selector de foto con dos botones explícitos: Cámara (capture="environment")
 * y Galería. En desktop ambos abren el selector de archivos del SO; en mobile
 * el de cámara abre la cámara trasera directamente.
 */
export function PhotoPicker({
  onFile,
  multiple = false,
  onFiles,
  disabled = false,
  accept = "image/*",
  className,
  cameraLabel = "📷 Cámara",
  galleryLabel = "🖼️ Galería",
  mode = "both",
  size = "sm",
}: PhotoPickerProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) {
      onFile?.(null);
      return;
    }
    const arr = Array.from(list);
    if (onFiles) {
      onFiles(arr);
      return;
    }
    onFile?.(arr[0] ?? null);
  }

  const showCamera = mode === "both" || mode === "camera";
  const showGallery = mode === "both" || mode === "gallery";

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {showCamera && (
        <>
          <Button
            type="button"
            size={size}
            variant="outline"
            disabled={disabled}
            onClick={() => cameraRef.current?.click()}
          >
            {cameraLabel}
          </Button>
          <input
            ref={cameraRef}
            type="file"
            accept={accept}
            capture="environment"
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </>
      )}
      {showGallery && (
        <>
          <Button
            type="button"
            size={size}
            variant="outline"
            disabled={disabled}
            onClick={() => galleryRef.current?.click()}
          >
            {galleryLabel}
          </Button>
          <input
            ref={galleryRef}
            type="file"
            accept={accept}
            multiple={multiple}
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </>
      )}
    </div>
  );
}
