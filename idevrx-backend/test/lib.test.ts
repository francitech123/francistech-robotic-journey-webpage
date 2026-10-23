import { describe, it, expect } from "vitest";
import { csvCell, diffSnapshots } from "../src/lib.js";

describe("csvCell", () => {
  it("quotes, escapes quotes and neutralises spreadsheet formulas", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=SUM(A1)")).toBe(`"'=SUM(A1)"`);
    expect(csvCell("+1")).toBe(`"'+1"`);
    expect(csvCell(5)).toBe('"5"');
    expect(csvCell(undefined)).toBe('""');
  });
});

describe("diffSnapshots", () => {
  const a = { title: "Lock", tags: ["Arduino", "RFID"], components: [{ name: "Arduino UNO", qty: 1, spec: "5V" }, { name: "Buzzer", qty: 1, spec: "" }], steps: ["Wire", "Flash"] };
  const b = { title: "Lock v2", tags: ["Arduino", "Keypad"], components: [{ name: "arduino uno", qty: 2, spec: "5V" }, { name: "Keypad", qty: 1, spec: "4x4" }], steps: ["Wire", "Flash", "Test"] };

  it("reports field, tag, component and step changes", () => {
    const d = diffSnapshots(a, b);
    expect(d.identical).toBe(false);
    expect(d.changes).toEqual([{ field: "title", from: "Lock", to: "Lock v2" }]);
    expect(d.tags).toEqual({ added: ["Keypad"], removed: ["RFID"] });
    expect(d.components.added).toEqual([{ name: "Keypad", qty: 1, spec: "4x4" }]);
    expect(d.components.removed).toEqual([{ name: "Buzzer", qty: 1, spec: "" }]);
    expect(d.components.changed).toHaveLength(1);
    expect(d.steps).toEqual({ added: ["Test"], removed: [] });
  });

  it("treats equal snapshots as identical", () => {
    expect(diffSnapshots(a, a).identical).toBe(true);
    expect(diffSnapshots({}, {}).identical).toBe(true);
  });
});
