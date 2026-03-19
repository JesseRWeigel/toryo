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
