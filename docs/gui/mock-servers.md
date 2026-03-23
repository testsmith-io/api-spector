# Mock Servers

Mock servers let you simulate API endpoints without a real backend. Define routes with fixed responses, status codes, and optional delays.

## Create a mock server

1. In the left sidebar, click the **Mocks** tab
2. Click **+ New Mock**
3. Enter a name and port number
4. Add routes

![](../assets/mock-server-editor.png)

## Configure routes

Each route has:

| Field | Description |
|---|---|
| Method | HTTP method or `ANY` to match all |
| Path | URL path, supports Express-style params like `/users/:id` |
| Status code | HTTP response status |
| Headers | Response headers as key/value pairs |
| Body | Response body (any text or JSON) |
| Delay | Optional delay in ms before responding |
| Description | Optional note |

## Start and stop

Toggle the **Start / Stop** button in the mock server panel. When running, the server listens on `http://127.0.0.1:<port>`.

![](../assets/mock-server-running.png)

A live log shows incoming requests with matched route, status code, and response time.

## Save a response as a mock route

After sending a real request, you can capture the response as a mock route directly from the **Response Viewer**:

1. Send a request and view the response
2. Click **↓ Mock** in the response panel toolbar
3. Choose an existing mock server or create a new one
4. Adjust the path, method, and status code
5. Click **Add route**

![](../assets/save-as-mock.png)

## Run from CLI

See [Mock Servers CLI](../cli/mock.md).

## Route matching

- Routes are evaluated in order; the first match wins
- `ANY` matches all HTTP methods
- Path parameters (`:id`) are matched positionally but the response is static (no interpolation)
- Unmatched requests return `404`
