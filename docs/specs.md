# Task Spec Format

Task specs tell Toryo what to do in each cycle. They are markdown files with YAML frontmatter, stored in your specs directory (configured via `tasks` in `toryo.config.json`).

## File Location

By default, specs live in `./specs/` relative to your project root. Each `.md` file in that directory is parsed as a task spec. Files are sorted alphabetically, and cycles rotate through them in order.

```
specs/
  01-write-tests.md
  02-code-review.md
  03-improve-performance.md
```

Alternatively, you can define tasks inline in `toryo.config.json` by setting `tasks` to an array of `TaskSpec` objects instead of a directory path.

## Basic Structure

A spec file has two parts: YAML frontmatter and a markdown body.

```markdown
---
name: Write Unit Tests
difficulty: 0.5
tags: [testing, code-quality]
phases:
  plan: auto
  research: auto
  execute: auto
  review: auto
acceptance_criteria:
  - Tests cover at least one previously untested module
  - All tests pass when run
---

Write comprehensive unit tests for uncovered code in the project.

Focus on:
- Functions with complex logic or branching
- Edge cases and error handling
- Integration points between modules
```

## YAML Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | No | Human-readable task name. Defaults to the filename with hyphens replaced by spaces. |
| `difficulty` | `number` | No | Difficulty estimate from 0.0 to 1.0. Used by the delegation system as the task's complexity score. Defaults to 0.5. |
| `tags` | `string[]` | No | Tags for filtering and grouping tasks. Currently informational. |
| `phases` | `Record<string, string>` | No | Maps phase names to agent IDs. Use `auto` to let the delegation system choose. Defaults to all four phases set to `auto`. |
| `acceptance_criteria` | `string[]` | No | Explicit list of acceptance criteria. If omitted, criteria are parsed from the markdown body (see below). |

## Markdown Body

The body after the frontmatter delimiter (`---`) is the task description. This is the text sent to agents as their primary prompt. Write it as you would a work item or ticket -- clear, specific, and actionable.

The body supports full markdown: headings, lists, code blocks, links, etc.

## Phase Assignments

The `phases` field controls which agent handles each phase of the cycle. There are three options for each phase:

### Auto (Delegation Decides)

```yaml
phases:
  plan: auto
  research: auto
  execute: auto
  review: auto
```

The delegation system selects the best agent based on the task profile and each agent's strengths and trust score. This is the recommended default.

### Specific Agent

```yaml
phases:
  plan: researcher
  research: researcher
  execute: coder
  review: reviewer
```

Pin a specific phase to a specific agent by using the agent's ID from your `toryo.config.json`.

### Partial Override

You can mix auto and specific assignments:

```yaml
phases:
  plan: auto
  research: auto
  execute: coder
  review: reviewer
```

### Omitting Phases

If your spec only needs certain phases, list only those:

```yaml
phases:
  research: auto
  review: auto
```

This works in combination with the top-level `phases` config. The orchestrator runs whichever phases are configured at the top level, and uses the spec's phase assignments to pick agents.

### Default Phases

If `phases` is omitted entirely from the frontmatter, all four built-in phases are assigned to `auto`:

```yaml
# Equivalent to omitting phases entirely:
phases:
  plan: auto
  research: auto
  execute: auto
  review: auto
```

## Acceptance Criteria

Acceptance criteria are used in two places:

1. **Appended to the agent prompt** for every non-review phase, so the agent knows what "done" looks like.
2. **Included in the review prompt** so the QA agent can score against them.

### From Frontmatter

The most explicit way to define criteria:

```yaml
acceptance_criteria:
  - Tests cover at least one previously untested module
  - All tests pass when run
  - Edge cases are covered (null, empty, boundary values)
```

### From Markdown Checkboxes

If `acceptance_criteria` is not in the frontmatter, the spec parser scans the markdown body for a section headed "Acceptance Criteria" (or "Criteria" or "Done When") and extracts bullet points:

```markdown
## Acceptance Criteria
- [ ] Tests cover at least one previously untested module
- [ ] All tests pass when run
- [ ] Edge cases are covered
```

Both `- [ ]` checkbox syntax and plain `- ` bullet syntax are supported. The parser stops at the next heading.

### No Criteria

If neither source is found, the spec gets an empty `acceptanceCriteria` array. The agent still receives the task description, but the review phase has no explicit criteria to score against.

## Task ID

The task ID is derived from the filename (without the `.md` extension). For example, `01-write-tests.md` becomes task ID `01-write-tests`. This ID appears in:

- CLI output and dashboard
- `results.tsv` entries
- Git commit messages (`toryo cycle-N: 01-write-tests`)
- Extraction file paths

## Example Specs

### Test Writing

```markdown
---
name: Write Unit Tests
difficulty: 0.5
tags: [testing, code-quality]
phases:
  plan: auto
  research: auto
  execute: auto
  review: auto
---

Write comprehensive unit tests for uncovered code in the project.

Focus on:
- Functions with complex logic or branching
- Edge cases and error handling
- Integration points between modules

## Acceptance Criteria
- [ ] Tests cover at least one previously untested module
- [ ] All tests pass when run
- [ ] Edge cases are covered (null, empty, boundary values)
- [ ] Test names clearly describe what they verify
```

### Code Review (No Execute Phase)

```markdown
---
name: Code Review
difficulty: 0.4
tags: [review, quality]
phases:
  research: auto
  review: auto
---

Review recent code changes for quality issues, bugs, and improvement opportunities.

Focus on:
- Logic errors and edge cases
- Security vulnerabilities
- Performance anti-patterns
- Code style and readability

## Acceptance Criteria
- [ ] At least 3 specific, actionable findings identified
- [ ] Each finding includes file, line, and suggested fix
- [ ] Severity is rated (critical, warning, info)
- [ ] No false positives or vague recommendations
```

### Security Audit (High Difficulty)

```markdown
---
name: Security Audit
difficulty: 0.8
tags: [security, audit]
phases:
  research: auto
  execute: auto
  review: auto
---

Conduct a security audit of the codebase focusing on common vulnerability patterns.

Check for:
- Command injection (shell, SQL, etc.)
- Path traversal and file access
- Authentication and authorization gaps
- Secrets/credentials in code or config
- Dependency vulnerabilities
- Input validation gaps at system boundaries

## Acceptance Criteria
- [ ] At least 5 security areas checked
- [ ] Each finding rated by severity and exploitability
- [ ] Remediation steps provided for critical/high findings
- [ ] No false positives
```

### Performance Optimization (All Phases, Pinned Agents)

```markdown
---
name: Performance Optimization
difficulty: 0.7
tags: [performance, optimization]
phases:
  plan: researcher
  research: researcher
  execute: coder
  review: reviewer
---

Identify and fix performance bottlenecks in the codebase.

Approach:
1. Profile or analyze the codebase for slow paths
2. Identify the top 1-2 bottlenecks
3. Implement optimizations with measurable improvements
4. Verify no regressions introduced

## Acceptance Criteria
- [ ] At least one measurable performance improvement
- [ ] Before/after metrics documented
- [ ] No functionality regressions
- [ ] Optimization is explained with reasoning
```

### Inline Task Specs

Instead of a specs directory, you can define tasks directly in `toryo.config.json`:

```json
{
  "tasks": [
    {
      "id": "write-tests",
      "name": "Write Unit Tests",
      "description": "Write comprehensive unit tests for uncovered modules.",
      "acceptanceCriteria": [
        "Tests cover at least one untested module",
        "All tests pass"
      ],
      "phases": [
        { "phase": "plan", "agent": "auto" },
        { "phase": "execute", "agent": "coder" },
        { "phase": "review", "agent": "reviewer" }
      ],
      "difficulty": 0.5,
      "tags": ["testing"]
    }
  ]
}
```

Note the structural difference: inline specs use `phases` as an array of `{ phase, agent }` objects, while markdown specs use a flat `phase: agent` map in the YAML frontmatter.
