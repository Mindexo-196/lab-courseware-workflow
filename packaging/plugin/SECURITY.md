# Security

- Treat imported HTML as untrusted and keep existing source files read-only.
- Do not place credentials, tokens, or private keys in `live.json`, `memory.json`,
  previews, examples, or the Skill package.
- Browser checks should bind to loopback only and terminate the temporary browser process.
- Review scripts before running them outside the workspace.
- An interactive HTML deck can execute local JavaScript. Open only trusted generated
  courseware and do not inject unreviewed remote scripts.
- Report security issues privately to the package owner instead of opening a public issue
  containing sensitive reproduction data.
