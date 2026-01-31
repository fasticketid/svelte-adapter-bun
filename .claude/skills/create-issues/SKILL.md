---
name: create-issues
description: Create GitHub issues from commit history, grouped by logical feature/fix, with ai-author label
---

# Create GitHub Issues from Commit History

Generate GitHub issues from the commit history on the current branch. Commits are grouped into logical features/fixes, and each issue is labeled with `ai-author` plus appropriate category labels.

## When to Use

Run this after a batch of work is done and you want to document what was built as GitHub issues — for tracking, changelog, or project visibility.

## Steps

### 1. Gather Commits

Get the commit log for the current branch. If a base branch or range is specified by the user, use that. Otherwise, use all commits on the current branch:

```bash
git log --oneline --no-merges
```

### 2. Group Commits into Logical Issues

Analyze commit messages and group them by logical feature or fix. Rules:

- **One issue per logical change** — don't create an issue per commit. Multiple commits that serve the same feature/fix get grouped together.
- **Bug fixes** get the `bug` label. Everything else gets `enhancement`.
- **All issues** get the `ai-author` label.
- Use judgment: a "fix" commit that's part of a feature rollout belongs with the feature, not as a separate bug issue.

### 3. Ensure `ai-author` Label Exists

```bash
gh label create ai-author --description "Issue created by AI" --color 7057ff 2>&1 || true
```

The `|| true` prevents failure if the label already exists.

### 4. Create Issues

For each logical group, create an issue with this format:

```bash
gh issue create --title "<concise title>" --label "<labels>" --body "$(cat <<'EOF'
## Problem

<What problem or gap this addresses — 1-3 sentences>

## Solution

<What was done to solve it — bullet points or short paragraphs>

## Commits

- `<short-hash>` — <commit message>
- `<short-hash>` — <commit message>
EOF
)"
```

**Title rules:**
- Imperative mood ("Add X", "Fix Y", not "Added X" or "Fixes Y")
- Concise — under 80 chars
- Describes the outcome, not the process

**Label rules:**
- Always include `ai-author`
- Add `bug` for fixes, `enhancement` for features/improvements
- Don't invent other labels unless they already exist on the repo

### 5. Report Results

After creating all issues, list them:

```bash
gh issue list --label ai-author
```

Output the URLs of all created issues so the user can review them.

## Options

The user may specify:
- **Commit range** — e.g., "from commit X to Y" or "last 10 commits"
- **Base branch** — to diff against (e.g., `main..feature-branch`)
- **Extra labels** — additional labels beyond `ai-author` + `bug`/`enhancement`
- **Dry run** — show what would be created without actually creating issues

If not specified, default to all commits on the current branch.
