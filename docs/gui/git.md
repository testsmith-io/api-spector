# Git Integration

The **Git** panel lets you stage, commit, push, pull, and manage branches without leaving the app. It works on the workspace directory — the same folder that holds your collections, environments, and mock servers.

## Open the Git panel

Click the **Git** tab in the left sidebar (branch icon). If the workspace is not yet a git repository, the panel offers an **Initialize repository** button.

---

## Changes tab

Shows the current working-tree state, grouped into three sections.

### Conflicts

When a merge or pull produces conflicts, a red banner appears at the top:

> ⚠ 3 merge conflicts — resolve below before committing

Conflicted files are listed in a **Conflicts** section with three resolution buttons that appear on hover:

| Button | Action |
|---|---|
| **Ours** | Accepts the current branch version (`git checkout --ours`) and stages the file |
| **Theirs** | Accepts the incoming version (`git checkout --theirs`) and stages the file |
| **✓** | Marks the file as resolved after you have manually edited it (`git add`) |

After resolving all conflicts the files move into the **Staged** section, ready to commit.

### Viewing conflict markers

Click any conflicted file to open the diff viewer. Conflict markers are highlighted:

- `<<<<<<<` — red, marks the start of your changes
- `=======` — amber, separates the two versions
- `>>>>>>>` — blue, marks the end of the incoming changes

### Staged / Changes

- **Staged** — files added to the index. Click a file to diff it. Hover to unstage individual files or use **Unstage all**.
- **Changes** — modified, deleted, and untracked files. Click to diff, hover to stage individual files or use **Stage all**.

### Commit

Type a commit message and click **Commit**, or press **⌘↵** / **Ctrl↵**. The commit button is disabled until at least one file is staged and the message is non-empty.

---

## Sync (push / pull)

The branch bar at the top shows:

| Button | Meaning |
|---|---|
| **↓** (amber) | Commits available to pull |
| **↑** (blue) | Local commits not yet pushed |

A banner below the branch bar shows the exact count and a quick-action button. If no upstream branch is set yet, **Push** automatically sets `origin/<branch>` as the upstream.

---

## Log tab

Shows the last 100 commits with hash, message, author, and date.

---

## Branches tab

- Create a new local branch and switch to it
- Switch between existing local and remote branches
- Add, edit, or remove remotes

---

## CI/CD tab

Generates ready-to-paste pipeline configuration for GitHub Actions, GitLab CI, or Azure Pipelines that runs your collection with the CLI and uploads the HTML report as an artifact.

See [Pipeline Integration](../cli/cicd.md) for full details.
