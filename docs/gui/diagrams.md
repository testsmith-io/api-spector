# Diagrams (flowcharts)

Any description field — on a request, a folder, or a collection — can hold a flowchart. Write it as a fenced code block in the description and it renders as a diagram in the preview. Because it is just a fenced block, the diagram source stays readable everywhere the description is shown as plain text (a diff, an export, another tool), so nothing is ever lost.

## Adding a diagram

Put a `flow` fenced block anywhere in a description:

````text
This request is the first step of the login flow.

```flow
flowchart TD
  A([Start]) --> B[POST /login]
  B --> C{200 OK?}
  C -->|yes| D[Save token]
  C -->|no| E[Show error]
  D --> F([Done])
```
````

The block renders in the description preview; the surrounding text renders as normal markdown. You can also start one from the editor toolbar: **⬡** inserts a starter block, and **⬡ Diagram help** opens a quick syntax reference next to the field.

## Direction

The first line sets the flow direction:

| Line | Direction |
| ---- | --------- |
| `flowchart TD` | top → down (default) |
| `flowchart LR` | left → right |
| `flowchart RL` | right → left |
| `flowchart BT` | bottom → top |

`TB` is accepted as an alias for `TD`, and `graph` as an alias for `flowchart`. If no direction line is given, top-down is used.

## Nodes and shapes

A node is an **id** followed by an optional shape wrapper that carries its label. Ids are letters, digits, and underscores (`A`, `step1`, `check_auth`).

| You write | Shape | Typical use |
| --------- | ----- | ----------- |
| `A[Text]` | rectangle | a step / action |
| `A(Text)` | rounded rectangle | a step, softer |
| `A([Text])` | stadium | start / end |
| `A((Text))` | circle | a connector or state |
| `A{Text}` | diamond | a decision |
| `A{{Text}}` | hexagon | preparation / setup |
| `A[[Text]]` | subroutine | a reusable sub-step |

A bare id with no wrapper (`A`) becomes a rectangle labelled with the id. You only need to give a node its label once; later lines can refer to it by id:

```flow
flowchart TD
  A --> B
  B[Validate payload] --> C
```

Wrap a label in quotes if it contains a bracket: `A["array[0] lookup"]`.

## Connections

| You write | Meaning |
| --------- | ------- |
| `A --> B` | arrow |
| `A --- B` | line, no arrowhead |
| `A -.-> B` | dotted arrow |
| `A ==> B` | thick arrow |
| `A -->|label| B` | arrow with a label |

Chain several on one line — `A --> B --> C` — and branch by pointing an id at more than one target:

```flow
flowchart LR
  C{Payment OK?} -->|yes| D[Create order]
  C -->|no| E[Return 402]
```

## A fuller example

```flow
flowchart TD
  A([Start]) --> B[POST /cart/checkout]
  B --> C{Payment OK?}
  C -->|yes| D[Create order]
  C -->|no| E[Return 402]
  D --> F{Inventory reserved?}
  F -->|yes| G([Order confirmed])
  F -->|no| H[Roll back payment]
  H --> E
```

## What's supported

Flowcharts are drawn by API Spector's own renderer, kept deliberately small so they stay fast and work offline.

**Supported:** the directions, shapes, and connections above, edge labels, chained edges, and `%%` comments.

**Not supported (ignored or not rendered):**

- other diagram types — sequence, class, state, entity-relationship, gantt, pie, mindmap
- grouping blocks (`subgraph`)
- styling directives and clickable nodes
- HTML (such as `<br/>`) inside labels
- the `A -- text --> B` edge form — use `A -->|text| B` instead

**By design:**

- Lines the parser doesn't recognise are **skipped**, not treated as errors — so a half-written diagram still previews while you type.
- Layout is automatic (a simple layered layout); node positions can't be hand-placed.
- A cycle (for example `A --> B --> A`) renders fine; it won't break the layout.

If a feature you need is missing, ask — the renderer can be extended.

## Tips

- Keep labels short; long text wraps and widens the node.
- Use `([ ])` for the start and end, and `{ }` for decisions — it makes the flow read at a glance.
- Switch `TD` to `LR` when a flow has long labels; left-to-right often fits a sidebar better.
