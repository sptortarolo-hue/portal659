"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export type FloorTable = {
  id: string;
  name: string;
  capacity: number;
  status: "libre" | "ocupada" | "reservada";
  x: number;
  y: number;
  width: number;
  height: number;
  shape: "square" | "round" | "rectangle";
  rotation: number;
};

type Props = {
  tables: FloorTable[];
  selectedId: string | null;
  onSelect: (t: FloorTable) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onShapeChange: (id: string, shape: FloorTable["shape"]) => void;
};

const SNAP = 10;
const MIN_SIZE = 20;
const MAX_SIZE = 400;

const STATUS_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  libre: { bg: "bg-emerald-100 dark:bg-emerald-900/40", border: "border-emerald-400", text: "text-emerald-800 dark:text-emerald-200" },
  ocupada: { bg: "bg-red-100 dark:bg-red-900/40", border: "border-red-400", text: "text-red-800 dark:text-red-200" },
  reservada: { bg: "bg-amber-100 dark:bg-amber-900/40", border: "border-amber-400", text: "text-amber-800 dark:text-amber-200" },
};

const SHAPE_RADIUS: Record<string, string> = {
  square: "rounded-lg",
  round: "rounded-full",
  rectangle: "rounded-lg",
};

export function FloorPlan({ tables, selectedId, onSelect, onMove, onResize, onShapeChange }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const dragOffset = useRef({ dx: 0, dy: 0 });
  const tablesRef = useRef(tables);
  tablesRef.current = tables;

  const snap = useCallback((v: number) => Math.round(v / SNAP) * SNAP, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, t: FloorTable) => {
      // En modo normal la apertura va por onClick (después de levantar el
      // dedo). Abrir en pointerdown causaba tap-through en mobile: el click
      // sintético al soltar caía sobre el producto del modal recién abierto.
      if (!editing) return;
      e.preventDefault();
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      dragOffset.current = {
        dx: e.clientX - rect.left - (t.x ?? 0),
        dy: e.clientY - rect.top - (t.y ?? 0),
      };
      setDragging(t.id);
      canvas.setPointerCapture(e.pointerId);
    },
    [editing, onSelect]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const t = tablesRef.current.find((x) => x.id === dragging);
      if (!t) return;
      const tw = t.width ?? 60;
      const th = t.height ?? 60;
      const x = Math.max(0, Math.min(rect.width - tw, snap(e.clientX - rect.left - dragOffset.current.dx)));
      const y = Math.max(0, Math.min(rect.height - th, snap(e.clientY - rect.top - dragOffset.current.dy)));
      onMove(t.id, x, y);
    },
    [dragging, onMove, snap]
  );

  const handlePointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  const handleResize = useCallback(
    (e: React.PointerEvent, t: FloorTable) => {
      e.preventDefault();
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(e.pointerId);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(MIN_SIZE, Math.min(MAX_SIZE, snap(e.clientX - rect.left - (t.x ?? 0))));
      const h = Math.max(MIN_SIZE, Math.min(MAX_SIZE, snap(e.clientY - rect.top - (t.y ?? 0))));
      onResize(t.id, w, h);
    },
    [onResize, snap]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block h-3 w-3 rounded-sm bg-emerald-400" /> Libre
          <span className="inline-block h-3 w-3 rounded-sm bg-red-400 ml-2" /> Ocupada
          <span className="inline-block h-3 w-3 rounded-sm bg-amber-400 ml-2" /> Reservada
        </div>
        <Button
          type="button"
          size="sm"
          variant={editing ? "default" : "outline"}
          onClick={() => setEditing(!editing)}
        >
          {editing ? "✓ Listo" : "✏️ Editar plano"}
        </Button>
      </div>

      <div
        ref={canvasRef}
        className="relative w-full overflow-hidden rounded-2xl border-2 border-dashed border-border bg-muted/30 select-none"
        style={{ height: "calc(100vh - 280px)", minHeight: 400, touchAction: editing ? "none" : "auto" }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {tables.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Agregá mesas para armar el plano del salón
          </div>
        )}
        {tables.map((t) => {
          const st = STATUS_STYLES[t.status] || STATUS_STYLES.libre;
          const isSelected = selectedId === t.id;
          const tx = t.x ?? 0;
          const ty = t.y ?? 0;
          const tw = t.width ?? 60;
          const th = t.height ?? 60;
          return (
            <div
              key={t.id}
              onPointerDown={editing ? (e) => handlePointerDown(e, t) : undefined}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(t);
              }}
              className={`absolute flex flex-col items-center justify-center border-2 transition-shadow ${st.bg} ${st.border} ${SHAPE_RADIUS[t.shape]} ${
                editing ? "cursor-move" : "cursor-pointer"
              } ${isSelected ? "ring-2 ring-primary ring-offset-1" : ""} ${dragging === t.id ? "opacity-80 shadow-lg z-10" : ""}`}
              style={{
                left: tx,
                top: ty,
                width: tw,
                height: th,
                transform: t.rotation ? `rotate(${t.rotation}deg)` : undefined,
              }}
            >
              <span className={`text-[10px] font-semibold leading-tight text-center px-0.5 truncate w-full ${st.text}`}>
                {t.name}
              </span>
              <span className={`text-[8px] ${st.text} opacity-70`}>
                {t.status === "ocupada" ? "Ocupada" : `${t.capacity} pers.`}
              </span>
              {editing && (
                <div
                  onPointerDown={(e) => handleResize(e, t)}
                  className="absolute -bottom-1.5 -right-1.5 h-3 w-3 rounded-sm bg-primary cursor-se-resize"
                />
              )}
            </div>
          );
        })}
      </div>

      {editing && selectedId && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
          <span className="text-xs font-medium">Forma:</span>
          {(["square", "round", "rectangle"] as const).map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={tables.find((t) => t.id === selectedId)?.shape === s ? "default" : "outline"}
              onClick={() => onShapeChange(selectedId, s)}
            >
              {s === "square" ? "⬜ Cuadrada" : s === "round" ? "⭕ Redonda" : "▬ Rectangular"}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
