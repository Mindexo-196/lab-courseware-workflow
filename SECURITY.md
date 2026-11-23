# Security

## Reporting

Do not open a public issue containing credentials, private course material, or a
sensitive reproduction package. Use the repository's private security-advisory
feature when available.

## Handling Imported Content

- Treat imported HTML as untrusted.
- Keep existing source HTML read-only and work on a copied file.
- Do not place credentials or private keys in task state, examples, previews, or
  generated courseware.
- Browser checks should bind to loopback only and terminate temporary browser
  processes.
- Review JavaScript and external resources before using generated courseware in a
  trusted environment.
- Do not inject unreviewed remote scripts into a generated deck.
