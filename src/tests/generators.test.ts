import { describe, it, expect } from 'vitest';
import { generateRobotFramework } from '../main/generators/robot-framework';
import { generatePlaywright } from '../main/generators/playwright';
import { generateSupertestTs } from '../main/generators/supertest-ts';
import { generateRestAssured } from '../main/generators/rest-assured';
import { makeCollection, makeEnvironment } from './fixtures/collection';
import type { Collection } from '../shared/types';

const collection = makeCollection();
const environment = makeEnvironment();

/** A collection with three duplicate-named requests to test name uniquification. */
function makeDuplicateCollection (): Collection {
  return {
    version: '1.0',
    id: 'col-dup',
    name: 'Dup API',
    description: '',
    rootFolder: {
      id: 'root', name: 'root', description: '', folders: [],
      requestIds: ['r1', 'r2', 'r3'],
    },
    requests: {
      r1: { id: 'r1', name: 'New Request', method: 'GET', url: 'http://a.test/1', headers: [], params: [], auth: { type: 'none' }, body: { mode: 'none' } },
      r2: { id: 'r2', name: 'New Request', method: 'POST', url: 'http://a.test/2', headers: [], params: [], auth: { type: 'none' }, body: { mode: 'none' } },
      r3: { id: 'r3', name: 'New Request', method: 'DELETE', url: 'http://a.test/3', headers: [], params: [], auth: { type: 'none' }, body: { mode: 'none' } },
    },
  };
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function fileByPath ( files: { path: string; content: string }[], pathFragment: string ) {
  return files.find( f => f.path.includes( pathFragment ) );
}

// ─── Robot Framework ─────────────────────────────────────────────────────────

describe( 'generateRobotFramework', () => {
  const files = generateRobotFramework( collection, environment );

  it( 'generates exactly 5 files (README + requirements.txt + 3 content files)', () => {
    expect( files ).toHaveLength( 5 );
  } );

  it( 'generates a variables file', () => {
    expect( fileByPath( files, 'variables.resource' ) ).toBeDefined();
  } );

  it( 'generates a keywords resource file', () => {
    expect( fileByPath( files, 'api_keywords.resource' ) ).toBeDefined();
  } );

  it( 'generates a test suite file named after the collection', () => {
    expect( fileByPath( files, 'test_user_api.robot' ) ).toBeDefined();
  } );

  it( 'variables file contains environment variable', () => {
    const content = fileByPath( files, 'variables.resource' )?.content ?? '';
    expect( content ).toContain( 'BASE_URL' );
    expect( content ).toContain( 'https://api.staging.example.com' );
  } );

  it( 'variables file marks secret as OS env var (not hardcoded)', () => {
    const content = fileByPath( files, 'variables.resource' )?.content ?? '';
    expect( content ).toContain( '%{API_KEY}' );
  } );

  it( 'keywords file contains a keyword for each request', () => {
    const content = fileByPath( files, 'api_keywords.resource' )?.content ?? '';
    expect( content ).toContain( 'Get Users' );
    expect( content ).toContain( 'Create User' );
    expect( content ).toContain( 'Delete User' );
  } );

  it( 'test suite file contains test cases', () => {
    const content = fileByPath( files, 'test_user_api.robot' )?.content ?? '';
    expect( content ).toContain( '*** Test Cases ***' );
    expect( content ).toContain( 'Get Users' );
  } );

  it( 'works without an environment', () => {
    const noEnvFiles = generateRobotFramework( collection, null );
    const content = fileByPath( noEnvFiles, 'variables.resource' )?.content ?? '';
    expect( content ).toContain( '*** Variables ***' );
  } );

  it( 'keywords file uses VAR syntax for dicts (not Create Dictionary)', () => {
    const content = fileByPath( files, 'api_keywords.resource' )?.content ?? '';
    expect( content ).toContain( 'VAR    &{' );
    expect( content ).not.toContain( 'Create Dictionary' );
  } );

  it( 'keywords file does not import Collections library', () => {
    const kw = fileByPath( files, 'api_keywords.resource' )!;
    expect( kw.content ).not.toContain( 'Library    Collections' );
  } );

  it( 'keywords file uses VAR syntax for body variable as a dictionary', () => {
    const kw = fileByPath( files, 'api_keywords.resource' )!;
    expect( kw.content ).toContain( 'VAR    &{body}' );
    expect( kw.content ).not.toContain( 'Set Variable' );
    expect( kw.content ).not.toContain( 'Create Dictionary' );
  } );

  it( 'keywords file skips empty header/param dicts for requests with no headers or params', () => {
    const kw = fileByPath( files, 'api_keywords.resource' )!;
    // Split into per-keyword sections; Delete User has no headers/params/body
    const deleteSection = kw.content.split( '\n' )
      .slice( kw.content.split( '\n' ).findIndex( l => l.startsWith( 'Delete User' ) ) )
      .slice( 0, 10 )
      .join( '\n' );
    expect( deleteSection ).not.toContain( '&{headers}' );
    expect( deleteSection ).not.toContain( '&{params}' );
  } );

  it( 'deduplicated names: three requests named "New Request" get unique keywords', () => {
    const dupFiles = generateRobotFramework( makeDuplicateCollection(), null );
    const kw = fileByPath( dupFiles, 'api_keywords.resource' )!;
    expect( kw.content ).toContain( 'New Request\n' );
    expect( kw.content ).toContain( 'New Request 2\n' );
    expect( kw.content ).toContain( 'New Request 3\n' );
  } );

  it( 'test suite uses same deduplicated names as keywords file', () => {
    const dupFiles = generateRobotFramework( makeDuplicateCollection(), null );
    const suite = fileByPath( dupFiles, 'test_dup_api.robot' )!;
    expect( suite.content ).toContain( 'New Request\n' );
    expect( suite.content ).toContain( 'New Request 2\n' );
    expect( suite.content ).toContain( 'New Request 3\n' );
  } );
} );

// ─── Playwright ───────────────────────────────────────────────────────────────

describe( 'generatePlaywright', () => {
  const files = generatePlaywright( collection, environment );

  it( 'generates at least one file', () => {
    expect( files.length ).toBeGreaterThan( 0 );
  } );

  it( 'all files have non-empty content', () => {
    for ( const f of files ) {
      expect( f.content.length ).toBeGreaterThan( 0 );
    }
  } );

  it( 'generates a spec file', () => {
    const spec = files.find( f => f.path.endsWith( '.spec.ts' ) || f.path.includes( 'spec' ) );
    expect( spec ).toBeDefined();
  } );

  it( 'spec file references request names', () => {
    const spec = files.find( f => f.path.endsWith( '.spec.ts' ) || f.path.includes( 'spec' ) );
    expect( spec?.content ).toMatch( /Get Users|Create User|Delete User/ );
  } );

  it( 'works without an environment', () => {
    expect( () => generatePlaywright( collection, null ) ).not.toThrow();
  } );
} );

// ─── Supertest TS ─────────────────────────────────────────────────────────────

describe( 'generateSupertestTs', () => {
  const files = generateSupertestTs( collection, environment );

  it( 'generates at least one file', () => {
    expect( files.length ).toBeGreaterThan( 0 );
  } );

  it( 'generates a jest config file', () => {
    expect( fileByPath( files, 'jest.config' ) ).toBeDefined();
  } );

  it( 'generates an api-client helper', () => {
    expect( fileByPath( files, 'api-client' ) ).toBeDefined();
  } );

  it( 'api-client contains the base URL', () => {
    const client = fileByPath( files, 'api-client' )!;
    expect( client.content ).toContain( 'api.staging.example.com' );
  } );

  it( 'generates a test file', () => {
    const testFile = files.find( f => f.path.endsWith( '.test.ts' ) );
    expect( testFile ).toBeDefined();
  } );

  it( 'test file contains describe block', () => {
    const testFile = files.find( f => f.path.endsWith( '.test.ts' ) );
    expect( testFile?.content ).toContain( 'describe(' );
  } );

  it( 'test file contains HTTP method calls', () => {
    const testFile = files.find( f => f.path.endsWith( '.test.ts' ) );
    expect( testFile?.content ).toMatch( /\.get\(|\.post\(|\.delete\(/ );
  } );

  it( 'works without an environment', () => {
    expect( () => generateSupertestTs( collection, null ) ).not.toThrow();
  } );
} );

// ─── REST Assured ─────────────────────────────────────────────────────────────

describe( 'generateRestAssured', () => {
  const files = generateRestAssured( collection, environment );

  it( 'generates at least one file', () => {
    expect( files.length ).toBeGreaterThan( 0 );
  } );

  it( 'generates a pom.xml', () => {
    expect( fileByPath( files, 'pom.xml' ) ).toBeDefined();
  } );

  it( 'pom.xml contains REST Assured dependency', () => {
    const pom = fileByPath( files, 'pom.xml' )!;
    expect( pom.content ).toContain( 'rest-assured' );
  } );

  it( 'generates a Java test class', () => {
    const javaFile = files.find( f => f.path.endsWith( '.java' ) );
    expect( javaFile ).toBeDefined();
  } );

  it( 'Java test class contains JUnit @Test annotations', () => {
    const javaFile = files.find( f => f.path.endsWith( '.java' ) && !f.path.includes( 'BaseTest' ) )!;
    expect( javaFile.content ).toContain( '@Test' );
  } );

  it( 'Java test class references HTTP methods', () => {
    const javaFile = files.find( f => f.path.endsWith( '.java' ) && !f.path.includes( 'BaseTest' ) )!;
    expect( javaFile.content ).toMatch( /\.get\(|\.post\(|\.delete\(/ );
  } );

  it( 'works without an environment', () => {
    expect( () => generateRestAssured( collection, null ) ).not.toThrow();
  } );
} );
