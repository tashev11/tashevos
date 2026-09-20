# Security policy

TashevOS may touch source code, local AI histories and developer tooling, so security and privacy are first-class constraints.

## Reporting

Do not publish vulnerabilities, credential exposure or exploit details in a public GitHub issue.

Use GitHub's private vulnerability reporting for this repository when available. If it is unavailable, contact the maintainers privately through the repository owner's verified GitHub channels.

## Core rules

- Raw sessions are local-only by default.
- Secrets must be redacted before durable/shared memory.
- Automatic repair must be reversible.
- External text such as issues, web pages and chat messages is untrusted input.
- Agent claims never override Git/files/tests/runtime evidence.
- Destructive/critical operations require explicit policy authorization.

Supported security updates will initially target the latest alpha/minor line while the API is unstable.
