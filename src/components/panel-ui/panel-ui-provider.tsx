"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { applyPanelUi, currentPanelUi, PANEL_UI_DEFAULT, type PanelUi } from "@/lib/panel-ui";

type PanelUiCtx = {
  ui: PanelUi;
  setUi: (v: PanelUi) => void;
  toggle: () => void;
  /** true recién después de montar (evita leer el attribute en el SSR). */
  ready: boolean;
};

const Ctx = createContext<PanelUiCtx>({
  ui: PANEL_UI_DEFAULT,
  setUi: () => {},
  toggle: () => {},
  ready: false,
});

export function PanelUiProvider({ children }: { children: ReactNode }) {
  const [ui, setUiState] = useState<PanelUi>(PANEL_UI_DEFAULT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // El attribute lo dejó el script pre-paint: se lee después de montar
    // para no desalinear la hidratación.
    setUiState(currentPanelUi());
    setReady(true);
    const sync = () => setUiState(currentPanelUi());
    window.addEventListener("panel-ui-changed", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("panel-ui-changed", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const setUi = useCallback((v: PanelUi) => {
    applyPanelUi(v);
    setUiState(v);
  }, []);

  const toggle = useCallback(() => {
    setUi(currentPanelUi() === "tasty" ? "classic" : "tasty");
  }, [setUi]);

  return <Ctx.Provider value={{ ui, setUi, toggle, ready }}>{children}</Ctx.Provider>;
}

export function usePanelUi() {
  return useContext(Ctx);
}
