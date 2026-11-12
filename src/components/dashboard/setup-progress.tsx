"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, PartyPopper, Rocket, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/panel-ui";
import {
  setupChecks,
  setupKind,
  setupProgress,
  type SetupCheck,
  type SetupKind,
} from "@/lib/setup-steps";
import type { Vendor } from "@/types/database";

type Props = {
  vendor: Vendor;
  offerCount: number;
  /** Abre una pestaña del panel (catálogo, servicios…). */
  onGoTab: (tab: string) => void;
  /** Abre una sección de Configuración. */
  onGoSection: (section: string) => void;
  /** Abre el paso a paso completo (solo comercios nuevos). */
  onOpenWizard?: () => void;
};

const DISMISS_KEY = (vendorId: string) => `portal659:setup-dismissed:${vendorId}`;
const DISMISS_DAYS = 7;

function dismissedFor(vendorId: string): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY(vendorId));
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return true;
    if (Date.now() - ts > DISMISS_DAYS * 86400000) {
      window.localStorage.removeItem(DISMISS_KEY(vendorId));
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function dismissFor(vendorId: string): void {
  try {
    window.localStorage.setItem(DISMISS_KEY(vendorId), String(Date.now()));
  } catch {
    /* sin storage: sigue igual */
  }
}

/** Círculo de check (verde si está, gris si falta). */
function CheckDot({ done, optional }: { done: boolean; optional?: boolean }) {
  if (done) {
    return (
      <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-green-500/15 text-green-600 dark:text-green-400">
        <Check className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span
      className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 border-dashed ${
        optional ? "border-muted-foreground/30" : "border-primary/50"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${optional ? "bg-muted-foreground/30" : "bg-primary/50"}`}
      />
    </span>
  );
}

export function SetupProgressCard({ vendor, offerCount, onGoTab, onGoSection, onOpenWizard }: Props) {
  const kind: SetupKind = setupKind(vendor.vertical);
  const [services, setServices] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);

  // Servicios (estética/taller): conteo real para el check del catálogo.
  useEffect(() => {
    if (kind !== "hibrido") return;
    let alive = true;
    fetch("/api/vendor/services", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && Array.isArray(d?.services)) setServices(d.services.length);
      })
      .catch(() => {
        /* sin conteo: el check queda pendiente, nunca rompe */
      });
    return () => {
      alive = false;
    };
  }, [kind]);

  useEffect(() => {
    setHidden(dismissedFor(vendor.id));
  }, [vendor.id]);

  const checks = useMemo(
    () => setupChecks(vendor, { offers: offerCount, services: services ?? 0 }, kind),
    [vendor, offerCount, services, kind]
  );
  const progress = useMemo(() => setupProgress(checks), [checks]);

  if (hidden) return null;

  function go(check: SetupCheck) {
    if (check.target.kind === "tab") onGoTab(check.target.tab);
    else onGoSection(check.target.section);
  }

  // Comercio completo: sello corto, ya no ocupa lugar.
  if (progress.pct >= 100 && progress.pending.length === 0) {
    return (
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-green-500/15 text-green-600 dark:text-green-400">
          <PartyPopper className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">¡Tu comercio está listo!</p>
          <p className="text-xs text-muted-foreground">
            Vidriera completa. Compartila con tus vecinos y empezá a vender.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            dismissFor(vendor.id);
            setHidden(true);
          }}
        >
          Ocultar
        </Button>
      </Card>
    );
  }

  const required = checks.filter((c) => !c.optional);
  const next = required.find((c) => !c.done);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 border-b border-border p-4">
        <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Rocket className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display font-semibold">Cómo va tu comercio</h2>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold tabular-nums text-primary">
              {progress.pct}%
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {progress.done} de {progress.total} pasos completos
            {next ? ` · próximo: ${next.label.toLowerCase()}` : ""}
          </p>
        </div>
        <button
          type="button"
          aria-label="Ocultar por ahora"
          title="Ocultar por una semana"
          onClick={() => {
            dismissFor(vendor.id);
            setHidden(true);
          }}
          className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Barra de progreso */}
      <div className="px-4 pt-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
      </div>

      {/* Checks: primero lo que falta, después lo hecho */}
      <ul className="divide-y divide-border">
        {[...checks.filter((c) => !c.done), ...checks.filter((c) => c.done)].map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => go(c)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
            >
              <CheckDot done={c.done} optional={c.optional} />
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-medium ${c.done ? "text-muted-foreground line-through" : ""}`}>
                  {c.label}
                  {c.optional && !c.done && (
                    <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                      opcional
                    </span>
                  )}
                </span>
                {!c.done && <span className="block text-xs text-muted-foreground">{c.hint}</span>}
              </span>
              {!c.done && <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
            </button>
          </li>
        ))}
      </ul>

      {onOpenWizard && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border p-4">
          <Button type="button" size="sm" onClick={onOpenWizard}>
            Abrir el paso a paso
          </Button>
          <p className="text-xs text-muted-foreground">
            Te guía paso por paso hasta dejar la vidriera lista.
          </p>
        </div>
      )}
    </Card>
  );
}
