"use client";

import type { OrderStatus } from "@/types/database";
import { flowSteps, progressPercent, statusLabel, orderReadyLabel } from "@/lib/order-utils";

export function OrderTimeline({
  status,
  method,
  isRetail = false,
}: {
  status: OrderStatus;
  method: "delivery" | "pickup";
  isRetail?: boolean;
}) {
  const stepOrder = flowSteps(isRetail);
  const currentIdx = stepOrder.indexOf(status);
  const isCancelled = status === "cancelled";
  const pct = progressPercent(status);

  const stepLabel = (step: OrderStatus) =>
    step === "ready" ? orderReadyLabel({ channel: "app", method }) : statusLabel(step, isRetail);

  return (
    <div className="relative mt-3 mb-2">
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between mt-1.5">
        {stepOrder.map((step, i) => {
          const done = i <= currentIdx && !isCancelled;
          return (
            <span
              key={step}
              className={`text-[9px] font-medium transition-colors ${
                done ? "text-primary" : "text-muted-foreground/40"
              } ${i === currentIdx && !isCancelled ? "text-primary font-bold" : ""}`}
            >
              {stepLabel(step)}
            </span>
          );
        })}
      </div>
    </div>
  );
}