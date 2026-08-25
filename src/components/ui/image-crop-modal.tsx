"use client";

import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import { getCroppedImg, Area } from "@/lib/crop-image";
import { Button } from "@/components/ui/button";

type ImageCropModalProps = {
  imageSrc: string;
  aspect: number;
  title?: string;
  onCropComplete: (file: File, previewUrl: string) => void;
  onCancel: () => void;
};

export function ImageCropModal({
  imageSrc,
  aspect,
  title = "Ajustá tu foto",
  onCropComplete,
  onCancel,
}: ImageCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);

  const onCropChange = useCallback((c: { x: number; y: number }) => setCrop(c), []);
  const onZoomChange = useCallback((z: number) => setZoom(z), []);

  const onCropCompleteInternal = useCallback(
    (_croppedArea: Area, croppedAreaPixels: Area) => {
      setCroppedAreaPixels(croppedAreaPixels);
    },
    []
  );

  async function handleConfirm() {
    if (!croppedAreaPixels) return;
    setProcessing(true);
    const file = await getCroppedImg(imageSrc, croppedAreaPixels, 0, "cropped.jpg");
    if (file) {
      const previewUrl = URL.createObjectURL(file);
      onCropComplete(file, previewUrl);
    }
    setProcessing(false);
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex flex-col items-center justify-center p-4">
      <h3 className="text-white font-semibold text-lg mb-3">{title}</h3>

      <div className="relative w-full max-w-lg aspect-[3/2] bg-black rounded-xl overflow-hidden">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          onCropChange={onCropChange}
          onZoomChange={onZoomChange}
          onCropComplete={onCropCompleteInternal}
          cropShape="rect"
          showGrid
        />
      </div>

      <div className="w-full max-w-lg mt-4">
        <label className="text-white text-xs mb-1 block">Zoom</label>
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-full accent-white"
        />
      </div>

      <div className="flex gap-3 mt-5">
        <Button variant="outline" onClick={onCancel} className="text-white border-white/30 hover:bg-white/10">
          Cancelar
        </Button>
        <Button onClick={handleConfirm} disabled={processing || !croppedAreaPixels}>
          {processing ? "Procesando..." : "Usar esta foto"}
        </Button>
      </div>
    </div>
  );
}
