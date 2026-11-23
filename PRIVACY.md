# Privacy

This project runs locally in the selected Agent workspace.

- The repository contains no telemetry, analytics, advertising, or remote logging.
- Course sources, task state, previews, and deliverables remain in the selected
  workspace.
- A host Agent or model provider may process content required to complete a user
  request. Follow that provider's data policy.
- Browser validation uses a local headless browser and loopback debugging port.
- No credentials or account-specific integrations are required.

## Public Repository Rules

Do not commit:

- live task state or conversation transcripts;
- absolute home-directory paths or machine-specific configuration;
- personal names, email addresses, account identifiers, or billing integrations;
- API keys, tokens, private keys, or `.env` files;
- private or licensed course material without permission.

Run `npm run privacy:check` before opening a pull request.
