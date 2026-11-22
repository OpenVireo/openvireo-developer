#!/usr/bin/env node
// Builds the Swift API reference (DocC) for the core's Swift binding, the module `OpenVireoRustCore`
// (openvireo-core bindings/ov-ffi), into public/reference/swift/, served at /reference/swift/.
//
//   node scripts/apidocs/swift.mjs                       # openvireo-core at origin/develop
//   node scripts/apidocs/swift.mjs --ref v1.2.3          # at another ref
//
// The core checkout defaults to ../openvireo-core; OPENVIREO_CORE_SRC overrides it. Like the TypeDoc step in
// sync-docs.mjs, the ref is `git archive`d into a temp dir and everything is built there, so the checkout is
// left alone. Steps:
//   1. `cargo xtask xcframework --macos-only`: the macOS slice of OpenVireoCore.xcframework and the
//      UniFFI-generated OpenVireoRustCore.swift (both gitignored, so they never come from the archive).
//   2. `swift build` of the OpenVireoRustCore target with -emit-symbol-graph (no swift-docc-plugin, so no
//      package fetch from the network).
//   3. `xcrun docc convert` on the module's symbol graph, transformed for static hosting under
//      reference/swift: every route gets its own index.html, so nginx needs no rewrite.
//
// Needs macOS with Xcode (swift, xcrun docc, xcodebuild), rustup with the core's pinned toolchain and the
// aarch64-apple-darwin + x86_64-apple-darwin targets. The cargo build is a cold release build in the temp
// dir (several minutes); set CARGO_TARGET_DIR to reuse a target directory between runs.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULE = 'OpenVireoRustCore';
const BASE = 'reference/swift';
const outDir = join(root, 'public', ...BASE.split('/'));

let ref = 'origin/develop';
let keep = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--ref') ref = args[++i];
    else if (arg === '--keep') keep = true;
    else if (arg === '-h' || arg === '--help') {
        console.log('Usage: node scripts/apidocs/swift.mjs [--ref <ref>] [--keep]   (--keep leaves the temp build dir)');
        process.exit(0);
    } else fail(`unknown argument ${arg}`);
}
if (!ref) fail('--ref needs a value');
if (process.platform !== 'darwin') fail('the Swift reference needs macOS with Xcode');

function fail(message) {
    console.error(`error: ${message}`);
    process.exit(1);
}

const repo = resolve(process.env.OPENVIREO_CORE_SRC ?? join(root, '..', 'openvireo-core'));
if (!existsSync(join(repo, '.git'))) fail(`no openvireo-core checkout at ${repo} (set OPENVIREO_CORE_SRC)`);
const run = (cmd, cmdArgs, opts = {}) =>
    execFileSync(cmd, cmdArgs, { stdio: ['ignore', 'inherit', 'inherit'], ...opts });
const commit = execFileSync('git', ['-C', repo, 'rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' }).trim();

const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;
const work = mkdtempSync(join(tmpdir(), 'openvireo-core-swift-'));
try {
    console.log(`Swift API reference: openvireo-core ${ref}@${commit.slice(0, 10)} in ${work}`);
    execFileSync('sh', ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'sh', repo, commit, work]);
    const pkg = join(work, 'bindings', 'ov-ffi');
    if (!existsSync(join(pkg, 'Package.swift'))) fail(`openvireo-core at ${ref} has no bindings/ov-ffi/Package.swift`);

    console.log('  1/3 cargo xtask xcframework --macos-only…');
    const env = { ...process.env, CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? join(work, 'target') };
    run('cargo', ['xtask', 'xcframework', '--macos-only'], { cwd: work, env, stdio: ['ignore', 'ignore', 'inherit'] });
    console.log(`      done (${elapsed()})`);

    console.log('  2/3 swift build with symbol graphs…');
    const graphs = join(work, 'symbol-graphs');
    const moduleGraphs = join(work, 'module-graphs');
    mkdirSync(graphs, { recursive: true });
    mkdirSync(moduleGraphs, { recursive: true });
    run('swift', [
        'build', '--package-path', pkg, '--scratch-path', join(work, 'swift-build'), '--target', MODULE,
        '-Xswiftc', '-emit-symbol-graph', '-Xswiftc', '-emit-symbol-graph-dir', '-Xswiftc', graphs,
        '-Xswiftc', '-symbol-graph-minimum-access-level', '-Xswiftc', 'public',
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    // Only the Swift module (and its extension graphs, OpenVireoRustCore@Foundation…), not the C FFI module.
    const picked = readdirSync(graphs).filter((f) => f === `${MODULE}.symbols.json` || f.startsWith(`${MODULE}@`));
    if (!picked.includes(`${MODULE}.symbols.json`)) fail(`swift build wrote no ${MODULE}.symbols.json`);
    for (const f of picked) cpSync(join(graphs, f), join(moduleGraphs, f));
    console.log(`      ${picked.join(', ')} (${elapsed()})`);

    console.log('  3/3 docc convert…');
    const archive = join(work, `${MODULE}.doccarchive`);
    run('xcrun', [
        'docc', 'convert',
        '--additional-symbol-graph-dir', moduleGraphs,
        '--fallback-display-name', MODULE,
        '--fallback-bundle-identifier', 'com.openvireo.core.swift',
        '--fallback-default-module-kind', 'Framework',
        '--transform-for-static-hosting', '--hosting-base-path', BASE,
        '--output-path', archive,
    ], { stdio: ['ignore', 'ignore', 'inherit'] });

    rmSync(outDir, { recursive: true, force: true });
    cpSync(archive, outDir, { recursive: true });
    // DocC's own root index.html is the app shell with nothing to route to at /reference/swift/; send readers
    // to the module page instead.
    const modulePath = `/${BASE}/documentation/${MODULE.toLowerCase()}/`;
    writeFileSync(join(outDir, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${MODULE} Swift API reference</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${modulePath}">
<meta http-equiv="refresh" content="0; url=${modulePath}">
<script>location.replace(${JSON.stringify(modulePath)} + location.hash);</script>
</head>
<body><p><a href="${modulePath}">${MODULE} Swift API reference</a></p></body>
</html>
`);
    // Provenance, next to the output (not served as a page).
    writeFileSync(join(outDir, 'source.json'), `${JSON.stringify({ repo: 'openvireo-core', ref, commit }, null, 2)}\n`);

    let files = 0, bytes = 0, pages = 0;
    const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else {
                files++;
                bytes += statSync(p).size;
                if (e.name === 'index.html' && p.includes(`${join(outDir, 'documentation')}`)) pages++;
            }
        }
    };
    walk(outDir);
    console.log(`Swift API reference: ${pages} pages, ${files} files, ${(bytes / 1048576).toFixed(1)} MB in public/${BASE}/ (${elapsed()})`);
    console.log(`Entry: ${modulePath}`);
} finally {
    if (keep) console.log(`kept ${work}`);
    else rmSync(work, { recursive: true, force: true });
}
