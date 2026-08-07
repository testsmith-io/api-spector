# Data-Driven Runs

Run a whole collection (or a folder) once per row of a data table. Each row supplies a set of variables, so the same requests execute repeatedly with different inputs: three login payloads, ten product IDs, a spreadsheet of test cases.

## Where to define a dataset

A dataset can live on a **collection** or on a **folder**:

- **Collection**: right-click the collection (or click its name) and open the **Data** tab. Running the collection iterates over these rows.
- **Folder**: open the folder's settings and use its **Data** tab. Running that folder iterates over the folder's rows. A folder's own dataset takes priority over the collection's for a folder run; a folder with no dataset falls back to the collection's.

The editor is identical in both places.

## The data table

Select the **Data** tab (on a collection or a folder).

- **Columns** are variable names. Add a column for each variable you want to vary (for example `username`, `password`, `expectedStatus`).
- **Rows** are iterations. Each row holds one value per column.

A dataset with 3 rows runs the collection 3 times: once with the first row's values, once with the second, once with the third.

You can also **Import CSV** or **Export CSV**. The first CSV line is the column headers (the variable names); each following line is one iteration:

```csv
username,password,expectedStatus
ada,correct-horse,200
bob,wrong-password,401
,,400
```

Values are comma-separated. Wrap a value in double quotes if it contains a comma, quote, or newline, and double any embedded quote (`"he said ""hi"""`).

## Using the values

Reference a column anywhere you use variables, with `{{columnName}}`: the URL, query params, headers, the body, and pre/post-request scripts.

```
POST {{BASE_URL}}/login
Content-Type: application/json

{ "user": "{{username}}", "pass": "{{password}}" }
```

During a run, each row's values are injected as **local variables**, the highest-precedence scope. For that iteration they override a collection, folder, or environment variable of the same name (see [Variables & Scopes](../reference/variables.md)). Outside a data-driven run, `{{username}}` falls back to whatever other scope defines it, so single sends still work while you build the requests.

## Running

Open the runner (**Run** on a collection or folder). When the collection has dataset rows, the runner expands the run to one iteration per row and the results are labelled `#1/3`, `#2/3`, and so on. Every iteration runs the full request sequence, including any `before`/`after` hooks in scope.

Assertions in post-request scripts run on every iteration, so a single run tells you which rows passed and which failed. The `expectedStatus` column pattern above is a common way to assert different outcomes per row:

```js
sp.test('status matches row', () => {
  sp.expect(sp.response.status).toBe(Number(sp.variables.get('expectedStatus')));
});
```

## Notes

- The dataset lives on the collection or folder, so it is saved with the workspace and travels with it in Git.
- Data-driven expansion happens in the desktop runner. The `api-spector run` CLI executes the requests as defined; drive CLI iterations from your pipeline instead (for example a matrix build), or run the dataset from the app.
- Leave a cell empty to send an empty value for that variable in that iteration.
