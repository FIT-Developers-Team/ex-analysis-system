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

export function OperationsFlow({ modules }: { modules: FunctionalModule[] }) {
  return (
    <div className="operations-flow">
      {nodes.map((node, index) => {
        const functionModule = modules.find((item) => item.division === node.label);
        const state = functionModule?.status === "controlled" ? "good" : functionModule?.status === "critical" ? "critical" : "watch";
        const Icon = node.icon;
        return (
          <div className="flow-fragment" key={node.label}>
            <div className={`flow-node flow-node--${state}`}>
              <Icon size={20} />
              <div><strong>{node.label}</strong><span>{functionModule?.headline ?? "Data belum tersedia"}</span></div>
              <b>{functionModule?.status === "unavailable" ? "—" : functionModule?.score ?? "—"}</b>
              <i aria-label={state} />
            </div>
            {index < nodes.length - 1 && <ArrowRight className="flow-arrow" size={18} />}
          </div>
        );
      })}
    </div>
  );
}
