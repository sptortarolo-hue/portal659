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

export type FloorDecor = {
  id: string;
  kind: "wall" | "label" | "rect" | "circle";
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  text?: string | null;
};

export type FloorTool = "move" | "wall" | "label" | "zone-rect" | "zone-circle" | "erase";

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
  decor?: FloorDecor[];
  bgUrl?: string | null;
  onDecorAdd?: (kind: FloorDecor["kind"], partial: Partial<FloorDecor>) => void;
  onDecorMove?: (id: string, x: number, y: number) => void;
  onDecorResize?: (id: string, w: number, h: number) => void;
  onDecorText?: (id: string, text: string) => void;
  onDecorDelete?: (id: string) => void;
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

const TOOLS: { key: FloorTool; label: string }[] = [
  { key: "move", label: "✥ Mover" },
  { key: "wall", label: "🧱 Pared" },
  { key: "label", label: "🏷 Etiqueta" },
  { key: "zone-rect", label: "▢ Zona" },
  { key: "zone-circle", label: "⭕ Zona" },
  { key: "erase", label: "🗑 Borrar" },
];

export function FloorPlan({
  tables,
  selectedId,
  onSelect,
  onMove,
  onResize,
  onShapeChange,
  onCapacityChange,
  blockedIds,
  upcomingIds,
  decor,
  bgUrl,
  onDecorAdd,
  onDecorMove,
  onDecorResize,
  onDecorText,
  onDecorDelete,
}: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<FloorTool>("move");
  const [dragging, setDragging] = useState<string | null>(null);
  // Selección interna del editor: elige la mesa a configurar SIN navegar al
  // detalle (en modo edición el click no debe abrir la mesa).
  const [editSelectedId, setEditSelectedId] = useState<string | null>(null);
  const [editDecorId, setEditDecorId] = useState<string | null>(null);
  // Preview de la pared mientras se arrastra A → B.
  const [wallPreview, setWallPreview] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const dragOffset = useRef({ dx: 0, dy: 0 });
  const downPos = useRef({ x: 0, y: 0 });
  const draggedRef = useRef(false);
  const resizingRef = useRef<{ id: string; startX: number; startY: number; startW: number; startH: number } | null>(null);
  const drawingRef = useRef<{ x1: number; y1: number } | null>(null);
  const dragDecorRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const decorResizeRef = useRef<{ id: string } | null>(null);
  const tablesRef = useRef(tables);
  tablesRef.current = tables;

  const snap = useCallback((v: number) => Math.round(v / SNAP) * SNAP, []);

  const canvasPos = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: snap(clientX - rect.left), y: snap(clientY - rect.top), rect };
  }, [snap]);

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
      // Solo la herramienta Mover arrastra mesas; las demás operan sobre el canvas.
      if (!editing || tool !== "move") return;
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
      setEditDecorId(null);
      canvas.setPointerCapture(e.pointerId);
    },
    [editing, tool, disp]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Resize por arrastre desde el handle de la esquina (mesa).
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
      // Resize de zona (rect/círculo) por arrastre de esquina.
      if (decorResizeRef.current && onDecorResize) {
        const d = (decor || []).find((x) => x.id === decorResizeRef.current!.id);
        if (!d) return;
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(20, Math.min(800, snap(e.clientX - rect.left - (d.x ?? 0))));
        const h = Math.max(20, Math.min(800, snap(e.clientY - rect.top - (d.y ?? 0))));
        draggedRef.current = true;
        onDecorResize(d.id, w, h);
        return;
      }
      // Arrastre de elemento de decoración.
      if (dragDecorRef.current && onDecorMove) {
        const dd = dragDecorRef.current;
        if (Math.abs(e.clientX - downPos.current.x) + Math.abs(e.clientY - downPos.current.y) > 6) {
          draggedRef.current = true;
        }
        const rect = canvas.getBoundingClientRect();
        onDecorMove(
          dd.id,
          Math.max(0, snap(e.clientX - rect.left - dd.dx)),
          Math.max(0, snap(e.clientY - rect.top - dd.dy))
        );
        return;
      }
      // Preview de pared A → B.
      if (drawingRef.current) {
        const d = drawingRef.current;
        const pos = canvasPos(e.clientX, e.clientY);
        if (!pos) return;
        draggedRef.current = true;
        setWallPreview({ x1: d.x1, y1: d.y1, x2: pos.x, y2: pos.y });
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
    [dragging, onMove, onResize, onDecorMove, onDecorResize, snap, disp, decor, canvasPos]
  );

  const wallPreviewRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  wallPreviewRef.current = wallPreview;

  const handlePointerUp = useCallback(() => {
    // Cierre de pared A → B.
    if (drawingRef.current && onDecorAdd) {
      const d = drawingRef.current;
      const pv = wallPreviewRef.current;
      drawingRef.current = null;
      setWallPreview(null);
      if (pv) {
        const dx = pv.x2 - pv.x1;
        const dy = pv.y2 - pv.y1;
        const len = Math.round(Math.hypot(dx, dy));
        if (len < 10) {
          onDecorAdd("wall", { x: pv.x1 - 40, y: pv.y1 - 4, w: 80, h: 8, rotation: 0 });
        } else {
          const angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
          onDecorAdd("wall", { x: pv.x1, y: pv.y1, w: len, h: 8, rotation: angle });
        }
      }
    }
    setDragging(null);
    resizingRef.current = null;
    dragDecorRef.current = null;
    decorResizeRef.current = null;
  }, [onDecorAdd]);

  // Acciones sobre el canvas según la herramienta (solo en edición).
  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!editing || tool === "move" || tool === "erase") return;
      const pos = canvasPos(e.clientX, e.clientY);
      if (!pos) return;
      const canvas = canvasRef.current;
      if (tool === "wall") {
        e.preventDefault();
        drawingRef.current = { x1: pos.x, y1: pos.y };
        draggedRef.current = false;
        if (canvas) canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (!onDecorAdd) return;
      if (tool === "label") {
        onDecorAdd("label", { x: Math.max(0, pos.x - 30), y: Math.max(0, pos.y - 12), w: 60, h: 24, text: "Texto" });
      } else if (tool === "zone-rect") {
        onDecorAdd("rect", { x: Math.max(0, pos.x - 60), y: Math.max(0, pos.y - 40), w: 120, h: 80, text: "Zona" });
      } else if (tool === "zone-circle") {
        onDecorAdd("circle", { x: Math.max(0, pos.x - 50), y: Math.max(0, pos.y - 50), w: 100, h: 100, text: "Zona" });
      }
    },
    [editing, tool, onDecorAdd, canvasPos]
  );

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

  const handleDecorPointerDown = useCallback(
    (e: React.PointerEvent, d: FloorDecor) => {
      if (!editing || tool !== "move") return;
      e.preventDefault();
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      downPos.current = { x: e.clientX, y: e.clientY };
      draggedRef.current = false;
      dragDecorRef.current = {
        id: d.id,
        dx: e.clientX - rect.left - (d.x ?? 0),
        dy: e.clientY - rect.top - (d.y ?? 0),
      };
      setEditDecorId(d.id);
      setEditSelectedId(null);
      canvas.setPointerCapture(e.pointerId);
    },
    [editing, tool]
  );

  const handleDecorResizeDown = useCallback((e: React.PointerEvent, d: FloorDecor) => {
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    decorResizeRef.current = { id: d.id };
    setEditDecorId(d.id);
  }, []);

  const handleDecorClick = useCallback(
    (e: React.MouseEvent, d: FloorDecor) => {
      e.stopPropagation();
      if (draggedRef.current) {
        draggedRef.current = false;
        return;
      }
      if (!editing) return;
      if (tool === "erase") {
        if (confirm("¿Eliminar este elemento del plano?")) onDecorDelete?.(d.id);
        return;
      }
      if (tool === "move") setEditDecorId(d.id);
    },
    [editing, tool, onDecorDelete]
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
        // En edición el click solo selecciona para configurar (no navega).
        // Con herramientas de dibujo/borrado, las mesas no se tocan.
        if (tool === "move") {
          setEditSelectedId(t.id);
          setEditDecorId(null);
        }
        return;
      }
      // En modo normal la apertura va por click (dedo ya levantado): abrir en
      // pointerdown causaba tap-through en mobile (el click sintético al
      // soltar caía sobre el producto del modal recién abierto).
      onSelect(t);
    },
    [editing, tool, onSelect]
  );

  const editTable = tables.find((t) => t.id === editSelectedId) ?? null;
  const editDecor = (decor || []).find((d) => d.id === editDecorId) ?? null;

  const wallLine = (d: FloorDecor) => {
    const rad = ((d.rotation || 0) * Math.PI) / 180;
    return {
      x1: d.x ?? 0,
      y1: d.y ?? 0,
      x2: (d.x ?? 0) + (d.w ?? 80) * Math.cos(rad),
      y2: (d.y ?? 0) + (d.w ?? 80) * Math.sin(rad),
    };
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
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
            if (editing) {
              setEditSelectedId(null);
              setEditDecorId(null);
              setTool("move");
            }
            setEditing(!editing);
          }}
        >
          {editing ? "✓ Listo" : "✏️ Editar plano"}
        </Button>
      </div>

      {editing && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          {TOOLS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTool(t.key)}
              className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                tool === t.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div
        ref={canvasRef}
        className="relative w-full overflow-hidden rounded-2xl border-2 border-dashed border-border bg-muted/30 select-none"
        style={{
          height: "calc(100vh - 280px)",
          minHeight: 400,
          touchAction: editing ? "none" : "auto",
          backgroundImage: bgUrl ? `url(${bgUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {tables.length === 0 && (decor || []).length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Agregá mesas para armar el plano del salón
          </div>
        )}
        {/* Paredes (capa SVG bajo las mesas). */}
        <svg className="absolute inset-0 h-full w-full z-0">
          {(decor || [])
            .filter((d) => d.kind === "wall")
            .map((d) => {
              const l = wallLine(d);
              return (
                <line
                  key={d.id}
                  x1={l.x1}
                  y1={l.y1}
                  x2={l.x2}
                  y2={l.y2}
                  stroke="#64748b"
                  strokeWidth={6}
                  strokeLinecap="round"
                  opacity={0.85}
                />
              );
            })}
          {wallPreview && (
            <line
              x1={wallPreview.x1}
              y1={wallPreview.y1}
              x2={wallPreview.x2}
              y2={wallPreview.y2}
              stroke="#3b82f6"
              strokeWidth={6}
              strokeLinecap="round"
              strokeDasharray="8 4"
            />
          )}
        </svg>
        {/* Zonas y etiquetas. */}
        {(decor || [])
          .filter((d) => d.kind !== "wall")
          .map((d) => {
            const isSel = editDecorId === d.id;
            if (d.kind === "label") {
              return (
                <div
                  key={d.id}
                  onPointerDown={(e) => handleDecorPointerDown(e, d)}
                  onClick={(e) => handleDecorClick(e, d)}
                  className={`absolute z-0 rounded-full bg-slate-700/85 text-white text-[10px] font-semibold px-2.5 py-1 whitespace-nowrap ${
                    editing ? (tool === "move" ? "cursor-move" : tool === "erase" ? "cursor-pointer" : "") : ""
                  } ${isSel ? "ring-2 ring-primary ring-offset-1" : ""}`}
                  style={{ left: d.x ?? 0, top: d.y ?? 0 }}
                >
                  {d.text || "Texto"}
                </div>
              );
            }
            const isCircle = d.kind === "circle";
            return (
              <div
                key={d.id}
                onPointerDown={(e) => handleDecorPointerDown(e, d)}
                onClick={(e) => handleDecorClick(e, d)}
                className={`absolute z-0 flex items-center justify-center border-2 border-dashed border-slate-500 bg-slate-400/15 text-slate-600 dark:text-slate-300 text-[10px] font-semibold ${
                  isCircle ? "rounded-full" : "rounded-lg"
                } ${editing ? (tool === "move" ? "cursor-move" : tool === "erase" ? "cursor-pointer" : "") : ""} ${
                  isSel ? "ring-2 ring-primary ring-offset-1" : ""
                }`}
                style={{ left: d.x ?? 0, top: d.y ?? 0, width: d.w ?? 120, height: d.h ?? 80 }}
              >
                <span className="px-1 text-center leading-tight">{d.text || "Zona"}</span>
                {editing && tool === "move" && isSel && (
                  <div
                    onPointerDown={(e) => handleDecorResizeDown(e, d)}
                    className="absolute -bottom-2 -right-2 h-5 w-5 flex items-center justify-center cursor-se-resize"
                  >
                    <div className="h-2.5 w-2.5 rounded-sm bg-primary" />
                  </div>
                )}
              </div>
            );
          })}
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
                editing ? (tool === "move" ? "cursor-move" : "") : "cursor-pointer"
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
              {editing && tool === "move" && (
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

      {editing && editDecor && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card p-3">
          <span className="text-xs font-semibold">
            {editDecor.kind === "wall" ? "🧱 Pared" : editDecor.kind === "label" ? "🏷 Etiqueta" : "▢ Zona"}
          </span>
          <input
            type="text"
            defaultValue={editDecor.text || ""}
            key={editDecor.id + (editDecor.text || "")}
            onBlur={(e) => {
              const v = e.target.value.trim().slice(0, 40);
              if (v !== (editDecor.text || "")) onDecorText?.(editDecor.id, v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder={editDecor.kind === "wall" ? "Sin texto" : "Nombre (Barra, Entrada…)"}
            disabled={editDecor.kind === "wall"}
            className="h-8 px-2 text-xs rounded-lg border border-input bg-background w-44"
          />
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {editDecor.kind === "wall" ? `largo ${editDecor.w ?? 0}` : `${editDecor.w ?? 0}×${editDecor.h ?? 0}`}
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={() => onDecorDelete?.(editDecor.id)}>
            Eliminar
          </Button>
        </div>
      )}
    </div>
  );
}
