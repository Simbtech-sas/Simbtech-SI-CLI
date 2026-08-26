import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFields } from './fields.ts';
import { toPascalCase, toCamelCase, toKebabCase, toSnakeCase, toPlural } from './naming.ts';

test('naming transforms cover the casings templates need', () => {
  assert.equal(toPascalCase('order_item'), 'OrderItem');
  assert.equal(toCamelCase('order-item'), 'orderItem');
  assert.equal(toKebabCase('OrderItem'), 'order-item');
  assert.equal(toSnakeCase('OrderItem'), 'order_item');
  assert.equal(toPlural('Category'), 'Categories');
});

test('naming rejects path traversal in an entity name', () => {
  // Entity names reach the filesystem, so `si scaffold ../../etc/passwd` must not
  // escape the module directory.
  assert.ok(!toKebabCase('../../etc/passwd').includes('..'));
  assert.ok(!toKebabCase('../../etc/passwd').includes('/'));
  assert.throws(() => toPascalCase(''), /Invalid input/);
});

test('field spec parses type, optionality and uniqueness', () => {
  const { fields } = parseFields('name:string sku:string:unique age:number:optional');
  assert.equal(fields.length, 3);
  assert.equal(fields[0]!.tsType, 'string');
  assert.equal(fields[0]!.isRequired, true);
  assert.equal(fields[1]!.isUnique, true);
  assert.equal(fields[2]!.isOptional, true);
});

test('money is a decimal string end to end, never a float', () => {
  const { fields, hasMoney } = parseFields('amount:money');
  const amount = fields[0]!;
  assert.equal(hasMoney, true);
  assert.equal(amount.isMoney, true);
  // The whole point: money must not pass through IEEE-754 at any layer.
  assert.equal(amount.tsType, 'string', 'TypeScript sees a decimal string');
  assert.equal(amount.drizzleType, 'numeric', 'Postgres stores exact decimal');
  assert.notEqual(amount.drizzleType, 'doublePrecision');
});

test('drizzle column types map for the common field kinds', () => {
  const { fields } = parseFields('a:string b:int c:boolean d:uuid e:json f:datetime g:decimal');
  assert.deepEqual(
    fields.map((f) => f.drizzleType),
    ['text', 'integer', 'boolean', 'uuid', 'jsonb', 'timestamp', 'numeric'],
  );
});

test('serverOwned fields persist but never enter a request DTO', () => {
  const { fields, hasServerOwned } = parseFields('tenantId:uuid:serverOwned name:string');
  assert.equal(hasServerOwned, true);
  assert.equal(fields[0]!.isServerOwned, true);
  assert.equal(fields[1]!.isServerOwned, false);
});

test('relations carry their target and cardinality', () => {
  const { fields, hasRelation } = parseFields('customer:relation:Customer:ManyToOne');
  assert.equal(hasRelation, true);
  assert.equal(fields[0]!.isRelation, true);
  assert.equal(fields[0]!.relationTarget, 'Customer');
  assert.equal(fields[0]!.relationType, 'ManyToOne');
});

test('enum values and arrays survive parsing', () => {
  const { fields, hasEnum } = parseFields('status:enum:active,inactive tags:string[]');
  assert.equal(hasEnum, true);
  assert.deepEqual(fields[0]!.enumValues, ['active', 'inactive']);
  assert.equal(fields[1]!.isArray, true);
});

test('an empty spec is valid and yields nothing', () => {
  const parsed = parseFields('');
  assert.deepEqual(parsed.fields, []);
  assert.equal(parsed.hasRelation, false);
});
