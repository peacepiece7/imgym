# Project Wiki

This is the short, current-state memory for Oh My Img. It answers four questions:

1. What is the system and where are its boundaries?
2. Which workflow owns each user task and API route?
3. How is it operated and recovered?
4. Where should a future change go, and what must remain true?

Snapshot reviewed: **2026-09-07**.

## Read by intent

| Need | Page |
| --- | --- |
| Reconstruct the system in five minutes | [Project shape](./project-shape.md) |
| Find a feature, route, input limit, or output | [Workflows and API](./workflows-and-api.md) |
| Run, deploy, verify, rotate a key, or recover | [Operations](./operations.md) |
| Change code without breaking project invariants | [Maintenance](./maintenance.md) |
| Study the underlying research or implementation history | [Document index](../README.md) |

## Documentation structure decision

The wiki lives in the main repository under `docs/wiki/`; it is not a separate GitHub Wiki repository. GitHub describes a README as the quick project introduction and a wiki as the place for longer usage, design, and principles. Keeping this project's small operational wiki beside the code adds one stronger property: a code change and its documentation can be reviewed and versioned together.

The content model is deliberately small:

- **README:** Korean orientation and quick start.
- **Living wiki:** concise English current truth.
- **How-to:** operational procedures.
- **Reference:** routes, limits, modules, and environment variables.
- **Explanation:** architecture and security rationale.
- **Dated records:** research, reviews, measurements, and past decisions.

This is influenced by [GitHub's distinction between READMEs and wikis](https://docs.github.com/en/communities/documenting-your-project-with-wikis/about-wikis), [Diátaxis](https://diataxis.fr/)'s separation of tutorials, how-to guides, reference, and explanation, the [C4 model](https://c4model.com/)'s hierarchical architecture views, and [Architecture Decision Records](https://adr.github.io/)' focus on preserving rationale and consequences.

## Source-of-truth order

When documents disagree, use this order:

1. Executable code and tests at the current commit.
2. `next.config.ts`, `Dockerfile`, `compose.yml`, and Nginx configuration for runtime facts.
3. This living wiki.
4. Undated design guides.
5. Dated reviews and research records.

Do not silently edit an old review to make it look current. Add a new dated record or update the living wiki instead.

## One-screen memory

- Product: private, self-hosted asset conversion workbench.
- UI: one Next.js App Router page with five client-side workspaces.
- API: one public health route and ten authenticated Node.js Route Handlers.
- Engines: ImageMagick, VTracer/SVGO/librsvg, FFmpeg, FontTools, and WeasyPrint.
- State: API key in owner-browser local storage; request data only in memory or temporary directories; no database or object storage.
- Admission: one processing job per Node process by default, configurable up to four.
- Deployment: Nginx -> `127.0.0.1:5820` -> Docker container port 3000, fixed base path `/imgym`.
- Production: <https://dev.margins.cloud/imgym>.
- Canonical verification: the Docker build runs the complete test suite before the Next.js production build.

## Wiki maintenance rule

Update the relevant wiki page in the same change whenever any of these move:

- a route, form field, response type, file limit, or quality gate;
- a module boundary or external binary;
- an environment variable, port, base path, domain, or deployment step;
- authentication, persistence, cleanup, concurrency, or timeout behavior;
- the definition of a workspace or an explicit non-goal.
