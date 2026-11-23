#!/usr/bin/env node
// Publish the developer docs, the Markdown in openvireo-sdk/docs, openvireo-sync-server/docs and
// openvireo-core/docs/bindings, as Starlight pages. Ported from openvireo-site/scripts/sync-dev-docs.mjs.
//
//   npm run sync                                      # sync server + SDK at their latest release tag, core at develop
//   npm run sync -- --ref develop                     # all three at a branch, tag, or commit
//   npm run sync -- --sync-ref v1.2.0 --sdk-ref v1.0.0 --core-ref develop
//   npm run sync -- --only sdk --no-typedoc           # one source repo, without rebuilding the TypeDoc reference
//
// The checkouts default to ../openvireo-sync-server, ../openvireo-sdk and ../openvireo-core;
// OPENVIREO_SYNC_SRC, OPENVIREO_SDK_SRC and OPENVIREO_CORE_SRC override them. Files are read from the ref
// with git, so the working trees are left alone. The core publishes from develop unless --core-ref says
// otherwise: its v* tags are the SDK's, inherited with its history, and predate the bindings docs.
//
// Each source file goes to one page under src/content/docs/ (see `pages` below). The SDK repo feeds both
// /sdk/ and /cli/; the sync server repo feeds /api/ (client developers) and /self-hosting/ (operators).
// It also writes public/api/openapi.yaml, the TypeDoc reference in public/sdk/api/, and
// data/redirects.json, the map from the old openvireo.com/docs/ URLs to this site.
// Generated directories are replaced wholesale; edit the docs in their own repositories.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contentRoot = join(root, 'src', 'content', 'docs');

// Content directories this script owns (wiped and rewritten). guides/ is written by hand.
const ownedDirs = { 'sync-server': ['api', 'self-hosting'], sdk: ['sdk', 'cli'], core: ['bindings'] };

// Per source repo: each published file's page `path` (under src/content/docs, no extension; a trailing
// `index` is the section landing page), sidebar `order`, a one-line `summary` (the page lead), and
// `old`, its slug on openvireo.com/docs/<source>/ (for redirects and link rewriting). A docs file missing
// here still publishes, under the repo's first directory, with a warning; files under `unpublished` don't.
const sources = {
    'sync-server': {
        repo: 'openvireo-sync-server',
        env: 'OPENVIREO_SYNC_SRC',
        product: 'OpenVireo Sync Server',
        unpublished: ['docs/stateless-design.md'],
        fallbackDir: 'self-hosting',
        pages: {
            'docs/index.md': { path: 'self-hosting/index', order: 0, old: 'overview', label: 'Overview', summary: 'What the sync server does, how sync works, and a quick start.' },
            'docs/install.md': { path: 'self-hosting/install', order: 20, old: 'install', summary: 'Build from source, run the Docker image, deploy to DigitalOcean, put HTTPS in front.' },
            'docs/configuration.md': { path: 'self-hosting/configuration', order: 30, old: 'configuration', summary: 'Every SYNC_* setting, and the data directory or Postgres and S3 storage.' },
            'docs/users-and-devices.md': { path: 'self-hosting/users-and-devices', order: 40, old: 'users-and-devices', summary: 'Add users and devices, pair new devices, shut out a lost one.' },
            'docs/accounts.md': { path: 'self-hosting/accounts', order: 50, old: 'accounts', summary: 'Run the server behind an OpenVireo account server, with access tokens and vaults.' },
            'docs/operations.md': { path: 'self-hosting/operations', order: 80, old: 'operations', summary: 'Backups, upgrades, moving to Postgres, scaling and monitoring.' },
            'docs/development.md': { path: 'self-hosting/development', order: 90, old: 'development', summary: 'Source layout, tests and releases.' },
            'docs/api.md': { path: 'api/index', order: 0, old: 'api', label: 'Overview', summary: 'Routes, concurrency, history, events, CORS and errors.' },
            'api-reference': { path: 'api/reference', order: 10, old: 'api-reference', summary: 'Every route, its parameters and responses, from the OpenAPI description.' },
        },
    },
    sdk: {
        repo: 'openvireo-sdk',
        env: 'OPENVIREO_SDK_SRC',
        product: 'OpenVireo SDK',
        unpublished: [],
        typedoc: true,
        fallbackDir: 'sdk/guides',
        pages: {
            'docs/index.md': { path: 'sdk/index', order: 0, old: 'overview', label: 'Overview', summary: 'The packages, installing, and a first program.' },
            'docs/concepts.md': { path: 'sdk/concepts', order: 10, old: 'concepts', summary: 'Keys, vaults, roles, organisations, references, and what the servers see.' },
            'docs/guides/hosted-account.md': { path: 'sdk/guides/hosted-account', order: 30, old: 'hosted-account', summary: 'Sign up, sign in, unlock and lock, sessions and storage.' },
            'docs/guides/vaults-and-sharing.md': { path: 'sdk/guides/vaults-and-sharing', order: 40, old: 'vaults-and-sharing', summary: 'Open, read and write vaults; create, share, revoke; organisations.' },
            'docs/guides/share-links.md': { path: 'sdk/guides/share-links', order: 45, old: 'share-links', summary: 'Give an item or some text to anyone, no account needed.' },
            'docs/guides/events.md': { path: 'sdk/guides/events', order: 50, old: 'events', summary: 'React to changes from other devices and to access changes.' },
            'docs/guides/offline.md': { path: 'sdk/guides/offline', order: 60, old: 'offline', summary: 'Keep working without the network, and catch up afterwards.' },
            'docs/guides/move-to-account.md': { path: 'sdk/guides/move-to-account', order: 70, old: 'move-to-account', summary: 'Turn an existing database into a vault.' },
            'docs/guides/recovery.md': { path: 'sdk/guides/recovery', order: 80, old: 'recovery', summary: 'Account resets and restoring the old vaults.' },
            'docs/guides/service-accounts.md': { path: 'sdk/guides/service-accounts', order: 90, old: 'service-accounts', summary: 'Secrets for CI, servers and long-running processes.' },
            'docs/guides/self-hosted-sync.md': { path: 'sdk/guides/self-hosted-sync', order: 100, old: 'self-hosted-sync', summary: 'Sync .kdbx files with a self-hosted server, no account needed.' },
            'docs/guides/testing.md': { path: 'sdk/guides/testing', order: 110, old: 'testing', summary: 'Test your app against in-memory servers.' },
            'docs/cli.md': { path: 'cli/index', order: 0, old: 'cli', label: 'ov CLI', summary: 'ov: read, inject, run and rotate secrets from the command line.' },
            'docs/connect.md': { path: 'cli/connect', order: 10, old: 'connect', summary: 'ov connect: a REST server for one service account, and Kubernetes.' },
            'docs/github-action.md': { path: 'cli/github-action', order: 20, old: 'github-action', summary: 'Load secrets into GitHub Actions workflows.' },
            'docs/errors.md': { path: 'sdk/reference/errors', order: 10, old: 'errors', summary: 'Every error code and what to do about it.' },
            'docs/merge-behaviour.md': { path: 'sdk/reference/merge-behaviour', order: 20, old: 'merge-behaviour', summary: 'How concurrent edits are combined, exactly.' },
            'docs/lower-level.md': { path: 'sdk/reference/lower-level', order: 30, old: 'lower-level', summary: 'The sync loop, HTTP clients, KDBX helpers, Argon2 and OPAQUE.' },
            'docs/migrating-to-1.0.md': { path: 'sdk/reference/migrating-to-1.0', order: 40, old: 'migrating-to-1.0', summary: 'What changed in 1.0, on the shared Rust core, and how to upgrade.' },
        },
    },
    core: {
        repo: 'openvireo-core',
        env: 'OPENVIREO_CORE_SRC',
        product: 'OpenVireo core',
        dir: 'docs/bindings',
        index: 'docs/bindings/README.md',
        defaultRef: 'develop',
        unpublished: [],
        fallbackDir: 'bindings',
        pages: {
            'docs/bindings/README.md': { path: 'bindings/index', order: 0, old: 'overview', label: 'Overview', summary: 'Every language binding, what it is for, and how they differ.' },
            'docs/bindings/python.md': { path: 'bindings/python', order: 10, old: 'python', summary: 'The openvireo package: install, sign in, vaults, sync, errors.' },
            'docs/bindings/kotlin-java.md': { path: 'bindings/kotlin-java', order: 20, old: 'kotlin-java', summary: 'com.openvireo.core for the JVM and Android, from Kotlin or Java.' },
        },
    },
};

// Arguments ----------------------------------------------------------------------------------

const args = process.argv.slice(2);
const refs = {};
let only = null;
let buildTypedoc = true;
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--ref') refs['sync-server'] = refs.sdk = refs.core = args[++i];
    else if (arg === '--sync-ref') refs['sync-server'] = args[++i];
    else if (arg === '--sdk-ref') refs.sdk = args[++i];
    else if (arg === '--core-ref') refs.core = args[++i];
    else if (arg === '--only') only = args[++i];
    else if (arg === '--no-typedoc' || arg === '--no-api') buildTypedoc = false;
    else if (arg === '-h' || arg === '--help') {
        console.log('Usage: npm run sync -- [--ref <ref>] [--sync-ref <ref>] [--sdk-ref <ref>] [--core-ref <ref>] [--only sync-server|sdk|core] [--no-typedoc]');
        process.exit(0);
    } else fail(`unknown argument ${arg}`);
}
if (only && !sources[only]) fail(`--only takes ${Object.keys(sources).join(', ')}`);

function fail(message) {
    console.error(`error: ${message}`);
    process.exit(1);
}

const gitIn = (repo) => (...gitArgs) => execFileSync('git', ['-C', repo, ...gitArgs], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

// URLs -----------------------------------------------------------------------------------------

/** A page path (sdk/guides/offline, sdk/index) as its URL on this site. */
const urlOf = (path) => `/${path.replace(/(^|\/)index$/, '')}/`.replace(/\/+/g, '/');

/** This site's URL for a docs file in one of the source repos, or null if it isn't published. */
function pageUrl(repoName, file) {
    const source = Object.values(sources).find((s) => s.repo.toLowerCase() === repoName.toLowerCase());
    const page = source?.pages[file];
    return page ? urlOf(page.path) : null;
}

/** The old openvireo.com/docs/ URLs and where they live now. */
function redirectMap() {
    const map = {};
    for (const [name, source] of Object.entries(sources)) {
        map[`/docs/${name}/`] = urlOf(source.pages[source.index ?? `${source.dir ?? 'docs'}/index.md`].path);
        for (const page of Object.values(source.pages)) map[`/docs/${name}/${page.old}/`] = urlOf(page.path);
    }
    map['/docs/sdk/api/'] = '/sdk/api/';
    map['/docs/sync-server/openapi.yaml'] = '/api/openapi.yaml';
    return map;
}
const redirects = redirectMap();

/** An old /docs/... path (with optional #anchor) on this site, or null. */
function mapOldDocsPath(path) {
    const [p, anchor] = path.split('#');
    const withSlash = /\.\w+$/.test(p) || p.endsWith('/') ? p : `${p}/`;
    const hash = anchor ? `#${anchor}` : '';
    if (redirects[withSlash]) return redirects[withSlash] + hash;
    if (withSlash.startsWith('/docs/sdk/api/')) return withSlash.replace('/docs/sdk/api/', '/sdk/api/') + hash;
    return null;
}

// Markdown -------------------------------------------------------------------------------------

/**
 * Turns one docs file into a page body: takes the title from the h1, drops HTML comments (sample-checker
 * notes, editors' notes), and points links at this site (pages it publishes), openvireo.com (other site
 * pages) or GitHub (everything else). Heading ids are left to Astro, whose slugger matches GitHub's, so
 * existing #anchors keep working.
 */
function convert(markdown, file, ctx) {
    const lines = markdown.split('\n');
    const out = [];
    let title = null;
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const open = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
        if (fence) {
            if (open && open[2].startsWith(fence) && open[3].trim() === '') fence = null;
            out.push(line);
            continue;
        }
        if (open) {
            fence = open[2];
            // Hugo-style attributes ({linenos=false}) mean nothing to Expressive Code
            const info = open[3].replace(/\{[^}]*\}/g, '').trim();
            out.push(`${open[1]}${open[2]}${info || 'text'}`);
            continue;
        }
        if (title === null && /^# /.test(line)) {
            title = line.slice(2).trim().replace(/`/g, '');
            continue;
        }
        if (/^\s*<!--/.test(line)) {
            while (i < lines.length && !lines[i].includes('-->')) i++;
            const rest = (lines[i] ?? '').slice((lines[i] ?? '').indexOf('-->') + 3);
            if (rest.trim() === '') continue;
            line = rest;
        }
        line = line.replace(/<!--.*?-->/g, '');
        out.push(rewriteLinks(line, file, ctx));
    }
    return { title, body: out.join('\n').replace(/^\n+/, '') };
}

function rewriteLinks(line, file, ctx) {
    // Inline code keeps its text: split it out first
    return line
        .split(/(`[^`]*`)/)
        .map((part, n) => (n % 2 ? part : part.replace(/\]\(([^)\s]+)\)/g, (m, target) => `](${linkTarget(target, file, ctx)})`)))
        .join('');
}

function linkTarget(target, file, ctx) {
    const site = /^https:\/\/openvireo\.com(\/.*)$/.exec(target);
    if (site) return mapOldDocsPath(site[1]) ?? target;
    const gh = /^https:\/\/github\.com\/openvireo\/([\w-]+)\/blob\/[^/]+\/(docs\/[^#]+\.md)(#.*)?$/i.exec(target);
    if (gh) {
        const page = pageUrl(gh[1], gh[2]);
        return page ? page + (gh[3] ?? '') : target;
    }
    if (target.startsWith('/docs/')) return mapOldDocsPath(target) ?? `https://openvireo.com${target}`;
    // This site's own paths (the generated API reference links to them) stay; other root paths are openvireo.com's
    if (/^\/(sdk|cli|api|self-hosting|bindings|guides)(\/|$)/.test(target)) return target;
    if (target.startsWith('/')) return `https://openvireo.com${target}`;
    if (/^[a-z]+:/i.test(target) || target.startsWith('#')) return target;
    const [path, anchor = ''] = target.split('#');
    const resolved = posix.normalize(posix.join(posix.dirname(file), path));
    const page = pageUrl(ctx.repo, resolved);
    if (page) return page + (anchor ? `#${anchor}` : '');
    if (resolved === 'docs/openapi.yaml' && ctx.repo === 'openvireo-sync-server') return '/api/openapi.yaml';
    const kind = ctx.isDirectory(resolved.replace(/\/$/, '')) ? 'tree' : 'blob';
    return `https://github.com/openvireo/${ctx.repo}/${kind}/${ctx.ref}/${resolved.replace(/\/$/, '')}${anchor ? `#${anchor}` : ''}`;
}

const frontMatter = (fields) => `---\n${YAML.stringify(fields, { lineWidth: 0 }).trimEnd()}\n---`;

// OpenAPI → Markdown (one page; per-operation pages are Phase 2) -------------------------------

function apiReference(spec) {
    const refOf = (obj) => {
        let o = obj;
        for (let n = 0; o && o.$ref && n < 10; n++) {
            o = o.$ref.replace(/^#\//, '').split('/').reduce((acc, k) => acc?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], spec);
        }
        return o ?? {};
    };
    const schemaText = (s) => {
        const schema = refOf(s);
        if (s?.$ref) return `\`${s.$ref.split('/').pop()}\``;
        if (schema.const !== undefined) return `\`${JSON.stringify(schema.const)}\``;
        if (schema.enum) return schema.enum.map((v) => `\`${v}\``).join(', ');
        if (schema.type === 'array') return `array of ${schemaText(schema.items)}`;
        const type = Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type ?? 'object';
        return schema.format ? `${type} (${schema.format})` : type;
    };
    const oneLine = (s) => (s ?? '').trim().replace(/\s*\n\s*/g, ' ');
    const cell = (s) => oneLine(s).replace(/\|/g, '\\|');
    const properties = (schema) => {
        const s = refOf(schema);
        const required = new Set(s.required ?? []);
        return Object.entries(s.properties ?? {}).map(([name, p]) =>
            `| \`${name}\`${required.has(name) ? '' : ' (optional)'} | ${schemaText(p)} | ${cell(refOf(p).description)} |`);
    };

    const out = [];
    out.push('# API reference', '');
    if (spec.info.description) out.push(spec.info.description.trim(), '');
    out.push(`The machine-readable description is [openapi.yaml](/api/openapi.yaml) (OpenAPI ${spec.openapi}); `
        + 'import it into an HTTP client or a code generator. [The overview](/api/) explains how the routes fit together.', '');
    out.push('## Authentication', '');
    out.push('| Scheme | |', '|---|---|');
    for (const [name, scheme] of Object.entries(spec.components.securitySchemes)) out.push(`| \`${name}\` | ${cell(scheme.description)} |`);
    out.push('');

    for (const tag of spec.tags) {
        const ops = [];
        for (const [path, item] of Object.entries(spec.paths)) {
            for (const method of ['get', 'put', 'post', 'delete']) {
                if (item[method]?.tags?.includes(tag.name)) ops.push({ path, method, op: item[method], shared: item.parameters ?? [] });
            }
        }
        if (!ops.length) continue;
        out.push(`## ${tag.name[0].toUpperCase()}${tag.name.slice(1)}`, '');
        if (tag.description) out.push(tag.description, '');
        for (const { path, method, op, shared } of ops) {
            out.push(`### ${method.toUpperCase()} ${spec.servers?.[0] ? '/api/v1' : ''}${path}`, '');
            out.push(`**${oneLine(op.summary)}**${op.operationId ? ` (\`${op.operationId}\`)` : ''}`, '');
            if (op.description) out.push(op.description.trim(), '');
            const security = op.security ?? spec.security ?? [];
            out.push(`Token: ${security.length ? security.map((s) => `\`${Object.keys(s)[0]}\``).join(' or ') : 'none'}`, '');
            const params = [...shared, ...(op.parameters ?? [])].map(refOf);
            if (params.length) {
                out.push('| Parameter | In | Type | |', '|---|---|---|---|');
                for (const p of params) out.push(`| \`${p.name}\`${p.required ? '' : ' (optional)'} | ${p.in} | ${schemaText(p.schema)} | ${cell(p.description)} |`);
                out.push('');
            }
            const body = op.requestBody && refOf(op.requestBody);
            if (body?.content) {
                const [type, media] = Object.entries(body.content)[0];
                out.push(`Request body (\`${type}\`)${body.description ? `: ${oneLine(body.description)}` : ''}`, '');
                const rows = media.schema ? properties(media.schema) : [];
                if (rows.length) out.push('| Field | Type | |', '|---|---|---|', ...rows, '');
            }
            out.push('| Status | |', '|---|---|');
            for (const [status, r] of Object.entries(op.responses)) {
                const resp = refOf(r);
                const schema = resp.content && Object.values(resp.content)[0]?.schema;
                const shape = schema ? ` ${schemaText(schema)}` : '';
                out.push(`| ${status} | ${cell(resp.description)}${shape ? ` (${shape.trim()})` : ''} |`);
            }
            out.push('');
        }
    }

    out.push('## Schemas', '');
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
        out.push(`### ${name}`, '');
        const rows = properties(schema);
        if (rows.length) out.push('| Field | Type | |', '|---|---|---|', ...rows, '');
        else out.push(`${schemaText(schema)}${schema.pattern ? `, matching \`${schema.pattern}\`` : ''}`, '');
    }
    return out.join('\n');
}

// Build ----------------------------------------------------------------------------------------

const checkouts = {};
for (const [name, source] of Object.entries(sources)) {
    if (only && name !== only) continue;
    const repo = resolve(process.env[source.env] || join(root, '..', source.repo));
    if (!existsSync(join(repo, '.git'))) fail(`${repo} is not a ${source.repo} checkout. Pass its path in ${source.env}.`);
    const git = gitIn(repo);
    let ref = refs[name] ?? source.defaultRef;
    if (!ref) {
        ref = git('tag', '--list', 'v*', '--sort=-v:refname').split('\n')[0];
        if (!ref) fail(`${source.repo} has no release tags; pass --ref develop`);
    }
    let commit;
    try {
        commit = git('rev-parse', '--short', `${ref}^{commit}`);
    } catch {
        fail(`unknown ref "${ref}" in ${repo}`);
    }
    ref = ref.replace(/^origin\//, ''); // origin/develop is develop on GitHub
    const dir = source.dir ?? 'docs';
    const index = source.index ?? `${dir}/index.md`;
    const files = git('ls-tree', '-r', '--name-only', commit, '--', dir).split('\n').filter((f) => f.endsWith('.md'));
    if (!files.includes(index)) fail(`${source.repo} at ${ref} has no ${index}; pass --ref develop`);
    checkouts[name] = { source, repo, git, ref, commit, dir, files: files.filter((f) => !source.unpublished.includes(f)) };
}

for (const [name, { source, repo, git, ref, commit, dir, files }] of Object.entries(checkouts)) {
    for (const owned of ownedDirs[name]) {
        rmSync(join(contentRoot, owned), { recursive: true, force: true });
        mkdirSync(join(contentRoot, owned), { recursive: true });
    }
    const isDirectory = (path) => {
        try {
            return git('cat-file', '-t', `${commit}:${path}`) === 'tree';
        } catch {
            return false;
        }
    };
    const ctx = { repo: source.repo, ref, isDirectory };
    const generated = `<!-- Generated by scripts/sync-docs.mjs from ${source.repo} ${ref}@${commit}; do not edit by hand. -->`;
    let count = 0;

    const write = (key, title, body, editFile) => {
        let page = source.pages[key];
        if (!page) {
            const slug = posix.basename(key, '.md');
            console.warn(`  warning: ${key} isn't listed in scripts/sync-docs.mjs; publishing it last as ${source.fallbackDir}/${slug}`);
            page = { path: `${source.fallbackDir}/${slug}`, order: 1000 + count, summary: '' };
        }
        const fields = {
            title,
            // Explicit, so a slug like migrating-to-1.0 keeps its dot (Starlight would make it migrating-to-10)
            slug: urlOf(page.path).replace(/^\/|\/$/g, ''),
            ...(page.summary ? { description: page.summary } : {}),
            editUrl: `https://github.com/openvireo/${source.repo}/edit/develop/${editFile}`,
            sidebar: { order: page.order, ...(page.label ? { label: page.label } : {}) },
        };
        const out = join(contentRoot, `${page.path}.md`);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, `${frontMatter(fields)}\n${generated}\n\n${body}\n`);
        count++;
    };

    for (const file of files) {
        const { title, body } = convert(git('show', `${commit}:${file}`), file, ctx);
        write(file, title ?? posix.basename(file, '.md'), body, file);
    }

    if (name === 'sync-server') {
        const yamlText = git('show', `${commit}:docs/openapi.yaml`);
        const { title, body } = convert(apiReference(YAML.parse(yamlText)), 'docs/api-reference.md', ctx);
        write('api-reference', title, body, 'docs/openapi.yaml');
        mkdirSync(join(root, 'public', 'api'), { recursive: true });
        writeFileSync(join(root, 'public', 'api', 'openapi.yaml'), yamlText.endsWith('\n') ? yamlText : `${yamlText}\n`);
    }
    console.log(`  ${source.product}: ${count} pages from ${source.repo} ${ref}@${commit}`);

    if (source.typedoc && buildTypedoc) {
        const work = mkdtempSync(join(tmpdir(), 'openvireo-sdk-'));
        try {
            execFileSync('sh', ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'sh', repo, commit, work]);
            if (!existsSync(join(work, 'typedoc.json'))) fail(`${source.repo} at ${ref} has no typedoc.json; pass --no-typedoc or a newer ref`);
            console.log('  Building the TypeScript API reference (npm ci, typedoc)…');
            execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: work, stdio: ['ignore', 'ignore', 'inherit'] });
            writeFileSync(join(work, 'typedoc.site.json'), JSON.stringify({
                extends: ['./typedoc.json'],
                out: 'docs-api',
                gitRevision: commit,
                navigationLinks: { 'SDK guides': '/sdk/', GitHub: `https://github.com/openvireo/${source.repo}` },
            }));
            execFileSync('npx', ['typedoc', '--options', 'typedoc.site.json'], { cwd: work, stdio: ['ignore', 'ignore', 'inherit'] });
            const apiDir = join(root, 'public', 'sdk', 'api');
            rmSync(apiDir, { recursive: true, force: true });
            cpSync(join(work, 'docs-api'), apiDir, { recursive: true });
            console.log(`  TypeScript API reference: ${readdirSync(apiDir).length} entries in public/sdk/api/`);
        } finally {
            rmSync(work, { recursive: true, force: true });
        }
    }
}

mkdirSync(join(root, 'data'), { recursive: true });
writeFileSync(join(root, 'data', 'redirects.json'), `${JSON.stringify(redirects, null, 2)}\n`);

// The current releases, shown on the home page (version pill, Python install, GitHub Action ref): the
// newest vX.Y.Z tag reachable from the synced commit of the SDK and the core. A source left out with
// --only keeps the version it had.
const releasesFile = join(root, 'data', 'releases.json');
const releases = existsSync(releasesFile) ? JSON.parse(readFileSync(releasesFile, 'utf8')) : {};
for (const name of ['sdk', 'core']) {
    const checkout = checkouts[name];
    if (!checkout) continue;
    const tag = checkout.git('tag', '--list', 'v*', '--sort=-v:refname', '--merged', checkout.commit)
        .split('\n').find((t) => /^v\d+\.\d+\.\d+$/.test(t));
    if (!tag) fail(`${checkout.source.repo} has no vX.Y.Z tag at ${checkout.ref}; fetch its tags`);
    releases[name] = tag.slice(1);
}
writeFileSync(releasesFile, `${JSON.stringify(releases, null, 2)}\n`);
console.log(`  Releases: core ${releases.core ?? '?'}, SDK ${releases.sdk ?? '?'} (data/releases.json)`);

console.log('\nDone. Review the changes with `git status` and preview them with `npm run dev`.');
