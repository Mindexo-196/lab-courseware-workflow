# Contributing

## Before You Start

- Use Node.js 20 or newer.
- Keep the editable Skill in `skill/courseware-workflow/`.
- Do not add a second Skill copy under `packaging/plugin/`.
- Do not commit generated archives, local task state, credentials, personal paths,
  conversation transcripts, or private course material.

## Workflow

1. Fork the repository and create a focused branch.
2. Make changes in the source Skill or repository tooling.
3. Refresh the derived manifest:

   ```bash
   npm run release:manifest
   ```

4. Run the public-repository checks:

   ```bash
   npm run privacy:check
   npm test
   ```

5. Open a pull request describing the behavior change and verification result.

## Code Style

- Use ES modules and the built-in Node.js standard library where practical.
- Keep runtime scripts independent of repository-only build tooling.
- Preserve the single-`live.json` state model and the direct CST reference model.
- Include a regression test for changes to state transitions or generated output.

## License

Contributions are accepted under the MIT License in [LICENSE](LICENSE).
