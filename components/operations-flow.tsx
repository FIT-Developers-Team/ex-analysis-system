"use client";

import { ArrowRight, Boxes, PackageCheck, ScanLine, Truck, Users } from "lucide-react";
import type { FunctionalModule } from "@/lib/types";

const nodes = [
  { label: "Personalia", icon: Users },
  { label: "Inbound", icon: ScanLine },
  { label: "Inventory", icon: Boxes },
  { label: "Outbound", icon: PackageCheck },
  { label: "Fleet", icon: Truck },
];

const stateLabel = { good: "Controlled", watch: "Watch", critical: "Critical" } as const;

export function OperationsFlow({ modules }: { modules: FunctionalModule[] }) {
  return (
    <div className="operations-flow">
      {nodes.map((node, index) => {
        const functionModule = modules.find((item) => item.division === node.label);
        const state = functionModule?.status === "controlled" ? "good" : functionModule?.status === "critical" ? "critical" : "watch";
        const Icon = node.icon;
        const headline = functionModule?.headline ?? "Data belum tersedia";
        const score = functionModule?.status === "unavailable" ? "—" : functionModule?.score ?? "—";
        return (
          <div className="flow-fragment" key={node.label}>
            {/* The headline is ellipsised to keep the five nodes on one row, so the
                full text stays reachable on hover and to assistive tech. */}
            <div className={`flow-node flow-node--${state}`} title={`${node.label} · ${stateLabel[state]} · skor ${score} — ${headline}`}>
              <Icon size={20} aria-hidden="true" />
              <div><strong>{node.label}</strong><span>{headline}</span></div>
              <b>{score}</b>
              <i role="img" aria-label={`Status ${stateLabel[state]}`} />
            </div>
            {index < nodes.length - 1 && <ArrowRight className="flow-arrow" size={18} aria-hidden="true" />}
          </div>
        );
      })}
    </div>
  );
}
