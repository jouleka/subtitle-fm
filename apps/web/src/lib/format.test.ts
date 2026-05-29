import { describe, expect, test } from "bun:test";
import { formatMs, parseTimecode } from "./format";

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

describe("parseTimecode", () => {
  test("round-trips with formatMs (intent: a value displayed then re-parsed is unchanged)", () => {
    expect(parseTimecode(formatMs(75_500))).toBe(75_500);
  });

  test("parses zero (intent: episode start is valid)", () => {
    expect(parseTimecode("00:00.00")).toBe(0);
  });

  test("treats a single centisecond digit as tenths (intent: '.5' means half a second)", () => {
    expect(parseTimecode("01:15.5")).toBe(75_500);
  });

  test("rejects non-timecode text (intent: typos must not silently become 0)", () => {
    expect(parseTimecode("abc")).toBeNull();
  });

  test("rejects a missing centiseconds part (intent: incomplete input is invalid)", () => {
    expect(parseTimecode("1:2")).toBeNull();
  });

  test("rejects three centisecond digits (intent: format is mm:ss.xx)", () => {
    expect(parseTimecode("0:00.000")).toBeNull();
  });

  test("rejects seconds over 59 (intent: seconds are 0-59)", () => {
    expect(parseTimecode("0:60.00")).toBeNull();
  });

  test("rejects negatives (intent: time cannot be negative)", () => {
    expect(parseTimecode("-1:00.00")).toBeNull();
  });
});
