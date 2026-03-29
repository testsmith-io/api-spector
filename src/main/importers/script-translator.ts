// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

// ─── Script translator ────────────────────────────────────────────────────────
//
// Converts pre/post-request scripts from Postman (pm.*), Bruno (bru.*/res.*),
// and Insomnia (insomnia.*) into api spector's sp.* scripting API.

type Rule = [RegExp, string]

// ─── Postman (pm.*) ───────────────────────────────────────────────────────────

const POSTMAN_RULES: Rule[] = [
  // Variables — environment
  [/\bpm\.environment\.get\(/g,                    'sp.environment.get('],
  [/\bpm\.environment\.set\(/g,                    'sp.environment.set('],
  [/\bpm\.environment\.unset\(/g,                  'sp.environment.clear('],
  [/\bpm\.environment\.has\(/g,                    'sp.environment.has('],

  // Variables — collection
  [/\bpm\.collectionVariables\.get\(/g,            'sp.collectionVariables.get('],
  [/\bpm\.collectionVariables\.set\(/g,            'sp.collectionVariables.set('],
  [/\bpm\.collectionVariables\.unset\(/g,          'sp.collectionVariables.clear('],
  [/\bpm\.collectionVariables\.has\(/g,            'sp.collectionVariables.has('],

  // Variables — globals
  [/\bpm\.globals\.get\(/g,                        'sp.globals.get('],
  [/\bpm\.globals\.set\(/g,                        'sp.globals.set('],
  [/\bpm\.globals\.unset\(/g,                      'sp.globals.clear('],
  [/\bpm\.globals\.has\(/g,                        'sp.globals.has('],

  // Variables — local/request scope
  [/\bpm\.variables\.get\(/g,                      'sp.variables.get('],
  [/\bpm\.variables\.set\(/g,                      'sp.variables.set('],

  // Tests & assertions
  [/\bpm\.test\(/g,                                'sp.test('],
  [/\bpm\.expect\(/g,                              'sp.expect('],

  // Response — status
  [/\bpm\.response\.to\.have\.status\(/g,          'sp.response.to.have.status('],
  [/\bpm\.response\.code\b/g,                      'sp.response.code'],
  [/\bpm\.response\.status\b/g,                    'sp.response.status'],
  [/\bpm\.response\.responseTime\b/g,              'sp.response.responseTime'],

  // Response — headers
  [/\bpm\.response\.headers\.get\(/g,              'sp.response.headers.get('],

  // Response — body
  [/\bpm\.response\.json\(\)/g,                    'sp.response.json()'],
  [/\bpm\.response\.text\(\)/g,                    'sp.response.text()'],
];

// ─── Bruno (bru.* / res.*) ────────────────────────────────────────────────────

const BRUNO_RULES: Rule[] = [
  // Variables — environment
  [/\bbru\.getEnvVar\(/g,                          'sp.environment.get('],
  [/\bbru\.setEnvVar\(/g,                          'sp.environment.set('],
  [/\bbru\.deleteEnvVar\(/g,                       'sp.environment.clear('],

  // Variables — collection
  [/\bbru\.getCollectionVar\(/g,                   'sp.collectionVariables.get('],
  [/\bbru\.setCollectionVar\(/g,                   'sp.collectionVariables.set('],
  [/\bbru\.deleteCollectionVar\(/g,                'sp.collectionVariables.clear('],

  // Variables — local/request scope
  [/\bbru\.getVar\(/g,                             'sp.variables.get('],
  [/\bbru\.setVar\(/g,                             'sp.variables.set('],
  [/\bbru\.deleteVar\(/g,                          'sp.variables.clear('],

  // Response — body (order matters: specific first)
  [/\bres\.getBody\(\)\.json\(\)/g,                'sp.response.json()'],
  [/\bres\.getBody\(\)\.text\(\)/g,                'sp.response.text()'],
  [/\bres\.getBody\(\)/g,                          'sp.response.json()'],

  // Response — status / headers / time
  [/\bres\.getStatus\(\)/g,                        'sp.response.code'],
  [/\bres\.getHeader\(/g,                          'sp.response.headers.get('],
  [/\bres\.getResponseTime\(\)/g,                  'sp.response.responseTime'],

  // Tests & assertions (bare expect/test — Bruno exposes them as globals)
  [/(?<!\.)(?<!\w)expect\(/g,                      'sp.expect('],
  [/(?<!\.)(?<!\w)test\(/g,                        'sp.test('],
];

// ─── Insomnia (insomnia.* / context.*) ───────────────────────────────────────

const INSOMNIA_RULES: Rule[] = [
  // Older SDK: insomnia.*
  [/\binsomnia\.environment\.get\(/g,              'sp.environment.get('],
  [/\binsomnia\.environment\.set\(/g,              'sp.environment.set('],
  [/\binsomnia\.environment\.getItem\(/g,          'sp.environment.get('],
  [/\binsomnia\.environment\.setItem\(/g,          'sp.environment.set('],

  // Newer SDK: context.*
  [/\bcontext\.environment\.get\(/g,               'sp.environment.get('],
  [/\bcontext\.environment\.set\(/g,               'sp.environment.set('],
  [/\bcontext\.environment\.getItem\(/g,           'sp.environment.get('],
  [/\bcontext\.environment\.setItem\(/g,           'sp.environment.set('],

  // Response
  [/\bcontext\.response\.getBody\(\)\.json\(\)/g,  'sp.response.json()'],
  [/\bcontext\.response\.getBody\(\)/g,            'sp.response.text()'],
  [/\bcontext\.response\.getStatusCode\(\)/g,      'sp.response.code'],
  [/\bcontext\.response\.getHeader\(/g,            'sp.response.headers.get('],
];

// ─── Public API ───────────────────────────────────────────────────────────────

export type ScriptFormat = 'postman' | 'bruno' | 'insomnia'

export function translateScript(source: string, format: ScriptFormat): string {
  const rules =
    format === 'postman'  ? POSTMAN_RULES  :
    format === 'bruno'    ? BRUNO_RULES    :
                            INSOMNIA_RULES;

  return rules.reduce((src, [pattern, replacement]) => src.replace(pattern, replacement), source);
}
