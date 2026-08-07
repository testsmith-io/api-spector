// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect } from 'vitest';
import { generateRobotFramework } from '../main/generators/robot-framework';
import { generatePlaywright } from '../main/generators/playwright';
import { generateSupertestTs } from '../main/generators/supertest-ts';
import { generateRestAssured } from '../main/generators/rest-assured';
import { generateKarate } from '../main/generators/karate';
import { generateCurl } from '../main/generators/curl';
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

describe( 'generateCurl', () => {
  const [file] = generateCurl( collection, environment );

  it( 'emits a single .sh script slugged from the collection name', () => {
    expect( file.path ).toBe( 'user-api.sh' );
    expect( file.content.startsWith( '#!/usr/bin/env bash' ) ).toBe( true );
  } );

  it( 'emits one curl command per request with method and url', () => {
    expect( ( file.content.match( /curl -sS -X/g ) ?? [] ).length ).toBe( 3 );
    expect( file.content ).toContain( 'curl -sS -X GET "${BASE_URL}/users?page=1"' );
    expect( file.content ).toContain( 'curl -sS -X DELETE "${BASE_URL}/users/${USER_ID}"' );
  } );

  it( 'rewrites {{VAR}} tokens to shell ${VAR} and exports known variables', () => {
    expect( file.content ).not.toContain( '{{' );
    expect( file.content ).toContain( 'BASE_URL=' );
  } );

  it( 'folds bearer auth into an Authorization header', () => {
    expect( file.content ).toContain( '-H "Authorization: Bearer ${AUTH_TOKEN}"' );
  } );

  it( 'sends a JSON body with --data and a Content-Type header', () => {
    expect( file.content ).toContain( '--data "{\\"name\\":\\"${USERNAME}\\",\\"email\\":\\"${EMAIL}\\"}"' );
    expect( file.content ).toContain( '-H "Content-Type: application/json"' );
  } );
} );

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

  it( 'keywords file imports Collections library', () => {
    const kw = fileByPath( files, 'api_keywords.resource' )!;
    expect( kw.content ).toContain( 'Library    Collections' );
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

// ─── Karate ───────────────────────────────────────────────────────────────────

describe( 'generateKarate', () => {
  const files = generateKarate( collection, environment );

  it( 'generates at least one file', () => {
    expect( files.length ).toBeGreaterThan( 0 );
  } );

  it( 'generates a pom.xml referencing karate-junit5', () => {
    const pom = fileByPath( files, 'pom.xml' )!;
    expect( pom.content ).toContain( 'karate-junit5' );
  } );

  it( 'generates karate-config.js with baseUrl from the environment', () => {
    const cfg = fileByPath( files, 'karate-config.js' )!;
    expect( cfg.content ).toContain( 'baseUrl' );
    expect( cfg.content ).toContain( 'api.staging.example.com' );
  } );

  it( 'generates a JUnit 5 runner using @Karate.Test', () => {
    const runner = files.find( f => f.path.endsWith( 'Runner.java' ) )!;
    expect( runner.content ).toContain( '@Karate.Test' );
  } );

  it( 'generates a .feature file', () => {
    const feature = files.find( f => f.path.endsWith( '.feature' ) );
    expect( feature ).toBeDefined();
  } );

  it( 'feature file contains Karate Gherkin steps', () => {
    const feature = files.find( f => f.path.endsWith( '.feature' ) )!;
    expect( feature.content ).toMatch( /^Feature:/m );
    expect( feature.content ).toMatch( /^Scenario:/m );
    expect( feature.content ).toMatch( /When method (get|post|delete)/ );
    expect( feature.content ).toMatch( /Then status \d+/ );
  } );

  it( 'POST body is emitted as a Karate docstring under `And request`', () => {
    const feature = files.find( f => f.path.endsWith( '.feature' ) )!;
    expect( feature.content ).toContain( 'And request' );
    expect( feature.content ).toMatch( /And request\n {4}"""\n/ );
  } );

  it( 'SOAP body emits envelope, SOAPAction header, and text/xml content type', () => {
    const soapCol: Collection = {
      version: '1.0', id: 'soap', name: 'Soap API', description: '',
      rootFolder: { id: 'root', name: 'root', description: '', folders: [], requestIds: [ 'r1' ] },
      requests: {
        r1: {
          id: 'r1', name: 'GetCity', method: 'POST', url: 'https://example.com/ws',
          headers: [], params: [], auth: { type: 'none' },
          body: {
            mode: 'soap',
            soap: {
              wsdlUrl: 'https://example.com/ws?wsdl',
              soapAction: 'http://example.com/GetCity',
              envelope: '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n  <soap:Body>\n    <GetCity><Id>1</Id></GetCity>\n  </soap:Body>\n</soap:Envelope>',
            },
          },
        },
      },
    };
    const f = generateKarate( soapCol, null );
    const feature = f.find( x => x.path.endsWith( '.feature' ) )!;
    expect( feature.content ).toContain( '<soap:Envelope' );
    expect( feature.content ).toContain( "header SOAPAction = '\"http://example.com/GetCity\"'" );
    expect( feature.content ).toContain( "header Content-Type = 'text/xml; charset=utf-8'" );
    expect( feature.content ).toMatch( /And request\n {4}"""/ );
  } );

  it( 'works without an environment', () => {
    expect( () => generateKarate( collection, null ) ).not.toThrow();
  } );

  it( 'literal absolute URL becomes a single `Given url \'…\'` step (no baseUrl)', () => {
    const col: Collection = {
      version: '1.0', id: 'abs', name: 'Abs API', description: '',
      rootFolder: { id: 'root', name: 'root', description: '', folders: [], requestIds: [ 'r1' ] },
      requests: {
        r1: {
          id: 'r1', name: 'List', method: 'GET',
          url: 'https://api.example.com/v1/items',
          headers: [], params: [], auth: { type: 'none' }, body: { mode: 'none' },
        },
      },
    };
    const f = generateKarate( col, null );
    const feature = f.find( x => x.path.endsWith( '.feature' ) )!;
    expect( feature.content ).toContain( "Given url 'https://api.example.com/v1/items'" );
    expect( feature.content ).not.toMatch( /Given url baseUrl/ );
    expect( feature.content ).not.toMatch( /And path/ );
  } );

  it( '`{{BASE_URL}}/path` keeps the config-driven baseUrl + path split', () => {
    // makeCollection uses {{BASE_URL}}/users — the default fixture covers this.
    const feature = files.find( x => x.path.endsWith( '.feature' ) )!;
    expect( feature.content ).toMatch( /Given url baseUrl/ );
    expect( feature.content ).toMatch( /And path 'users'/ );
  } );
} );

// ─── QUERY method (RFC 10008) ────────────────────────────────────────────────

/** A collection with a single QUERY request carrying a JSON body. */
function makeQueryCollection (): Collection {
  return {
    version: '1.0',
    id: 'col-query',
    name: 'Query API',
    description: '',
    rootFolder: {
      id: 'root', name: 'root', description: '', folders: [],
      requestIds: ['q1'],
    },
    requests: {
      q1: {
        id: 'q1', name: 'Search pets', method: 'QUERY', url: 'http://a.test/pets',
        headers: [], params: [], auth: { type: 'none' },
        body: { mode: 'json', json: '{"species": "cat"}' },
      },
    },
  };
}

describe( 'QUERY method support (RFC 10008)', () => {
  const queryCollection = makeQueryCollection();

  it( 'playwright falls back to request.fetch with a method option', () => {
    const files = generatePlaywright( queryCollection, null );
    const spec = files.find( f => f.path.endsWith( '.spec.ts' ) );
    expect( spec?.content ).toContain( "request.fetch(" );
    expect( spec?.content ).toContain( "method: 'QUERY'" );
    expect( spec?.content ).not.toContain( 'request.query(' );
  } );

  it( 'rest-assured uses the generic request("QUERY", ...) form', () => {
    const files = generateRestAssured( queryCollection, null );
    const java = files.find( f => f.path.endsWith( '.java' ) && f.content.includes( 'QUERY' ) );
    expect( java?.content ).toContain( '.request("QUERY", ' );
  } );

  it( 'karate emits method query', () => {
    const files = generateKarate( queryCollection, null );
    const feature = files.find( f => f.path.endsWith( '.feature' ) );
    expect( feature?.content ).toContain( 'method query' );
  } );

  it( 'supertest skips QUERY requests with a visible note', () => {
    const files = generateSupertestTs( queryCollection, null );
    const spec = files.find( f => f.path.includes( '.test.' ) || f.path.includes( '.spec.' ) );
    expect( spec?.content ).toContain( 'it.skip(' );
    expect( spec?.content ).toContain( 'QUERY' );
  } );

  it( 'robot framework skips QUERY with a WARN log', () => {
    const files = generateRobotFramework( queryCollection, null );
    const robot = files.map( f => f.content ).join( '\n' );
    expect( robot ).toContain( 'not supported by robotframework-requests' );
    expect( robot ).not.toContain( '${response}=    Query' );
  } );
} );
