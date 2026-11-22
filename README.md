# OpenVireo Developer

The source of [developer.openvireo.com](https://developer.openvireo.com): docs for building on OpenVireo with the
TypeScript SDK, the `ov` CLI, the sync server HTTP API and the Rust core bindings. Built with
[Astro](https://astro.build) and [Starlight](https://starlight.astro.build).

## Where the docs come from

Most pages are **generated**: the Markdown lives next to the code in each repo, and `npm run sync` publishes it
here. Edit the docs there, not here.

| Section | Source |
|---|---|
| `/sdk/`, `/cli/` | [`openvireo-sdk/docs`](https://github.com/openvireo/openvireo-sdk/tree/develop/docs) |
| `/sdk/api/` | TypeDoc, built from `openvireo-sdk` |
| `/api/`, `/self-hosting/` | [`openvireo-sync-server/docs`](https://github.com/openvireo/openvireo-sync-server/tree/develop/docs) and its `openapi.yaml` |
| `/bindings/` | [`openvireo-core/docs/bindings`](https://github.com/openvireo/openvireo-core/tree/develop/docs/bindings) |

Written here: the home page (`src/pages/index.astro`), `/guides/` (`src/content/docs/guides/`, cards from
`src/data/guides.ts`) and the theme (`src/styles/theme.css`, `src/components/`).

### Code in several languages

Consecutive fenced blocks marked `tab="Label"` in a source repo's docs become one tabbed group here (GitHub
shows them as ordinary blocks one after another). The reader's language choice applies to every group and is
remembered (`src/plugins/remark-code-tabs.mjs`, `src/scripts/code-tabs.ts`):

````md
```ts tab="TypeScript"
...
```
```python tab="Python"
...
```
````

Every page is also served as Markdown at `<path>.md` (the "Copy as Markdown" button), and `/llms.txt` indexes them.

## Develop

```sh
npm install
npm run dev          # http://localhost:4321
npm run build        # into dist/
```

## Sync the docs

The source repos are expected next to this one (`../openvireo-sdk`, `../openvireo-sync-server`,
`../openvireo-core`); `OPENVIREO_SDK_SRC`, `OPENVIREO_SYNC_SRC` and `OPENVIREO_CORE_SRC` override that.

```sh
npm run sync                                   # SDK + sync server at their latest release tag, core at develop
npm run sync -- --ref origin/develop           # everything at develop
npm run sync -- --only sdk --no-typedoc        # one repo, skip the TypeDoc build
```

It replaces `src/content/docs/{sdk,cli,api,self-hosting,bindings}`, `public/api/openapi.yaml` and
`public/sdk/api/`, and writes `data/redirects.json`: the old `openvireo.com/docs/...` URLs and where they live now.
Commit the result.

## Deploy

`develop` deploys to DigitalOcean App Platform on push (`.do/app.yaml`, the `Dockerfile` builds the site and
serves it with nginx). `./deploy-do.sh` creates or updates the app and its DNS record.

## License

MIT. The docs pages carry the license of the repo they come from.
