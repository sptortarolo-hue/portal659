"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /** Abre el modal de reserva (botón junto a Editar plano). */
  onReserve?: () => void;
  /** Elimina una mesa desde el editor del plano. */
  onDeleteTable?: (id: string) => void;
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
  onReserve,
  onDeleteTable,
}: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<FloorTool>("move");
  // Modos de vista: fit (encuadra todo) | one (tamaño real) | free (pinch).
  const [mode, setMode] = useState<"fit" | "one" | "free">("fit");
  const [cam, setCam] = useState({ s: 1, x: 0, y: 0 });
  const [canvasW, setCanvasW] = useState(0);
  const viewRef = useRef({ s: 1, x: 0, y: 0 });
  const fitScaleRef = useRef(1);
  const boundsRef = useRef({ w: 320, h: 260 });
  // Multitouch: mapa de punteros activos + gesto de 2 dedos en curso.
  const ptsRef = useRef(new Map<number, { x: number; y: number }>());
  const gestRef = useRef<{
    d0: number; mx0: number; my0: number; view0: { s: number; x: number; y: number };
  } | null>(null);
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
    const v = viewRef.current;
    return { x: snap((clientX - rect.left - v.x) / v.s), y: snap((clientY - rect.top - v.y) / v.s), rect };
  }, [snap]);

  // Segundo dedo: cancela trazo/arrastre y pasa a navegar (zoom + pan).
  const trackDown = useCallback((e: React.PointerEvent) => {
    ptsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptsRef.current.size === 2) {
      drawingRef.current = null;
      setWallPreview(null);
      setDragging(null);
      resizingRef.current = null;
      dragDecorRef.current = null;
      decorResizeRef.current = null;
      draggedRef.current = true;
      const [a, b] = [...ptsRef.current.values()];
      gestRef.current = {
        d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        mx0: (a.x + b.x) / 2,
        my0: (a.y + b.y) / 2,
        view0: { ...viewRef.current },
      };
      setMode("free");
      setCam({ ...viewRef.current });
      const canvas = canvasRef.current;
      if (canvas) {
        try { canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
      }
      return true;
    }
    return false;
  }, []);

  const trackMove = useCallback((e: React.PointerEvent) => {
    const p = ptsRef.current.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    const g = gestRef.current;
    if (!g || ptsRef.current.size < 2) return false;
    const canvas = canvasRef.current;
    if (!canvas) return true;
    const rect = canvas.getBoundingClientRect();
    const [a, b] = [...ptsRef.current.values()];
    const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const mx = (a.x + b.x) / 2 - rect.left;
    const my = (a.y + b.y) / 2 - rect.top;
    const minS = fitScaleRef.current;
    const s = Math.min(minS * 4, Math.max(minS, g.view0.s * (d / g.d0)));
    // El punto de diseño bajo el punto medio inicial queda fijo ahí.
    const dx = (g.mx0 - rect.left - g.view0.x) / g.view0.s;
    const dy = (g.my0 - rect.top - g.view0.y) / g.view0.s;
    draggedRef.current = true;
    const vw = canvas.clientWidth;
    const vh = canvas.clientHeight;
    const bd = boundsRef.current;
    const m = 40;
    const cw = bd.w * s;
    const ch = bd.h * s;
    const x = cw <= vw ? (vw - cw) / 2 : Math.min(m, Math.max(vw - cw - m, mx - dx * s));
    const y = ch <= vh ? (vh - ch) / 2 : Math.min(m, Math.max(vh - ch - m, my - dy * s));
    setCam({ s, x, y });
    return true;
  }, []);

  const trackUp = useCallback((e: React.PointerEvent) => {
    ptsRef.current.delete(e.pointerId);
    if (ptsRef.current.size < 2) gestRef.current = null;
  }, []);

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
      if (trackDown(e)) return;
      // Solo la herramienta Mover arrastra mesas; las demás operan sobre el canvas.
      if (!editing || tool !== "move") return;
      e.preventDefault();
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const v = viewRef.current;
      const p = disp(t);
      dragOffset.current = {
        dx: (e.clientX - rect.left - v.x) / v.s - p.x,
        dy: (e.clientY - rect.top - v.y) / v.s - p.y,
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
      if (trackMove(e)) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const v = viewRef.current;
      const b = boundsRef.current;
      const px = (c: number, r: number, o: number) => (c - r - o) / v.s;
      // Resize por arrastre desde el handle de la esquina (mesa).
      if (resizingRef.current) {
        const r = resizingRef.current;
        const t = tablesRef.current.find((x) => x.id === r.id);
        if (!t) return;
        const rect = canvas.getBoundingClientRect();
        const p = disp(t);
        const w = Math.max(MIN_SIZE, Math.min(MAX_SIZE, snap(px(e.clientX, rect.left, v.x) - p.x)));
        const h = Math.max(MIN_SIZE, Math.min(MAX_SIZE, snap(px(e.clientY, rect.top, v.y) - p.y)));
        draggedRef.current = true;
        onResize(t.id, w, h);
        return;
      }
      // Resize de zona (rect/círculo) por arrastre de esquina.
      if (decorResizeRef.current && onDecorResize) {
        const d = (decor || []).find((x) => x.id === decorResizeRef.current!.id);
        if (!d) return;
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(20, Math.min(800, snap(px(e.clientX, rect.left, v.x) - (d.x ?? 0))));
        const h = Math.max(20, Math.min(800, snap(px(e.clientY, rect.top, v.y) - (d.y ?? 0))));
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
          Math.max(0, Math.min(b.w, snap(px(e.clientX, rect.left, v.x) - dd.dx))),
          Math.max(0, Math.min(b.h, snap(px(e.clientY, rect.top, v.y) - dd.dy)))
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
      const x = Math.max(0, Math.min(b.w - tw, snap(px(e.clientX, rect.left, v.x) - dragOffset.current.dx)));
      const y = Math.max(0, Math.min(b.h - th, snap(px(e.clientY, rect.top, v.y) - dragOffset.current.dy)));
      onMove(t.id, x, y);
    },
    [dragging, onMove, onResize, onDecorMove, onDecorResize, snap, disp, decor, canvasPos, trackMove]
  );

  const wallPreviewRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  wallPreviewRef.current = wallPreview;

  const handlePointerUp = useCallback((e?: React.PointerEvent) => {
    if (e) trackUp(e);
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
  }, [onDecorAdd, trackUp]);

  // Acciones sobre el canvas según la herramienta (solo en edición).
  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (ptsRef.current.has(e.pointerId)) return;
      if (trackDown(e)) return;
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
    [editing, tool, onDecorAdd, canvasPos, trackDown]
  );

  const handleResizeDown = useCallback(
    (e: React.PointerEvent, t: FloorTable) => {
      if (trackDown(e)) return;
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
    [trackDown]
  );

  const handleDecorPointerDown = useCallback(
    (e: React.PointerEvent, d: FloorDecor) => {
      if (trackDown(e)) return;
      if (!editing || tool !== "move") return;
      e.preventDefault();
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const v = viewRef.current;
      downPos.current = { x: e.clientX, y: e.clientY };
      draggedRef.current = false;
      dragDecorRef.current = {
        id: d.id,
        dx: (e.clientX - rect.left - v.x) / v.s - (d.x ?? 0),
        dy: (e.clientY - rect.top - v.y) / v.s - (d.y ?? 0),
      };
      setEditDecorId(d.id);
      setEditSelectedId(null);
      canvas.setPointerCapture(e.pointerId);
    },
    [editing, tool, trackDown]
  );

  const handleDecorResizeDown = useCallback((e: React.PointerEvent, d: FloorDecor) => {
    if (trackDown(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    decorResizeRef.current = { id: d.id };
    setEditDecorId(d.id);
  }, [trackDown]);

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

  // Bounds del contenido (mesas + decor): el canvas se ajusta a esto.
  const bounds = useMemo(() => {
    let w = 320;
    let h = 260;
    for (const t of tables) {
      const p = disp(t);
      w = Math.max(w, p.x + (t.width ?? 60) + 16);
      h = Math.max(h, p.y + (t.height ?? 60) + 16);
    }
    for (const d of decor || []) {
      if (d.kind === "wall") {
        const l = wallLine(d);
        w = Math.max(w, Math.max(l.x1, l.x2) + 16);
        h = Math.max(h, Math.max(l.y1, l.y2) + 16);
      } else {
        w = Math.max(w, (d.x ?? 0) + (d.w ?? 60) + 16);
        h = Math.max(h, (d.y ?? 0) + (d.h ?? 60) + 16);
      }
    }
    return { w: Math.ceil(w), h: Math.ceil(h) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, decor, disp]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const update = () => setCanvasW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  boundsRef.current = bounds;

  // Viewport 16:9 (con mínimo de alto en mobile) + vista efectiva.
  const vw = canvasW;
  const vh = Math.max(vw > 0 ? (vw * 9) / 16 : 0, 300);
  const fitS = vw > 0 ? Math.min(1, vw / bounds.w, vh / bounds.h) : 1;
  fitScaleRef.current = fitS;
  const fitView = {
    s: fitS,
    x: (vw - bounds.w * fitS) / 2,
    y: (vh - bounds.h * fitS) / 2,
  };
  const view = mode === "fit" ? fitView : mode === "one" ? { s: 1, x: 0, y: 0 } : cam;
  viewRef.current = view;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block h-3 w-3 rounded-sm bg-emerald-400" /> Libre
          <span className="inline-block h-3 w-3 rounded-sm bg-red-400 ml-2" /> Ocupada
          <span className="inline-block h-3 w-3 rounded-sm bg-amber-400 ml-2" /> Reservada
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMode("fit")}
            title="Ajustar a la pantalla"
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              mode !== "one" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            🔍 Ajustar
          </button>
          <button
            type="button"
            onClick={() => setMode("one")}
            title="Ver tamaño real (1:1)"
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "one" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            ↔️ 1:1
          </button>
          {onReserve && !editing && (
            <Button type="button" size="sm" variant="outline" onClick={onReserve}>
              📅 Reservar
            </Button>
          )}
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
        className={`relative w-full ${mode === "one" ? "overflow-auto" : "overflow-hidden"} rounded-2xl border-2 border-dashed border-border bg-muted/30 select-none`}
        style={{
          aspectRatio: "16 / 9",
          minHeight: 300,
          // none siempre: el pinch propio necesita los pointer events sin que
          // el navegador secuestre el gesto (zoom de página/scroll).
          touchAction: "none",
          backgroundImage: bgUrl ? `url(${bgUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {tables.length === 0 && (decor || []).length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Agregá mesas para armar el plano del salón
          </div>
        )}
        <div
          className="relative origin-top-left"
          style={{
            width: bounds.w,
            height: bounds.h,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
          }}
        >
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
          {onDeleteTable && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={editTable.status === "ocupada"}
              title={editTable.status === "ocupada" ? "Cerrá la mesa antes de eliminarla" : "Eliminar mesa"}
              onClick={() => onDeleteTable(editTable.id)}
            >
              Eliminar
            </Button>
          )}
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
