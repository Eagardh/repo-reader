# Security policy

## Reporting a vulnerability

Please report security vulnerabilities through GitHub's private vulnerability
reporting feature for this repository. Do not open a public issue containing a
token, database URL, private repository content, or exploit details.

If you accidentally commit a credential to a fork, revoke and rotate it
immediately. Removing the file or commit is not sufficient because the value
may remain in Git history and caches.

## Deployment guidance

- Keep `.env.local` and provider credentials out of Git.
- Prefer read-only, least-privilege GitHub tokens.
- Keep the chat agent authenticated because its requests spend model credits.
- Add authentication or rate limiting to the MCP endpoint before offering it as
  a shared public service.
- Apply dependency and framework security updates promptly.
