// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

export interface Snippet {
  label: string
  code: string
}

export interface SnippetGroup {
  group: string
  items: Snippet[]
}

export const SNIPPET_GROUPS: SnippetGroup[] = [
  {
    group: 'Status / Response',
    items: [
      {
        label: 'Check status code',
        code: `sp.test("Status is 200", function() {\n  sp.expect(sp.response.code).to.equal(200);\n});`,
      },
      {
        label: 'Check response time < 500ms',
        code: `sp.test("Response time < 500ms", function() {\n  sp.expect(sp.response.responseTime).to.be.below(500);\n});`,
      },
      {
        label: 'Check Content-Type header',
        code: `sp.test("Content-Type is JSON", function() {\n  sp.expect(sp.response.headers.get("content-type")).to.include("application/json");\n});`,
      },
      {
        label: 'Check body contains string',
        code: `sp.test("Body contains string", function() {\n  sp.expect(sp.response.text()).to.include("expected_string");\n});`,
      },
      {
        label: 'Check body equals string',
        code: `sp.test("Body equals string", function() {\n  sp.expect(sp.response.text()).to.equal("expected_body");\n});`,
      },
      {
        label: 'Check JSON value',
        code: `sp.test("JSON field equals value", function() {\n  const json = sp.response.json();\n  sp.expect(json.field).to.equal("expected_value");\n});`,
      },
      {
        label: 'Validate JSON schema (tv4)',
        code: `sp.test("JSON matches schema", function() {\n  const schema = {\n    type: "object",\n    properties: {\n      id: { type: "number" },\n      name: { type: "string" }\n    },\n    required: ["id", "name"]\n  };\n  sp.expect(tv4.validate(sp.response.json(), schema)).to.be.true;\n});`,
      },
    ],
  },
  {
    group: 'Variables — Get',
    items: [
      {
        label: 'Get variable',
        code: `const value = sp.variables.get("variable_name");`,
      },
      {
        label: 'Get environment variable',
        code: `const value = sp.environment.get("variable_name");`,
      },
      {
        label: 'Get collection variable',
        code: `const value = sp.collectionVariables.get("variable_name");`,
      },
      {
        label: 'Get global variable',
        code: `const value = sp.globals.get("variable_name");`,
      },
    ],
  },
  {
    group: 'Variables — Set',
    items: [
      {
        label: 'Set variable',
        code: `sp.variables.set("variable_name", "value");`,
      },
      {
        label: 'Set environment variable',
        code: `sp.environment.set("variable_name", "value");`,
      },
      {
        label: 'Set collection variable',
        code: `sp.collectionVariables.set("variable_name", "value");`,
      },
      {
        label: 'Set global variable',
        code: `sp.globals.set("variable_name", "value");`,
      },
    ],
  },
  {
    group: 'Variables — Clear',
    items: [
      {
        label: 'Clear variable',
        code: `sp.variables.clear("variable_name");`,
      },
      {
        label: 'Clear environment variable',
        code: `sp.environment.clear("variable_name");`,
      },
      {
        label: 'Clear collection variable',
        code: `sp.collectionVariables.clear("variable_name");`,
      },
      {
        label: 'Clear global variable',
        code: `sp.globals.clear("variable_name");`,
      },
    ],
  },
  {
    group: 'Generate data (faker)',
    items: [
      {
        label: 'Random UUID',
        code: `sp.variables.set("uuid", faker.string.uuid());`,
      },
      {
        label: 'Random name',
        code: `sp.variables.set("name", faker.person.fullName());`,
      },
      {
        label: 'Random email',
        code: `sp.variables.set("email", faker.internet.email());`,
      },
      {
        label: 'Random number',
        code: `sp.variables.set("number", String(faker.number.int({ min: 1, max: 1000 })));`,
      },
    ],
  },
  {
    group: 'Date / time (dayjs)',
    items: [
      {
        label: 'Current timestamp (ISO)',
        code: `sp.variables.set("timestamp", dayjs().toISOString());`,
      },
      {
        label: 'Formatted date',
        code: `sp.variables.set("date", dayjs().format("YYYY-MM-DD"));`,
      },
      {
        label: 'Future date (+7 days)',
        code: `sp.variables.set("futureDate", dayjs().add(7, "day").toISOString());`,
      },
    ],
  },
  {
    group: 'Extract from response',
    items: [
      {
        label: 'Save JSON field to variable',
        code: `const json = sp.response.json();\nsp.variables.set("field_value", json.field);`,
      },
      {
        label: 'Save JSON field to environment',
        code: `const json = sp.response.json();\nsp.environment.set("token", json.token);`,
      },
      {
        label: 'Extract via JSONPath to variable',
        code: `const matches = sp.jsonPath(sp.response.json(), '$.data[0].id');\nsp.variables.set("extracted_value", String(matches[0] ?? ''));`,
      },
      {
        label: 'Extract via JSONPath to environment',
        code: `const matches = sp.jsonPath(sp.response.json(), '$.data[0].id');\nsp.environment.set("extracted_value", String(matches[0] ?? ''));`,
      },
      {
        label: 'Extract from XML to variable',
        code: `sp.variables.set("extracted_value", sp.response.xmlText("ElementName") ?? '');`,
      },
      {
        label: 'Extract from XML to environment',
        code: `sp.environment.set("extracted_value", sp.response.xmlText("ElementName") ?? '');`,
      },
    ],
  },
];
