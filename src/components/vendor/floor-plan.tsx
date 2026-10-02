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
  onCapacityChange: (id: string, capacity: number) => void;
  /** Mesas bloqueadas ahora por ventana de reserva + con reserva futura. */
  blockedIds?: string[];
  upcomingIds?: string[];
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

export function FloorPlan({ tables, selectedId, onSelect, onMove, onResize, onShapeChange, onCapacityChange, blockedIds, upcomingIds }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  // Selección interna del editor: elige la mesa a configurar SIN navegar al
  // detalle (en modo edición el click no debe abrir la mesa).
  const [editSelectedId, setEditSelectedId] = useState<string | null>(null);
  const dragOffset = useRef({ dx: 0, dy: 0 });
  const downPos = useRef({ x: 0, y: 0 });
  const draggedRef = useRef(false);
  const resizingRef = useRef<{ id: string; startX: number; startY: number; startW: number; startH: number } | null>(null);
  const tablesRef = useRef(tables);
  tablesRef.current = tables;

  const snap = useCallback((v: number) => Math.round(v / SNAP) * SNAP, []);

  // Mesas nunca ubicadas (todos los valores por defecto de la migración) se
  // muestran en cascada para no quedar apiladas en el 0,0. Al arrastrarlas se
  // persiste la posición real.
  const unplacedIdx = new Map<string, number>();
  {
    let k = 0;
    for (const t of tables) {
      if (
        (t.x ?? 0) === 0 && (t.y ?? 0) === 0 &&
        (t.width ?? 60) === 60 && (t.height ?? 60) === 60 &&
        (t.shape ?? "square") === "square"
      ) {
        unplacedIdx.set(t.id, k++);
      }
    }
  }
  const disp = useCallback(
    (t: FloorTable) => {
      const i = unplacedIdx.get(t.id);
      if (i === undefined) return { x: t.x ?? 0, y: t.y ?? 0 };
      return { x: 10 + (i % 4) * 90, y: 10 + Math.floor(i / 4) * 90 };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tables]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, t: FloorTable) => {
      if (!editing) return;
      e.preventDefault();
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const p = disp(t);
      dragOffset.current = {
        dx: e.clientX - rect.left - p.x,
        dy: e.clientY - rect.top - p.y,
      };
      downPos.current = { x: e.clientX, y: e.clientY };
      draggedRef.current = false;
      setDragging(t.id);
      setEditSelectedId(t.id);
      canvas.setPointerCapture(e.pointerId);
    },
    [editing, disp]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Resize por arrastre desde el handle de la esquina.
      if (resizingRef.current) {
        const r = resizingRef.current;
        const t = tablesRef.current.find((x) => x.id === r.id);
        if (!t) return;
        const rect = canvas.getBoundingClientRect();
        const p = disp(t);
        const w = Math.max(MIN_SIZE, Math.min(MAX_SIZE, snap(e.clientX - rect.left - p.x)));
        const h = Math.max(MIN_SIZE, Math.min(MAX_SIZE, snap(e.clientY - rect.top - p.y)));
        draggedRef.current = true;
        onResize(t.id, w, h);
        return;
      }
      if (!dragging) return;
      if (Math.abs(e.clientX - downPos.current.x) + Math.abs(e.clientY - downPos.current.y) > 6) {
        draggedRef.current = true;
      }
      const rect = canvas.getBoundingClientRect();
      const t = tablesRef.current.find((x) => x.id === dragging);
      if (!t) return;
      const tw = t.width ?? 60;
      const th = t.height ?? 60;
      const x = Math.max(0, Math.min(rect.width - tw, snap(e.clientX - rect.left - dragOffset.current.dx)));
      const y = Math.max(0, Math.min(rect.height - th, snap(e.clientY - rect.top - dragOffset.current.dy)));
      onMove(t.id, x, y);
    },
    [dragging, onMove, onResize, snap, disp]
  );

  const handlePointerUp = useCallback(() => {
    setDragging(null);
    resizingRef.current = null;
  }, []);

  const handleResizeDown = useCallback(
    (e: React.PointerEvent, t: FloorTable) => {
      e.preventDefault();
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(e.pointerId);
      resizingRef.current = {
        id: t.id,
        startX: e.clientX,
        startY: e.clientY,
        startW: t.width ?? 60,
        startH: t.height ?? 60,
      };
      setEditSelectedId(t.id);
    },
    []
  );

  const handleTableClick = useCallback(
    (e: React.MouseEvent, t: FloorTable) => {
      e.stopPropagation();
      // Ignorar el click que cierra un arrastre (move o resize).
      if (draggedRef.current) {
        draggedRef.current = false;
        return;
      }
      if (editing) {
        setEditSelectedId(t.id);
        return;
      }
      // En modo normal la apertura va por click (dedo ya levantado): abrir en
      // pointerdown causaba tap-through en mobile (el click sintético al
      // soltar caía sobre el producto del modal recién abierto).
      onSelect(t);
    },
    [editing, onSelect]
  );

  const editTable = tables.find((t) => t.id === editSelectedId) ?? null;

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
          onClick={() => {
            if (editing) setEditSelectedId(null);
            setEditing(!editing);
          }}
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
          const isBlocked = (blockedIds || []).includes(t.id);
          const isUpcoming = !isBlocked && (upcomingIds || []).includes(t.id);
          const st = isBlocked ? STATUS_STYLES.reservada : (STATUS_STYLES[t.status] || STATUS_STYLES.libre);
          const isSelected = selectedId === t.id || editSelectedId === t.id;
          const p = disp(t);
          const tw = t.width ?? 60;
          const th = t.height ?? 60;
          return (
            <div
              key={t.id}
              onPointerDown={editing ? (e) => handlePointerDown(e, t) : undefined}
              onClick={(e) => handleTableClick(e, t)}
              className={`absolute flex flex-col items-center justify-center border-2 transition-shadow ${st.bg} ${st.border} ${SHAPE_RADIUS[t.shape]} ${
                editing ? "cursor-move" : "cursor-pointer"
              } ${isSelected ? "ring-2 ring-primary ring-offset-1" : ""} ${dragging === t.id ? "opacity-80 shadow-lg z-10" : ""}`}
              style={{
                left: p.x,
                top: p.y,
                width: tw,
                height: th,
                transform: t.rotation ? `rotate(${t.rotation}deg)` : undefined,
              }}
            >
              <span className={`text-[10px] font-semibold leading-tight text-center px-0.5 truncate w-full ${st.text}`}>
                {t.name}
              </span>
              <span className={`text-[8px] ${st.text} opacity-70`}>
                {t.status === "ocupada" ? "Ocupada" : isBlocked ? "Reservada" : `${t.capacity} pers.${isUpcoming ? " 🕒" : ""}`}
              </span>
              {editing && (
                <div
                  onPointerDown={(e) => handleResizeDown(e, t)}
                  className="absolute -bottom-2 -right-2 h-5 w-5 flex items-center justify-center cursor-se-resize"
                >
                  <div className="h-2.5 w-2.5 rounded-sm bg-primary" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing && editTable && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card p-3">
          <span className="text-xs font-semibold">{editTable.name}</span>
          <span className="text-xs font-medium text-muted-foreground">Forma:</span>
          {(["square", "round", "rectangle"] as const).map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={editTable.shape === s ? "default" : "outline"}
              onClick={() => onShapeChange(editTable.id, s)}
            >
              {s === "square" ? "⬜ Cuadrada" : s === "round" ? "⭕ Redonda" : "▬ Rectangular"}
            </Button>
          ))}
          <span className="text-xs font-medium text-muted-foreground">Comensales:</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onCapacityChange(editTable.id, Math.max(1, (editTable.capacity || 4) - 1))}
              className="h-7 w-7 rounded-md bg-muted hover:bg-accent text-sm font-bold"
              aria-label="Menos comensales"
            >
              −
            </button>
            <span className="w-6 text-center text-xs font-semibold tabular-nums">{editTable.capacity}</span>
            <button
              type="button"
              onClick={() => onCapacityChange(editTable.id, Math.min(30, (editTable.capacity || 4) + 1))}
              className="h-7 w-7 rounded-md bg-muted hover:bg-accent text-sm font-bold"
              aria-label="Más comensales"
            >
              +
            </button>
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {editTable.width ?? 60}×{editTable.height ?? 60}
          </span>
        </div>
      )}
    </div>
  );
}
