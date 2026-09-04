# gRPC

API Spector can call gRPC services defined by a `.proto` file. Switch a request to
**gRPC** with the protocol toggle next to the URL bar (HTTP / WS / SOAP / gRPC).

## Setup

1. **Target** — put the server address in the URL field as `host:port`
   (e.g. `localhost:50051`). No scheme is needed.
2. **Proto** — paste your `.proto` source into the proto box, or give a path to a
   `.proto` file on disk, then click **Load proto**. The services and methods it
   declares populate the two dropdowns.
3. **Service / Method** — pick the service and the method to call. Server-streaming
   methods are marked `(stream)`.
4. **Plaintext** — leave unchecked for TLS (the default). Check it for a local
   server running without TLS (h2c).

## Making a call

- **Request message** — enter the request as JSON. Fields map to the proto message
  by name, and `{{variables}}` are interpolated like anywhere else.
- **Metadata** — add call metadata (gRPC's headers) as `key: value`, one per line.
  Values support `{{variables}}`, so `authorization: Bearer {{TOKEN}}` works.
- Click **Invoke**. Responses appear in the log below: the request you sent, each
  message received, and the final status (with its gRPC status code). For a
  server-streaming method, messages stream in until the server ends the call; use
  **Cancel** to stop early.

## What is supported

- **Unary** calls (one request, one response).
- **Server streaming** (one request, a stream of responses).
- Proto loading from **pasted source** or a **file path**, including `import`s
  resolved against the file's directory.
- **TLS** and **plaintext**, per-call **metadata**, and **Cancel**.

## Not yet supported

- **Client-streaming** and **bidirectional** streaming.
- **Server reflection** (load the schema from the server without a `.proto`).
- gRPC in the CLI runner, code generation, and a proto importer.

These are on the roadmap. If you need one, let us know so we can prioritise it.
