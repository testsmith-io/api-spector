#!/usr/bin/env node
// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

/**
 * api-spector agents init <name>
 *
 * Scaffolds AI agent instruction files so any LLM-powered coding tool
 * (Claude Code, GitHub Copilot, Cursor, Windsurf, Aider) can generate
 * API Spector test plans and scripts.
 *
 * Usage:
 *   api-spector agents init claude      — .claude/skills/*.md
 *   api-spector agents init copilot     — .github/copilot-instructions.md
 *   api-spector agents init cursor      — .cursor/rules/api-spector.mdc
 *   api-spector agents init windsurf    — .windsurfrules
 *   api-spector agents init aider       — conventions.md
 *   api-spector agents init all         — all of the above
 *   api-spector agents list             — show available agents
 */

import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join, dirname } from 'path';

// ─── Color helpers ───────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
};

function color ( text: string, ...codes: string[] ): string {
  return codes.join( '' ) + text + C.reset;
}

// ─── Agent definitions ───────────────────────────────────────────────────────

interface AgentDef {
  name: string
  description: string
  /** Files to copy: { sourcePath (relative to templates dir) → destPath (relative to cwd) } */
  files: { src: string; dest: string }[]
}

const AGENTS: Record<string, AgentDef> = {
  claude: {
    name: 'Claude Code',
    description: 'Skills for Claude Code (.claude/skills/)',
    files: [
      { src: 'claude/skills/api-spector-functional-tests.md', dest: '.claude/skills/api-spector-functional-tests/SKILL.md' },
      { src: 'claude/skills/api-spector-security-tests.md', dest: '.claude/skills/api-spector-security-tests/SKILL.md' },
      { src: 'claude/skills/api-spector-generate-mocks.md', dest: '.claude/skills/api-spector-generate-mocks/SKILL.md' },
      { src: 'claude/skills/api-spector-api-audit.md', dest: '.claude/skills/api-spector-api-audit/SKILL.md' },
    ],
  },
  copilot: {
    name: 'GitHub Copilot',
    description: 'Instructions for Copilot (.github/copilot-instructions.md)',
    files: [
      { src: 'copilot/copilot-instructions.md', dest: '.github/copilot-instructions.md' },
    ],
  },
  cursor: {
    name: 'Cursor',
    description: 'Rules for Cursor (.cursor/rules/api-spector.mdc)',
    files: [
      { src: 'cursor/rules/api-spector.mdc', dest: '.cursor/rules/api-spector.mdc' },
    ],
  },
  windsurf: {
    name: 'Windsurf',
    description: 'Rules for Windsurf (.windsurfrules)',
    files: [
      { src: 'windsurf/windsurfrules', dest: '.windsurfrules' },
    ],
  },
  aider: {
    name: 'Aider',
    description: 'Conventions for Aider (conventions.md)',
    files: [
      { src: 'aider/conventions.md', dest: 'conventions.md' },
    ],
  },
};

// ─── Shared docs (copied into a tool-specific location) ──────────────────────

/** Build doc destinations based on the agent being initialized. Keeps
 *  everything under the tool's own config directory so we don't pollute
 *  the project root with a `docs/ai/` folder. */
function sharedDocsForAgent ( agentName: string ): { src: string; dest: string }[] {
  // Determine a directory the agent's instruction files can reference
  const destDir: Record<string, string> = {
    claude: '.claude/docs',
    copilot: '.github/docs',
    cursor: '.cursor/docs',
    windsurf: '.windsurf/docs',
    aider: '.aider/docs',
  };
  const dir = destDir[agentName] ?? '.api-spector/docs';
  return [
    { src: 'api-spector-scripting-reference.md', dest: `${dir}/api-spector-scripting-reference.md` },
    { src: 'collection-file-format.md', dest: `${dir}/collection-file-format.md` },
    { src: 'functional-testing-guide.md', dest: `${dir}/functional-testing-guide.md` },
    { src: 'security-testing-guide.md', dest: `${dir}/security-testing-guide.md` },
  ];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve the package root (where package.json lives). Works from both
 *  `src/cli/agents.ts` (dev) and `out/main/agents.js` (compiled). */
function getPackageRoot (): string {
  let dir = __dirname;
  for ( let i = 0; i < 5; i++ ) {
    try {
      require.resolve( join( dir, 'package.json' ) );
      return dir;
    } catch { dir = dirname( dir ); }
  }
  return join( __dirname, '..', '..' );
}

function getTemplatesDir (): string {
  return join( getPackageRoot(), 'src', 'cli', 'agent-templates' );
}

function getDocsDir (): string {
  return join( getPackageRoot(), 'docs', 'ai' );
}

async function fileExists ( path: string ): Promise<boolean> {
  try { await stat( path ); return true; } catch { return false; }
}

async function copyFile ( src: string, dest: string, cwd: string ): Promise<'created' | 'exists' | 'updated'> {
  const destPath = join( cwd, dest );
  const existed = await fileExists( destPath );

  await mkdir( dirname( destPath ), { recursive: true } );

  const content = await readFile( src, 'utf8' );
  if ( existed ) {
    const existing = await readFile( destPath, 'utf8' );
    if ( existing === content ) return 'exists';
  }

  await writeFile( destPath, content, 'utf8' );
  return existed ? 'updated' : 'created';
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function initAgent ( agentName: string, cwd: string ): Promise<void> {
  const names = agentName === 'all' ? Object.keys( AGENTS ) : [agentName];

  for ( const name of names ) {
    const agent = AGENTS[name];
    if ( !agent ) {
      console.error( color( `  Unknown agent: "${name}"`, C.red ) );
      console.error( `  Available: ${Object.keys( AGENTS ).join( ', ' )}, all` );
      process.exit( 1 );
    }

    console.log( color( `\n  ${agent.name}`, C.bold, C.cyan ) );

    const templatesDir = getTemplatesDir();
    for ( const file of agent.files ) {
      const srcPath = join( templatesDir, file.src );
      if ( !await fileExists( srcPath ) ) {
        console.log( color( `    skip ${file.dest} (template not found)`, C.yellow ) );
        continue;
      }
      const result = await copyFile( srcPath, file.dest, cwd );
      const icon = result === 'created' ? color( '+', C.green ) : result === 'updated' ? color( '~', C.yellow ) : color( '=', C.gray );
      const label = result === 'exists' ? 'unchanged' : result;
      console.log( `    ${icon} ${file.dest} ${color( `(${label})`, C.gray )}` );
    }
  }

  // Copy shared docs into each agent's own config directory
  console.log( color( `\n  Shared documentation`, C.bold, C.cyan ) );
  const docsDir = getDocsDir();
  const allDocDests = new Set<string>();  // deduplicate when running 'all'
  for ( const name of names ) {
    for ( const doc of sharedDocsForAgent( name ) ) {
      if ( allDocDests.has( doc.dest ) ) continue;
      allDocDests.add( doc.dest );
      const srcPath = join( docsDir, doc.src );
      if ( !await fileExists( srcPath ) ) {
        console.log( color( `    skip ${doc.dest} (not found)`, C.yellow ) );
        continue;
      }
      const result = await copyFile( srcPath, doc.dest, cwd );
      const icon = result === 'created' ? color( '+', C.green ) : result === 'updated' ? color( '~', C.yellow ) : color( '=', C.gray );
      const label = result === 'exists' ? 'unchanged' : result;
      console.log( `    ${icon} ${doc.dest} ${color( `(${label})`, C.gray )}` );
    }
  }

  console.log( color( '\n  Done. Your AI agent can now generate API Spector tests.\n', C.green ) );
}

function listAgents (): void {
  console.log( color( '\n  Available agents:\n', C.bold ) );
  for ( const [key, agent] of Object.entries( AGENTS ) ) {
    console.log( `    ${color( key.padEnd( 12 ), C.cyan )} ${agent.description}` );
  }
  console.log( `    ${color( 'all'.padEnd( 12 ), C.cyan )} Initialize all agents at once` );
  console.log( color( '\n  Usage: api-spector agents init <name>\n', C.gray ) );
}

function printHelp (): void {
  console.log( `
  ${color( 'api-spector agents', C.bold )} — manage AI agent configurations

  ${color( 'Commands:', C.bold )}
    agents init <name>    Scaffold agent instruction files in the current directory
    agents list           Show available agents
    agents --help         Show this message

  ${color( 'Examples:', C.bold )}
    api-spector agents init claude     Set up Claude Code skills
    api-spector agents init copilot    Set up GitHub Copilot instructions
    api-spector agents init all        Set up all agents at once

  ${color( 'What this does:', C.gray )}
    Copies AI instruction files into your project so your LLM coding tool
    understands the API Spector scripting API and can generate functional
    and security test plans.
`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main (): Promise<void> {
  const args = process.argv.slice( 2 );
  const subCmd = args[0];

  if ( !subCmd || subCmd === '--help' || subCmd === '-h' ) {
    printHelp();
    process.exit( 0 );
  }

  if ( subCmd === 'list' ) {
    listAgents();
    process.exit( 0 );
  }

  if ( subCmd === 'init' ) {
    const agentName = args[1]?.toLowerCase();
    if ( !agentName ) {
      console.error( color( '  Missing agent name. Use: api-spector agents init <name>', C.red ) );
      console.error( `  Available: ${Object.keys( AGENTS ).join( ', ' )}, all` );
      process.exit( 1 );
    }
    await initAgent( agentName, process.cwd() );
    process.exit( 0 );
  }

  console.error( color( `  Unknown sub-command: "${subCmd}"`, C.red ) );
  printHelp();
  process.exit( 1 );
}

main().catch( err => {
  console.error( color( `  Error: ${err.message}`, C.red ) );
  process.exit( 2 );
} );
