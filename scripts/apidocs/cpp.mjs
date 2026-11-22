#!/usr/bin/env node
// Builds the C++ API reference (Doxygen) for ov-ffi-cpp into public/reference/cpp/.
//
//   node scripts/apidocs/cpp.mjs                     # openvireo-core at origin/develop
//   node scripts/apidocs/cpp.mjs --ref v1.2.0        # any ref the core checkout knows
//
// The core checkout defaults to ../openvireo-core; OPENVIREO_CORE_SRC overrides it. The ref is
// `git archive`d into a temp dir and everything is built there, so the checkout is never touched.
//
// Most of the API is the header cxx generates from the bridge (ov-ffi-cpp/src/lib.rs.h), which only
// exists after a build: `cargo build -p ov-ffi-cpp` with OV_CXX_INCLUDE_DIR set makes build.rs
// export the public headers in their installed layout (bindings/ov-ffi-cpp/README.md, "Header
// layout"). Doxygen then documents ov-ffi-cpp/include/{ovcore,host}.h and the generated header,
// with the binding's README as the main page; the cxx runtime (namespace rust) is left out.
// The headers use plain `//` comments (cxx turns the bridge's `///` into `//` too), so an input
// filter makes them Doxygen comments. Settings: scripts/apidocs/Doxyfile.
//
// Needs: git, cargo (the core's toolchain) with a C++17 compiler, doxygen (1.10 or later).
// OPENVIREO_APIDOCS_CARGO_TARGET, when set, is used as CARGO_TARGET_DIR and kept, so repeat runs
// (and python.mjs) build incrementally.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const outDir = join(root, 'public', 'reference', 'cpp');

let ref = 'origin/develop';
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ref') ref = args[++i];
    else if (args[i] === '-h' || args[i] === '--help') {
        console.log('Usage: node scripts/apidocs/cpp.mjs [--ref <ref>]   (env OPENVIREO_CORE_SRC, OPENVIREO_APIDOCS_CARGO_TARGET)');
        process.exit(0);
    } else fail(`unknown argument ${args[i]}`);
}
if (!ref) fail('--ref needs a value');

function fail(message) {
    console.error(`error: ${message}`);
    process.exit(1);
}

const run = (cmd, cmdArgs, opts = {}) =>
    execFileSync(cmd, cmdArgs, { stdio: ['ignore', 'inherit', 'inherit'], ...opts });
const capture = (cmd, cmdArgs, opts = {}) =>
    execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();

const repo = resolve(process.env.OPENVIREO_CORE_SRC ?? join(root, '..', 'openvireo-core'));
if (!existsSync(join(repo, '.git'))) fail(`no git checkout at ${repo} (set OPENVIREO_CORE_SRC)`);
let commit;
try {
    commit = capture('git', ['-C', repo, 'rev-parse', '--verify', `${ref}^{commit}`]);
} catch {
    fail(`${repo} has no ref ${ref} (git fetch?)`);
}
try {
    capture('doxygen', ['--version']);
} catch {
    fail('doxygen is not on PATH (brew install doxygen / apt install doxygen)');
}

const started = Date.now();
const work = mkdtempSync(join(tmpdir(), 'openvireo-cppdoc-'));
try {
    console.log(`C++ API reference from openvireo-core ${ref}@${commit.slice(0, 10)}`);
    const src = join(work, 'src');
    mkdirSync(src);
    execFileSync('sh', ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'sh', repo, commit, src]);
    const crate = join(src, 'bindings', 'ov-ffi-cpp');
    if (!existsSync(join(crate, 'build.rs'))) fail(`openvireo-core at ${ref} has no bindings/ov-ffi-cpp`);

    // Build the crate so build.rs runs cxx and exports the headers into `include`.
    const include = join(work, 'include');
    const env = {
        ...process.env,
        OV_CXX_INCLUDE_DIR: include,
        CARGO_TARGET_DIR: process.env.OPENVIREO_APIDOCS_CARGO_TARGET
            ? resolve(process.env.OPENVIREO_APIDOCS_CARGO_TARGET)
            : join(work, 'target'),
    };
    console.log('  cargo build -p ov-ffi-cpp (generates the cxx bridge header)…');
    const t0 = Date.now();
    run('cargo', ['build', '--locked', '--quiet', '-p', 'ov-ffi-cpp'], { cwd: src, env });
    console.log(`  built in ${Math.round((Date.now() - t0) / 1000)} s`);
    const headers = ['ov-ffi-cpp/include/ovcore.h', 'ov-ffi-cpp/include/host.h', 'ov-ffi-cpp/src/lib.rs.h'];
    for (const h of headers) if (!existsSync(join(include, h))) fail(`the build exported no ${h}`);

    // Input filter: leading `//` comments become `///`, each file's opening comment block its @file
    // description, and `$` in preprocessor lines `_` (see the filter).
    const filter = join(work, 'doxygen-filter.mjs');
    writeFileSync(filter, doxygenFilter());

    const version = capture('cargo', ['metadata', '--format-version', '1', '--no-deps', '--offline'], { cwd: src, env, maxBuffer: 64 * 1024 * 1024 });
    const coreVersion = JSON.parse(version).packages.find((p) => p.name === 'ov-ffi-cpp')?.version ?? '';
    const projectNumber = coreVersion && coreVersion !== '0.0.0' ? coreVersion : `${ref} @ ${commit.slice(0, 10)}`;

    const html = join(work, 'doxygen');
    const doxyfile = join(work, 'Doxyfile');
    const q = (p) => `"${p}"`;
    writeFileSync(
        doxyfile,
        [
            `@INCLUDE = ${q(join(here, 'Doxyfile'))}`,
            `PROJECT_NUMBER = ${q(projectNumber)}`,
            `OUTPUT_DIRECTORY = ${q(html)}`,
            `INPUT = ${[...headers.map((h) => join(include, h)), join(crate, 'README.md')].map(q).join(' ')}`,
            `USE_MDFILE_AS_MAINPAGE = ${q(join(crate, 'README.md'))}`,
            `STRIP_FROM_PATH = ${q(include)} ${q(crate)}`,
            `STRIP_FROM_INC_PATH = ${q(include)}`,
            `INCLUDE_PATH = ${q(include)}`,
            `FILTER_PATTERNS = *.h=${q(`${process.execPath} ${filter}`)}`,
            '',
        ].join('\n'),
    );
    console.log('  doxygen…');
    run('doxygen', [doxyfile], { cwd: work });
    const out = join(html, 'html');
    if (!existsSync(join(out, 'index.html'))) fail('doxygen wrote no index.html');

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(dirname(outDir), { recursive: true });
    cpSync(out, outDir, { recursive: true });

    const { files, bytes } = tally(outDir);
    console.log(
        `  C++ API reference: ${files} files, ${(bytes / 1048576).toFixed(1)} MB in public/reference/cpp/ ` +
            `(${Math.round((Date.now() - started) / 1000)} s)`,
    );
} finally {
    rmSync(work, { recursive: true, force: true });
}

function tally(dir) {
    let files = 0;
    let bytes = 0;
    for (const name of readdirSync(dir, { recursive: true })) {
        const st = statSync(join(dir, name));
        if (st.isFile()) {
            files++;
            bytes += st.size;
        }
    }
    return { files, bytes };
}

// The Doxygen input filter (written into the temp dir, run as `node <filter> <header>`). Only lines
// that start with `//` change, so trailing comments (`} // namespace ov`) stay plain.
function doxygenFilter() {
    return String.raw`import { readFileSync } from 'node:fs';
const lines = readFileSync(process.argv[2], 'utf8').split('\n');
const comment = /^(\s*)\/\/(?![\/!])(.*)$/;
const out = [];
if (comment.test(lines[0] ?? '')) out.push('/// @file');
for (const line of lines) {
    const m = comment.exec(line);
    // cxx names its include guards CXXBRIDGE1_STRUCT_ov$Name; Doxygen's preprocessor stops a macro
    // name at the $, so every guard after the first would look defined and hide its item.
    if (line.startsWith('#')) out.push(line.replaceAll('$', '_'));
    else out.push(m ? m[1] + '///' + m[2] : line);
}
process.stdout.write(out.join('\n'));
`;
}
