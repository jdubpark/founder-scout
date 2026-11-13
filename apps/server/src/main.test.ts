import { describe, expect, it } from "vitest";
import { assertLoopbackHost, isLoopbackHost } from "./main";

describe("server host guard", () => {
  it.each(["127.0.0.1", "localhost", "::1"])("allows %s", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
    expect(() => assertLoopbackHost(host)).not.toThrow();
  });

  it.each(["0.0.0.0", "192.168.1.20", "example.com"])("refuses %s", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
    expect(() => assertLoopbackHost(host)).toThrow(/no login yet/i);
  });
});
