import { describe, expect, it } from "vitest";
import { z } from "zod";
import { JOB_OUTPUT_SCHEMAS } from "@agentswarm/shared";
import { toProviderJsonSchema } from "./schema";

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every object-typed node must be closed and list every property as required. */
function assertStrict(node: unknown, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => assertStrict(child, `${path}[${i}]`));
    return;
  }
  if (!isObject(node)) return;

  if (isObject(node.properties)) {
    expect(node.additionalProperties, `${path} additionalProperties`).toBe(false);
    expect([...((node.required as string[]) ?? [])].sort(), `${path} required`).toEqual(
      Object.keys(node.properties).sort(),
    );
    for (const [name, child] of Object.entries(node.properties)) {
      assertStrict(child, `${path}.${name}`);
    }
  }
  for (const key of ["items", "anyOf", "oneOf", "allOf", "prefixItems"]) {
    if (key in node) assertStrict(node[key], `${path}.${key}`);
  }
  if (isObject(node.$defs)) {
    for (const [name, child] of Object.entries(node.$defs)) assertStrict(child, `${path}.$defs.${name}`);
  }
}

describe("toProviderJsonSchema", () => {
  it.each(Object.entries(JOB_OUTPUT_SCHEMAS))("is strict for %s", (_jobId, schema) => {
    const json = toProviderJsonSchema(schema);
    expect(json).not.toHaveProperty("$schema");
    expect(json.type).toBe("object");
    expect(json.additionalProperties).toBe(false);
    assertStrict(json, "$");
  });

  it("keeps nullable fields as a null-or-type union and marks them required", () => {
    const json = toProviderJsonSchema(z.object({ role: z.string().nullable() }));
    expect(json.required).toEqual(["role"]);
    expect(JSON.stringify(json)).toContain('"null"');
  });

  it("closes nested objects inside arrays", () => {
    const json = toProviderJsonSchema(
      z.object({ items: z.array(z.object({ a: z.number(), b: z.boolean() })) }),
    );
    const items = (json.properties as Json).items as Json;
    const element = items.items as Json;
    expect(element.additionalProperties).toBe(false);
    expect(element.required).toEqual(["a", "b"]);
  });

  it("refuses open-ended records instead of sending a schema that is not strict", () => {
    expect(() => toProviderJsonSchema(z.object({ tags: z.record(z.string(), z.string()) }))).toThrow(
      /open-ended/,
    );
  });
});
