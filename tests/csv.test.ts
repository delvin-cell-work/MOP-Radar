import { describe, expect, it } from "vitest";

import { parseCsv } from "../scripts/pipeline/csv";

describe("parseCsv", () => {
  it("parses plain rows with a trailing newline", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted commas, escaped quotes and CRLF", () => {
    expect(parseCsv('block,street\r\n"12","ST. GEORGE\'S RD, ""A"""\r\n')).toEqual([
      ["block", "street"],
      ["12", 'ST. GEORGE\'S RD, "A"'],
    ]);
  });

  it("keeps empty fields, including a trailing one", () => {
    expect(parseCsv("a,,c\n1,2,")).toEqual([
      ["a", "", "c"],
      ["1", "2", ""],
    ]);
  });

  it("skips blank lines and strips a byte-order mark", () => {
    expect(parseCsv("﻿a,b\n\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("throws on an unterminated quote rather than guessing", () => {
    expect(() => parseCsv('a,b\n"1,2\n')).toThrow(/unterminated/);
  });

  it("throws on text straight after a closing quote", () => {
    expect(() => parseCsv('"1"x,2\n')).toThrow(/unexpected character/);
  });
});
