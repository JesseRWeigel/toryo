---
name: Code Refactoring
difficulty: 0.6
tags: [refactor, maintainability]
phases:
  plan: auto
  execute: auto
  review: auto
---

Refactor code to improve maintainability, reduce duplication, and simplify complexity.

Focus on:
- Functions longer than 50 lines
- Duplicated logic that could be abstracted
- Complex conditionals that could be simplified
- Dead code removal

## Acceptance Criteria
- [ ] At least one refactoring improves code clarity
- [ ] All existing tests still pass
- [ ] No behavior changes (pure refactor)
- [ ] Reduced cyclomatic complexity or line count
