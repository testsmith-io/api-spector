// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { translateScript } from '../main/importers/script-translator';

describe('translateScript — pm.* → sp.*', () => {
  it('translates environment and globals setters', () => {
    const out = translateScript(
      `pm.environment.set("a", "1");\npm.globals.set("b", "2");`,
      'postman',
    );
    expect(out).toContain('sp.environment.set("a", "1")');
    expect(out).toContain('sp.globals.set("b", "2")');
    expect(out).not.toContain('pm.');
  });
});

describe('translateScript — require(\'moment\') → dayjs', () => {
  it('aliases a moment require to the global dayjs (postman)', () => {
    const out = translateScript(`var moment = require('moment');`, 'postman');
    expect(out).toBe('var moment = dayjs;');
    expect(out).not.toContain('require(');
  });

  it('handles double quotes and extra whitespace', () => {
    expect(translateScript(`const m = require( "moment" )`, 'postman')).toBe('const m = dayjs');
  });

  it('rewrites an inline require call', () => {
    expect(translateScript(`require('moment')().format('YYYY-MM-DD')`, 'postman'))
      .toBe(`dayjs().format('YYYY-MM-DD')`);
  });

  it('applies to bruno and insomnia scripts too', () => {
    expect(translateScript(`let moment = require('moment')`, 'bruno')).toBe('let moment = dayjs');
    expect(translateScript(`let moment = require('moment')`, 'insomnia')).toBe('let moment = dayjs');
  });

  it('leaves other require calls untouched', () => {
    const out = translateScript(`var _ = require('lodash')`, 'postman');
    expect(out).toContain(`require('lodash')`);
  });

  it('converts the real-world example into something runnable', () => {
    const input = [
      `pm.environment.set("currentDate", new Date().toLocaleDateString('sv'));`,
      `var moment = require('moment');`,
      `pm.globals.set("currentDate_15", moment().add(15, 'day').format("YYYY-MM-DD"));`,
    ].join('\n');

    const out = translateScript(input, 'postman');

    expect(out).toContain('sp.environment.set("currentDate"');
    expect(out).toContain('var moment = dayjs;');
    // moment() keeps working because it now aliases dayjs()
    expect(out).toContain(`sp.globals.set("currentDate_15", moment().add(15, 'day').format("YYYY-MM-DD"));`);
    expect(out).not.toContain('require(');
    expect(out).not.toContain('pm.');
  });
});
