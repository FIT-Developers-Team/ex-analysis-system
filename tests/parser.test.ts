import { describe, expect, it } from "vitest";
import { parseOperationalSheets } from "@/lib/data/parser";

describe("parseOperationalSheets", () => {
  it("normalizes warehouse matrix and preserves missing/error semantics", () => {
    const dataset = parseOperationalSheets({
      "Frozen - PGS": [
        ["Division", "Role", "Remarks", "Description", "Details", "Main Source", "Source Jan", null, "2026-08-10", "2026-08-11", "2026-08-13"],
        ["Outbound", "Out-All", "", "Fulfillment Rate % Warehouse", "RTS / request", "SSOT", "", null, 0.99, "#DIV/0!", 1],
      ],
      Highlight: [["WH", "Metrics", "Issue", "Action Plan"], ["PGS", "Productivity", "Low", "Investigate"]],
    }, "workbook", "test.xlsx", "2026-08-12T03:00:00.000Z");

    expect(dataset.points).toHaveLength(3);
    expect(dataset.points.map((point) => point.quality)).toEqual(["valid", "formula_error", "future"]);
    expect(dataset.diagnostics.latestCompleteDate).toBe("2026-08-10");
    expect(dataset.highlights[0]).toMatchObject({ warehouse: "PGS", issue: "Low" });
  });
});
