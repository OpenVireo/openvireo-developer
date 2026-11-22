#!/usr/bin/env node
// Builds the Rust API reference (rustdoc) for openvireo-core into public/reference/rust/,
// served at https://developer.openvireo.com/reference/rust/.
//
//   node scripts/apidocs/rust.mjs                      # core at origin/develop
//   node scripts/apidocs/rust.mjs --ref v1.0.0         # any ref the core checkout knows
//   node scripts/apidocs/rust.mjs --no-source          # leave out the source view (src/)
//
// The core checkout defaults to ../openvireo-core next to this repo; OPENVIREO_CORE_SRC overrides it.
// Like the TypeDoc step in sync-docs.mjs, the ref is `git archive`d into a temp dir and built there
// (with its own target dir), so the checkout's working tree and target/ are never touched.
//
// Documented crates: the ov-core facade, plus the crates its public API is made of and that a Rust
// Host implementor names directly: ov-error (OvError, OvErrorCode), ov-host (the Host traits,
// re-exported as ov_core::host) and ov-http (HttpRequest, HttpResponse, Method). The internal
// crates (crypto, KDBX, merge, protocol, sync, ...), ov-testkit, xtask, benches, bins and the
// binding glue (bindings/*) are left out.
//
// Toolchain: whatever the core's rust-toolchain.toml pins (rustup picks it up in the temp dir);
// stable only, no -Z flags.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'public', 'reference', 'rust');
const crates = ['ov-core', 'ov-error', 'ov-host', 'ov-http'];
const entryCrate = 'ov_core';

let ref = 'origin/develop';
let withSource = true;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--ref') ref = args[++i];
    else if (arg === '--no-source') withSource = false;
    else if (arg === '-h' || arg === '--help') {
        console.log('Usage: node scripts/apidocs/rust.mjs [--ref <ref>] [--no-source]');
        process.exit(0);
    } else fail(`unknown argument ${arg}`);
}
if (!ref) fail('--ref needs a value');

function fail(message) {
    console.error(`error: ${message}`);
    process.exit(1);
}

const repo = resolve(process.env.OPENVIREO_CORE_SRC ?? join(root, '..', 'openvireo-core'));
if (!existsSync(join(repo, '.git'))) fail(`no openvireo-core checkout at ${repo} (set OPENVIREO_CORE_SRC)`);

const git = (...gitArgs) => execFileSync('git', ['-C', repo, ...gitArgs], { encoding: 'utf8' }).trim();
let commit;
try {
    commit = git('rev-parse', '--verify', `${ref}^{commit}`);
} catch {
    fail(`${ref} is not a commit in ${repo} (try \`git -C ${repo} fetch\`)`);
}
const short = commit.slice(0, 7);

const work = mkdtempSync(join(tmpdir(), 'openvireo-core-rustdoc-'));
try {
    console.log(`Rust API reference: openvireo-core ${ref}@${short}`);
    execFileSync('sh', ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'sh', repo, commit, work]);
    for (const crate of crates) {
        if (!existsSync(join(work, 'crates', crate, 'Cargo.toml'))) fail(`${ref} has no crates/${crate}`);
    }

    const env = {
        ...process.env,
        CARGO_TARGET_DIR: join(work, 'target'),
        // The workspace version is 0.0.0 (crates aren't published); show the commit instead.
        RUSTDOCFLAGS: [process.env.RUSTDOCFLAGS, `--crate-version ${ref.replace(/^origin\//, '')}@${short}`]
            .filter(Boolean).join(' '),
    };
    const cargoArgs = ['doc', '--no-deps', '--locked', ...crates.flatMap((c) => ['-p', c])];
    const started = Date.now();
    console.log(`  cargo ${cargoArgs.join(' ')}`);
    try {
        // Offline first: works whenever the registry cache already holds the locked deps.
        execFileSync('cargo', [...cargoArgs, '--offline'], { cwd: work, env, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch {
        console.log('  offline build failed, retrying with network access');
        execFileSync('cargo', cargoArgs, { cwd: work, env, stdio: ['ignore', 'inherit', 'inherit'] });
    }
    console.log(`  built in ${Math.round((Date.now() - started) / 1000)}s`);

    const docDir = join(work, 'target', 'doc');
    if (!existsSync(join(docDir, entryCrate, 'index.html'))) fail(`rustdoc produced no ${entryCrate}/index.html`);

    // Not needed to view the docs.
    rmSync(join(docDir, '.lock'), { force: true });
    if (!withSource) {
        rmSync(join(docDir, 'src'), { recursive: true, force: true });
        rmSync(join(docDir, 'src-files.js'), { force: true });
    }

    // rustdoc writes no root page; land on the facade crate.
    writeFileSync(join(docDir, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>OpenVireo core: Rust API reference</title>
<meta http-equiv="refresh" content="0; url=${entryCrate}/index.html">
<link rel="canonical" href="https://developer.openvireo.com/reference/rust/${entryCrate}/index.html">
</head>
<body>
<p>Redirecting to <a href="${entryCrate}/index.html">the ov_core API reference</a>.</p>
</body>
</html>
`);

    rmSync(outDir, { recursive: true, force: true });
    cpSync(docDir, outDir, { recursive: true });

    let files = 0;
    let pages = 0;
    let bytes = 0;
    const walk = (dir) => {
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            const st = statSync(path);
            if (st.isDirectory()) walk(path);
            else {
                files++;
                bytes += st.size;
                if (name.endsWith('.html')) pages++;
            }
        }
    };
    walk(outDir);
    console.log(`  ${pages} pages, ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB in public/reference/rust/`);
} finally {
    rmSync(work, { recursive: true, force: true });
}
