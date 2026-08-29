import { debuggerCapabilityOutputSchema } from './output-schemas.js';

type JsonSchema = Readonly<Record<string, unknown>>;

type ProjectedObjectSchema = JsonSchema & {
  readonly type: 'object';
  readonly additionalProperties: false;
  readonly properties: Readonly<Record<string, JsonSchema>>;
  readonly required: readonly string[];
};

const shallowObjectSchema = Object.freeze({ type: 'object' });
const shallowArraySchema = Object.freeze({ type: 'array' });
const uiOutputSchemas = new Map<string, JsonSchema>();

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireSchema(value: unknown, label: string): JsonSchema {
  if (!isRecord(value)) {
    throw new Error(`Cannot project ${label}: expected a JSON schema object.`);
  }
  return value;
}

function schemaProperties(
  schema: JsonSchema,
  label: string,
): Readonly<Record<string, unknown>> {
  const properties = schema['properties'];
  if (!isRecord(properties)) {
    throw new Error(`Cannot project ${label}: expected object schema properties.`);
  }
  return properties;
}

function schemaRequired(schema: JsonSchema, label: string): readonly string[] {
  const required = schema['required'];
  if (!Array.isArray(required) || !required.every((key) => typeof key === 'string')) {
    throw new Error(`Cannot project ${label}: expected a string required-property list.`);
  }
  return Object.freeze([...required]);
}

function projectProperty(value: unknown, label: string): JsonSchema {
  const schema = requireSchema(value, label);
  const alternatives = schema['oneOf'];
  if (Array.isArray(alternatives)) {
    const types = alternatives.map((alternative, index) => {
      const type = requireSchema(alternative, `${label}.oneOf[${index}]`)['type'];
      if (typeof type !== 'string') {
        throw new Error(`Cannot project ${label}: expected typed oneOf alternatives.`);
      }
      return type;
    });
    return Object.freeze({ type: Object.freeze(types) });
  }
  if (schema['type'] === 'object' || typeof schema['$ref'] === 'string') {
    return shallowObjectSchema;
  }
  if (schema['type'] === 'array') {
    return shallowArraySchema;
  }
  return schema;
}

function projectObjectSchema(schema: JsonSchema, label: string): ProjectedObjectSchema {
  if (schema['type'] !== 'object' || schema['additionalProperties'] !== false) {
    throw new Error(`Cannot project ${label}: expected a strict object schema.`);
  }

  const properties = Object.fromEntries(
    Object.entries(schemaProperties(schema, label)).map(([key, value]) => [
      key,
      projectProperty(value, `${label}.${key}`),
    ]),
  );

  return Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: Object.freeze(properties),
    required: schemaRequired(schema, label),
  });
}

function projectValueSchema(value: unknown, capability: string): JsonSchema {
  const schema = requireSchema(value, `${capability} value`);
  const alternatives = schema['oneOf'];
  if (!Array.isArray(alternatives)) {
    return projectObjectSchema(schema, `${capability} value`);
  }
  if (alternatives.length === 0) {
    throw new Error(`Cannot project ${capability} value: oneOf must not be empty.`);
  }

  const projections = alternatives.map((alternative, index) =>
    projectObjectSchema(
      requireSchema(alternative, `${capability} value.oneOf[${index}]`),
      `${capability} value.oneOf[${index}]`,
    ),
  );
  const [firstProjection, ...remainingProjections] = projections;
  if (!firstProjection) {
    throw new Error(`Cannot project ${capability} value: oneOf must not be empty.`);
  }
  const mergedProperties: Record<string, JsonSchema> = {};
  for (const projection of projections) {
    Object.assign(mergedProperties, projection.properties);
  }
  const properties: Readonly<Record<string, JsonSchema>> = Object.freeze(mergedProperties);
  const required = Object.freeze(
    remainingProjections.reduce(
      (common, projection) =>
        common.filter((property) => projection.required.includes(property)),
      [...firstProjection.required],
    ),
  );

  return Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  });
}

export function debuggerUiOutputSchema(capability: string): JsonSchema {
  const cached = uiOutputSchemas.get(capability);
  if (cached) return cached;

  const fullSchema = debuggerCapabilityOutputSchema(capability);
  if (fullSchema['type'] !== 'object' || fullSchema['additionalProperties'] !== false) {
    throw new Error(`Cannot project ${capability}: expected a strict bridge output schema.`);
  }

  const properties = schemaProperties(fullSchema, capability);
  const projectedProperties = Object.freeze(
    Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [
        key,
        key === 'value'
          ? projectValueSchema(value, capability)
          : projectProperty(value, `${capability}.${key}`),
      ]),
    ),
  );
  const projected = Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: projectedProperties,
    required: schemaRequired(fullSchema, capability),
  });
  uiOutputSchemas.set(capability, projected);
  return projected;
}
