import { describe, expect, test } from "bun:test";
import { formatMs } from "./format";

describe("formatMs", () => {
  test("renders 0 as 00:00.00 (intent: zero is a real value, not a blank)", () => {
    expect(formatMs(0)).toBe("00:00.00");
  });

  test("renders sub-second values padded to .xx (intent: alignment in the cue list)", () => {
    expect(formatMs(1234)).toBe("00:01.23");
  });

  test("renders 75500ms as 01:15.50 (intent: minute rollover works)", () => {
    expect(formatMs(75_500)).toBe("01:15.50");
  });

  test("renders just-under-an-hour as 59:59.99 (intent: two-digit minute cap)", () => {
    expect(formatMs(3_600_000 - 10)).toBe("59:59.99");
  });

  test("rounds the hundredths down (intent: never display a timestamp past the cue end)", () => {
    expect(formatMs(1239)).toBe("00:01.23");
  });
});
