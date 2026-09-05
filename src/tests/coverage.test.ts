// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { computeCoverage, pathMatches, normalizePath, enumerateOperations, flattenSchemaPaths, flattenValuePaths, type CoverageRequestInput } from '../shared/coverage';

const SPEC = {
  info: { title: 'Shop API', version: '1.0.0' },
  paths: {
    '/products': {
      get:  { operationId: 'listProducts', responses: { '200': {} } },
      post: { operationId: 'createProduct', responses: { '201': {}, '400': {} } },
    },
    '/products/{id}': {
      get:    { responses: { '200': {}, '404': {} } },
      delete: { responses: { '204': {}, '404': {} } },
    },
  },
};

describe('normalizePath', () => {
  it('strips vars, host, query, and trailing slash', () => {
    expect(normalizePath('{{baseUrl}}/products/15?q=1')).toBe('/products/15');
    expect(normalizePath('https://api.example.com/v1/products/')).toBe('/v1/products');
    expect(normalizePath('/products')).toBe('/products');
  });
});

describe('pathMatches', () => {
  it('matches a concrete path to a template, tolerating a base path', () => {
    expect(pathMatches('{{baseUrl}}/products/15', '/products/{id}')).toBe(true);
    expect(pathMatches('https://x/v1/products/15', '/products/{id}')).toBe(true);
    expect(pathMatches('/products', '/products')).toBe(true);
  });
  it('does not match a different depth or literal', () => {
    expect(pathMatches('/products', '/products/{id}')).toBe(false);
    expect(pathMatches('/orders/15', '/products/{id}')).toBe(false);
  });
});

describe('enumerateOperations', () => {
  it('lists operations with numeric declared statuses only', () => {
    const ops = enumerateOperations({ paths: { '/x': { get: { responses: { '200': {}, default: {}, '2XX': {} } } } } });
    expect(ops).toHaveLength(1);
    expect(ops[0].declaredStatuses).toEqual(['200']);
  });
});

describe('computeCoverage', () => {
  const reqs = (list: CoverageRequestInput[]) => list;

  it('reports operation and status coverage', () => {
    const report = computeCoverage(SPEC, reqs([
      { name: 'List', method: 'GET', url: '{{base}}/products', expectedStatus: 200 },
      { name: 'Get', method: 'GET', url: '{{base}}/products/15', expectedStatus: 200 },
      { name: 'Get missing', method: 'GET', url: '{{base}}/products/999', expectedStatus: 404 },
    ]));

    expect(report.spec.title).toBe('Shop API');
    expect(report.totals.operations).toBe(4);
    expect(report.totals.tested).toBe(2);              // GET /products, GET /products/{id}
    expect(report.totals.untested).toBe(2);            // POST /products, DELETE /products/{id}
    expect(report.totals.operationPct).toBe(50);

    const getById = report.operations.find(o => o.path === '/products/{id}' && o.method === 'GET')!;
    expect(getById.tested).toBe(true);
    expect(getById.coveredStatuses.sort()).toEqual(['200', '404']);
    expect(getById.hasNegativeTest).toBe(true);        // 404 asserted
  });

  it('flags tested operations lacking a negative test', () => {
    const report = computeCoverage(SPEC, reqs([
      { name: 'List', method: 'GET', url: '/products', expectedStatus: 200 },
    ]));
    const list = report.operations.find(o => o.path === '/products' && o.method === 'GET')!;
    expect(list.tested).toBe(true);
    expect(list.hasNegativeTest).toBe(false);
    expect(report.totals.withoutNegativeTest).toBeGreaterThanOrEqual(1);
  });

  it('counts a request with no expected status as covering the operation but no status', () => {
    const report = computeCoverage(SPEC, reqs([
      { name: 'List', method: 'GET', url: '/products' },
    ]));
    const list = report.operations.find(o => o.path === '/products' && o.method === 'GET')!;
    expect(list.tested).toBe(true);
    expect(list.coveredStatuses).toEqual([]);
  });

  it('handles an empty spec', () => {
    const report = computeCoverage({}, []);
    expect(report.totals.operations).toBe(0);
    expect(report.totals.operationPct).toBe(0);
  });

  it('credits status codes and marks an operation tested from run observations', () => {
    const report = computeCoverage(SPEC, [], [
      { method: 'GET', url: 'https://x/products/9', status: 404 },
    ]);
    const getById = report.operations.find(o => o.path === '/products/{id}' && o.method === 'GET')!;
    expect(getById.tested).toBe(true);                 // observed, even with no request
    expect(getById.coveredStatuses).toContain('404');
    expect(getById.hasNegativeTest).toBe(true);
  });
});

const SCHEMA_SPEC = {
  paths: {
    '/products/{id}': {
      get: {
        responses: {
          '200': { content: { 'application/json': { schema: {
            type: 'object',
            properties: { id: { type: 'integer' }, name: { type: 'string' }, price: { type: 'number' } },
          } } } },
        },
      },
    },
  },
};

describe('schema-property coverage', () => {
  it('flattens schema and value paths consistently', () => {
    expect(flattenSchemaPaths({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'object', properties: { c: { type: 'integer' } } } } }))
      .toEqual(['a', 'b', 'b.c']);
    expect(flattenValuePaths({ a: 'x', b: { c: 1 } }).sort()).toEqual(['a', 'b', 'b.c']);
  });

  it('credits response properties seen in an observed body', () => {
    const report = computeCoverage(SCHEMA_SPEC, [], [
      { method: 'GET', url: '/products/1', status: 200, responsePaths: flattenValuePaths({ id: 1, name: 'Hammer' }) },
    ]);
    const op = report.operations[0];
    expect(op.declaredProperties.sort()).toEqual(['id', 'name', 'price']);
    expect(op.coveredProperties.sort()).toEqual(['id', 'name']);   // price never returned
    expect(report.totals.propertyPct).toBeCloseTo(66.7, 0);
  });

  it('is 0% property coverage with no observations', () => {
    const report = computeCoverage(SCHEMA_SPEC, [{ name: 'Get', method: 'GET', url: '/products/1', expectedStatus: 200 }]);
    expect(report.totals.declaredProperties).toBe(3);
    expect(report.totals.propertyPct).toBe(0);
  });
});
