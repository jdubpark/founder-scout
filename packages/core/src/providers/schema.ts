import { z } from "zod";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Makes every object in a JSON Schema strict: `additionalProperties: false`
 * and every property listed in `required`. OpenAI-style strict structured
 * output requires this shape, and the other vendors accept it.
 */
function strictify(node: unknown, path: string): unknown {
  if (Array.isArray(node)) {
    return node.map((child, i) => strictify(child, `${path}[${i}]`));
  }
  if (!isObject(node)) return node;

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$schema") continue;
    if (key === "properties" && isObject(value)) {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, strictify(child, `${path}.${name}`)]),
      );
      continue;
    }
    if (key === "additionalProperties") {
      if (value !== false) {
        throw new Error(`${path}: open-ended objects cannot be sent as a strict provider schema`);
      }
      continue;
    }
    if (key === "items" || key === "anyOf" || key === "oneOf" || key === "allOf" || key === "prefixItems") {
      out[key] = strictify(value, `${path}.${key}`);
      continue;
    }
    if (key === "$defs" && isObject(value)) {
      out.$defs = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, strictify(child, `${path}.$defs.${name}`)]),
      );
      continue;
    }
    out[key] = value;
  }

  if (out.type === "object" || isObject(out.properties)) {
    const properties = isObject(out.properties) ? out.properties : {};
    out.additionalProperties = false;
    out.required = Object.keys(properties);
  }
  return out;
}

/**
 * The JSON Schema a provider receives for a job output. Zod 4 emits draft
 * 2020-12 with `$schema`; that is stripped, and the object rules above are applied.
 */
export function toProviderJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { io: "output" });
  const strict = strictify(raw, "$");
  if (!isObject(strict)) throw new Error("toProviderJsonSchema: schema did not produce an object");
  return strict;
}
