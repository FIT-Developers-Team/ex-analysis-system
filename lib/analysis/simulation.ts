import type { SimulationInputs, SimulationResult } from "@/lib/types";

export interface SimulationBaseline {
  productivityAttainment: number;
  sla: number;
  demandFill: number;
  utilization: number;
  mandaysGap: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function runSimulation(baseline: SimulationBaseline, inputs: SimulationInputs): SimulationResult {
  const demandFactor = 1 + inputs.forecastChange / 100;
  const attendanceFactor = Math.max(0.5, 1 + inputs.attendanceChange / 100);
  const processFactor = 1 + inputs.processGain / 100;
  const cancellationLoad = Math.max(0, -inputs.cancelChange) * 0.35;
  const capacityPressure = Math.max(0, baseline.utilization * demandFactor - 88);
  const productivityChange = ((demandFactor * processFactor) / attendanceFactor - 1) * 100 - capacityPressure * 0.08;
  const slaChange = inputs.attendanceChange * 0.42 + inputs.processGain * 0.28 - inputs.forecastChange * 0.2 - cancellationLoad * 0.12;
  const demandFillChange = inputs.processGain * 0.22 + inputs.attendanceChange * 0.16 - inputs.forecastChange * 0.12 - inputs.cancelChange * 0.55 - capacityPressure * 0.06 - (baseline.utilization > 88 ? cancellationLoad * 0.15 : 0);
  const utilizationChange = baseline.utilization * (demandFactor - 1) - inputs.processGain * 0.08;
  const mandaysGapChange = inputs.attendanceChange;

  const notes: string[] = [];
  if (baseline.utilization + utilizationChange > 92) notes.push("Capacity mendekati zona jenuh; tambahan volume tidak lagi memberi kenaikan produktivitas linear.");
  if (inputs.attendanceChange > 0 && productivityChange < 0) notes.push("Tambahan MP memperbaiki buffer SLA, tetapi menurunkan output per manday bila volume tidak ikut naik.");
  if (inputs.cancelChange < 0 && baseline.utilization < 85) notes.push("Pengurangan cancel berpotensi diserap tanpa penambahan MP karena kapasitas masih tersedia.");
  if (inputs.forecastChange < 0 && inputs.attendanceChange >= 0) notes.push("Demand turun sementara MP tetap: productivity dilution perlu diantisipasi dengan flexing atau cross-role allocation.");
  if (!notes.length) notes.push("Skenario berada dalam rentang operasi terkendali; pantau SLA dan demand fill sebagai guardrail.");

  return {
    productivityChange: clamp(productivityChange, -40, 40),
    slaChange: clamp(slaChange, -15, 15),
    demandFillChange: clamp(demandFillChange, -12, 12),
    utilizationChange: clamp(utilizationChange, -30, 30),
    mandaysGapChange: clamp(mandaysGapChange, -40, 40),
    notes,
  };
}
