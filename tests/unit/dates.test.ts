import { describe, expect, it } from "vitest";
import { addDays, daysBetween, todayIST, weekStartOf } from "@/lib/dates";

describe("dates (Asia/Kolkata, weeks start Monday)", () => {
  it("todayIST rolls the date at IST midnight, not UTC", () => {
    expect(todayIST(new Date("2026-09-28T18:29:00Z"))).toBe("2026-09-28"); // 23:59 IST
    expect(todayIST(new Date("2026-09-28T18:31:00Z"))).toBe("2026-09-29"); // 00:01 IST next day
  });
  it("weekStartOf returns the Monday", () => {
    expect(weekStartOf("2026-09-29")).toBe("2026-09-28"); // Tuesday
    expect(weekStartOf("2026-09-28")).toBe("2026-09-28"); // Monday
    expect(weekStartOf("2026-10-04")).toBe("2026-09-28"); // Sunday belongs to the week that started Monday
  });
  it("addDays crosses month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("daysBetween counts whole days", () => {
    expect(daysBetween("2026-09-01", "2026-09-29")).toBe(28);
  });
});
