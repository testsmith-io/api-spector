# Flows

Flows are visual graphs of API calls. A flow has a **Start**, one or more **End**s, and a chain of blocks in between — send a request, branch on its result, loop over a list, set variables, validate, display data. It's the same idea as Postman Flows, built on the same engine the request runner and CLI use, so a flow behaves identically whether you run it in the app, from the CLI, or in the cloud.

Open the **Flows** tab in the activity bar (left icon rail), then press **+** to create one.

## The canvas

- **Add block** — the toolbar's **+ Add block** menu lists every block type, grouped by category (Action / Logic / Looping / Visualize). Pick one to drop it on the canvas.
- **Connect blocks** — drag from a block's right-hand output port to another block's left input. Dragging a connection onto empty canvas pops a block picker and creates the block already wired up.
- **Pick a request** — a **Send Request** block has two dropdowns directly on it: choose the collection, then the request.
- **Inspector** — click a block to open the inspector on the right, where you edit its configuration (expressions, scripts, delay, loop settings, condition cases, display/log). It also has a **color** picker and **Duplicate** / **Delete** buttons.
- **Tidy** — auto-arranges the blocks left-to-right in clean, non-overlapping layers.
- **Extract to sub-flow** — select one or more blocks (shift-click, or shift-drag a box) and click **Extract to sub-flow (N)**: the selection becomes a new flow, and a single **Run Flow** block replaces it, rewired to the surrounding edges.

Everything autosaves to disk as plain JSON (`flows/<name>.flow.json`), so flows diff and commit like the rest of your workspace.

## Block reference

| Category | Block | What it does |
|---|---|---|
| **Action** | **Send Request** | Runs a saved request. Routes **success** (2xx/3xx, assertions passed) or **fail**. |
| | **Run Flow** | Runs another flow from this workspace (a sub-flow), sharing variables. |
| **Logic** | **If** | Evaluates a JS boolean; routes **true** / **false**. |
| | **Condition** | A switch: the first matching case wins, otherwise **else**. |
| | **Validate** | `sp.test(...)` assertions; routes **pass** / **fail**. |
| | **Evaluate** | Runs JS to compute values and set variables. |
| | **Set Variable** | Sets a named variable (in local / collection / environment / global scope) from a JS expression. |
| | **Delay** | Waits a number of milliseconds. |
| | **Or / Merge** | Continues as soon as any one incoming branch arrives. |
| **Looping** | **For Each** | Runs its **body** once per item of a list expression; then continues on **done**. |
| | **Repeat** | Runs its body a fixed number of times. |
| | **Collect** | Appends each iteration's value into a list variable (read it after the loop). |
| **Visualize** | **Display** | Shows a value (text / JSON / table) in the output. |
| | **Log** | Appends a message to the run log. |

Logic is written in the same `sp.*` JavaScript sandbox as request pre/post scripts. A few essentials:

- `sp.response.code` — the numeric HTTP status (note: `sp.response.status` is the string `"200 OK"`).
- `sp.response.json()` — the parsed response body.
- `sp.variables.get(...)` / `sp.variables.set(...)` — local variables; `sp.globals`, `sp.environment`, `sp.collectionVariables` for other scopes.
- `data.<name>` — the rich data channel (loop items, `Set Variable` outputs, collected lists).

## Variables and data

- **Flow inputs** — the **Start** block can declare input variables (name/value). They're seeded before the run, so a request can reference `{{email}}` etc.
- **Between steps** — variables set by a request's post-script, a **Set Variable**, or an **Evaluate** block carry forward to every later block (the same scope threading the collection runner uses). That's how you capture a token on login and send it as `Bearer {{token}}` later.
- **Loops** — **For Each** exposes the current item as its item variable (and index). **Collect** gathers values into a list you read after the loop.
- **I/O chips** — every block shows the variables it **reads** (`in`) and **writes** (`out`), and the inspector lists them, so a block's data contract is visible at a glance.

## Running a flow

Press **Run**. Pick an environment from the dropdown first if the flow needs one.

- **Live status** paints onto each block as it runs (running / passed / failed / error, with HTTP code and timing).
- **The taken route lights up** — traversed edges animate and are colored by outcome (green success / red fail); untaken branches dim.
- The bottom panel has three tabs:
  - **Run log** — a timestamped, chronological record of every block, log, and display, with an **Export log** button.
  - **Output** — the values from **Display** / **Log** blocks.
  - **Variables** — every variable's final value, plus the data channel.
- **Display** blocks also show their value inline on the block itself.

### Reports

**Export report** (bottom panel) writes a self-contained **HTML report** — summary stats, the run as expandable cards in execution order, display values, and a variables table — the same style as the collection runner's report.

## Running in the cloud

If your workspace has **Cloud** enabled (Settings → Cloud), the flow toolbar gains cloud actions:

- **☁ Push** — uploads the flow to API Spector Cloud as a self-contained definition (the graph plus the referenced requests and resolved environment/globals).
- **Run in cloud** — uploads, triggers a server-side run on a cloud runtime, and reports the result. The run uses the exact same engine, so results match local runs.
- **↗ Open in cloud** — opens the flow's page in the cloud UI, where the graph is rendered the same way (read-only) with run history.

The number of flows you can upload is limited by your plan (Free 3, Pro 25, Team unlimited); re-pushing an existing flow always works.

See also: [Running flows from the CLI](../cli/flows.md).
