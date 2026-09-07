# Table view for array responses

When a response body contains an array, API Spector can show it as a **sortable
table** instead of raw text or a tree. It works for both JSON and XML.

## Opening it

On the **Body** tab, a **Table** toggle appears next to Tree / Raw **whenever the
response actually contains an array**. Click it to switch to the table.

## The path (starting point)

API Spector auto-detects the most likely array - the root if the body is an
array, otherwise the array under a data-ish key (`data`, `items`, `results`,
`rows`, ...). The detected location is shown in the **Path** box at the top.

To tabulate a different array, edit the path, for example:

```
data.items
data.orders
report.rows
```

Paths support dots and indexes (`data.pages[0].items`). Clear it (or click
**root**) to go back to the top.

## Sorting

Click a column header to sort by that column: first click ascending, second
descending, third back to the response's original order. Numeric columns sort
numerically; everything else sorts as text, with empty/null values last. Sorting
only changes the view - the row numbers on the left are the original positions.

## Nested arrays and objects

Columns are the union of the rows' keys. A cell that is itself an array shows its
length (e.g. `[3]`) and an object shows `{...}`; both are **clickable** - click to
drill into that nested value, and the Path updates so you can see and edit where
you are. This is how you tabulate a nested array: click into it, or type its path
directly.

If the path points at something that **isn't** an array - the deepest item is an
object, or a single value - it's shown as-is: an object as a key/value list (whose
nested arrays and objects are still clickable to drill further), a primitive as
its value. So drilling never dead-ends.

To go back up, use the **breadcrumb** at the top: **↑ up** returns one level,
**root** returns to the top, and every crumb (`root › data › items › [2]`) is
clickable to jump straight to that level.

## Notes

- Very large arrays render the first 1000 rows (with a note); refine the path or
  sort to find what you need.
- XML is converted to the same shape - repeated sibling elements become the rows.
