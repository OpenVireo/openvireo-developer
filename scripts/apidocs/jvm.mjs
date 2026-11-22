#!/usr/bin/env node
// Builds the API reference of the core's JVM binding (com.openvireo:openvireo-core-jvm):
//   public/reference/kotlin/   Dokka HTML: the Kotlin API (generated binding, hosts, Java facade).
//   public/reference/java/     Javadoc (the JDK's own javadoc): the API as Java code sees it.
//
//   node scripts/apidocs/jvm.mjs                      # openvireo-core at origin/develop
//   node scripts/apidocs/jvm.mjs --ref v1.2.0         # a branch, tag or commit
//   node scripts/apidocs/jvm.mjs --only kotlin|java   # one of the two
//   node scripts/apidocs/jvm.mjs --keep               # keep the temp copy (prints its path), for debugging
//
// OPENVIREO_CORE_SRC overrides the core checkout (default ../openvireo-core). Like the TypeDoc step of
// sync-docs.mjs, the ref is `git archive`d into a temp directory and built there, so the checkout is never
// touched. The temp copy's core-jvm/build.gradle.kts gets Dokka and kapt appended (it's thrown away).
//
// Steps, in the temp copy:
//   1. `cargo xtask kotlin --generate-only`: a host debug build of the ov-ffi cdylib, uniffi-bindgen (the
//      generated `com.openvireo.core` Kotlin) and the generated Java facade (`com.openvireo.core.java`).
//      Most of the API only exists after this step, so it needs Rust (the repo's toolchain). Cargo's target
//      directory is kept between runs in OPENVIREO_APIDOCS_CARGO_TARGET (default
//      ~/.cache/openvireo-apidocs/jvm-cargo-target): ~2 min cold, ~30 s warm (the workspace crates rebuild
//      every run, see `tar -m` below; crates.io dependencies stay cached).
//   2. Kotlin view: `./gradlew :core-jvm:dokkaGeneratePublicationHtml` (Dokka, from the Plugin Portal).
//   3. Java view: Dokka's own Java renderings (its Javadoc format, or HTML with kotlin-as-java) print
//      Kotlin types in Java signatures (`Unit`, `ByteArray`, `Boolean`), which is wrong for a Java reader.
//      So instead kapt writes Java stubs of the compiled API (`:core-jvm:kaptGenerateStubsKotlin`: exact Java
//      signatures, getters, statics, `throws`, with the KDoc kept), this script drops the UniFFI/JNA plumbing
//      and internal declarations, turns the KDoc Markdown into Javadoc HTML, and the JDK's `javadoc` renders
//      com.openvireo.core, .hosts and .java.
//   Gradle runs with -Pov.generate=false (step 1 did that) and -Pov.android=false: core-android is left
//   out (it needs an Android SDK; its API is the JVM one plus AndroidLogSink and defaultHost(context)).
//
// Needs: git, Rust (rustup), JDK 17+ for Gradle 9 and javadoc (21 tested), network on the first run
// (Gradle wrapper, Dokka, kapt's dummy processor, and the JDK / kotlinx.coroutines package lists that
// cross-links are built from).

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOKKA_VERSION = '2.3.0';
// kapt only writes stubs when an annotation processor is configured; this one is tiny and does nothing here.
const KAPT_DUMMY_PROCESSOR = 'com.google.auto.service:auto-service:1.1.1';
const SITE = 'https://developer.openvireo.com';
const JDK_API = 'https://docs.oracle.com/en/java/javase/21/docs/api/';

// Throws, so the temp directory is still removed; the handler prints it without a stack.
function fail(message) {
    throw Object.assign(new Error(message), { expected: true });
}
process.on('uncaughtException', (e) => {
    console.error(e.expected ? `error: ${e.message}` : e);
    process.exit(1);
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDirs = { kotlin: join(root, 'public', 'reference', 'kotlin'), java: join(root, 'public', 'reference', 'java') };

let ref = 'origin/develop';
let only = null;
let keep = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--ref') ref = args[++i];
    else if (arg === '--only') only = args[++i];
    else if (arg === '--keep') keep = true;
    else if (arg === '-h' || arg === '--help') {
        console.log('Usage: node scripts/apidocs/jvm.mjs [--ref <ref>] [--only kotlin|java] [--keep]');
        process.exit(0);
    } else fail(`unknown argument ${arg}`);
}
if (!ref) fail('--ref needs a value');
if (only && !outDirs[only]) fail('--only takes kotlin or java');
const formats = only ? [only] : ['kotlin', 'java'];

const repo = resolve(process.env.OPENVIREO_CORE_SRC ?? join(root, '..', 'openvireo-core'));
if (!existsSync(join(repo, '.git'))) fail(`no git checkout of openvireo-core at ${repo} (set OPENVIREO_CORE_SRC)`);
let commit;
try {
    commit = execFileSync('git', ['-C', repo, 'rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {
    fail(`${ref} is not a commit in ${repo}`);
}
const short = commit.slice(0, 12);

const cargoTarget = resolve(process.env.OPENVIREO_APIDOCS_CARGO_TARGET ?? join(homedir(), '.cache', 'openvireo-apidocs', 'jvm-cargo-target'));
mkdirSync(cargoTarget, { recursive: true });

const run = (cmd, cmdArgs, cwd, env = {}) => {
    try {
        execFileSync(cmd, cmdArgs, { cwd, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, ...env } });
    } catch {
        fail(`${cmd} ${cmdArgs.filter((a) => !a.startsWith('-')).join(' ')} failed (output above)`);
    }
};
const seconds = (t) => `${((Date.now() - t) / 1000).toFixed(0)}s`;

const started = Date.now();
const work = mkdtempSync(join(tmpdir(), 'openvireo-core-jvm-'));
try {
    console.log(`JVM API reference: openvireo-core ${ref}@${short} in ${work}`);
    // tar -m: files get the extraction time, not the commit's. Cargo decides what to rebuild by mtime, so with
    // the shared target directory an older ref (older mtimes) would otherwise reuse the last build, and
    // the xtask binary would keep the previous temp dir baked in (its root() is CARGO_MANIFEST_DIR at
    // compile time) and write the generated sources there.
    execFileSync('sh', ['-c', 'git -C "$1" archive "$2" | tar -x -m -C "$3"', 'sh', repo, commit, work]);
    const kotlinDir = join(work, 'bindings', 'kotlin');
    const buildFile = join(kotlinDir, 'core-jvm', 'build.gradle.kts');
    if (!existsSync(buildFile)) fail(`openvireo-core at ${ref} has no bindings/kotlin/core-jvm; pass a newer --ref`);
    // The core's version, unless it's the unreleased 0.0.0 placeholder (its v* tags are the SDK's).
    const cargoVersion = /\[workspace\.package\][^[]*?^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(work, 'Cargo.toml'), 'utf8'))?.[1];
    const docsVersion = cargoVersion && cargoVersion !== '0.0.0' ? cargoVersion : short;

    // 1. Generated sources: the UniFFI Kotlin and the Java facade.
    let t = Date.now();
    console.log('\n[1/3] cargo xtask kotlin --generate-only (host ov-ffi, uniffi-bindgen, Java facade)…');
    run('cargo', ['xtask', 'kotlin', '--generate-only'], work, { CARGO_TARGET_DIR: cargoTarget });
    for (const d of ['generated/uniffi/kotlin/com/openvireo/core/ov_ffi.kt', 'generated/facade/kotlin']) {
        if (!existsSync(join(kotlinDir, 'build', d))) fail(`the xtask wrote no build/${d} in the temp copy`);
    }
    console.log(`  done in ${seconds(t)}`);

    // 2. Gradle: Dokka (Kotlin view) and kapt stubs + compile classpath (Java view), in one run.
    writeFileSync(join(kotlinDir, 'build', 'dokka-module.md'), moduleDoc());
    patchBuildFile(buildFile);
    const tasks = [];
    if (formats.includes('kotlin')) tasks.push(':core-jvm:dokkaGeneratePublicationHtml');
    if (formats.includes('java')) tasks.push(':core-jvm:kaptGenerateStubsKotlin', ':core-jvm:ovDocsClasspath');
    t = Date.now();
    console.log(`\n[2/3] Gradle: ${tasks.join(' ')}…`);
    run('./gradlew', [
        '--no-daemon', '--console=plain', '--warning-mode=none', '-q',
        '-Pov.generate=false', '-Pov.android=false',
        `-Pov.docsCommit=${commit}`, `-Pov.docsVersion=${docsVersion}`,
        ...tasks,
    ], kotlinDir);
    console.log(`  done in ${seconds(t)}`);

    // 3. The Java view, then copy both into public/.
    const outputs = {};
    if (formats.includes('kotlin')) outputs.kotlin = join(kotlinDir, 'core-jvm', 'build', 'dokka', 'html');
    if (formats.includes('java')) {
        t = Date.now();
        console.log('\n[3/3] javadoc over the kapt stubs…');
        outputs.java = buildJavadoc(kotlinDir, docsVersion);
        console.log(`  done in ${seconds(t)}`);
    }
    console.log('\nCopying into public/reference/…');
    for (const f of formats) {
        const from = outputs[f];
        if (!existsSync(join(from, 'index.html'))) fail(`no ${from}/index.html`);
        rmSync(outDirs[f], { recursive: true, force: true });
        mkdirSync(dirname(outDirs[f]), { recursive: true });
        cpSync(from, outDirs[f], { recursive: true });
        const { files, bytes } = tally(outDirs[f]);
        const html = tally(outDirs[f], '.html').files;
        console.log(`  ${f}: ${html} pages, ${files} files, ${(bytes / 1048576).toFixed(1)} MB in public/reference/${f}/`);
    }
    console.log(`\nDone in ${seconds(started)}. Entry points: /reference/kotlin/, /reference/java/`);
} finally {
    if (keep) console.log(`Kept ${work}`);
    else rmSync(work, { recursive: true, force: true });
}

/** Adds Dokka, kapt and a classpath task to core-jvm/build.gradle.kts (in the temp copy). */
function patchBuildFile(file) {
    let text = readFileSync(file, 'utf8');
    if (!/^plugins \{$/m.test(text)) fail(`${file}: no top-level plugins { } block to add Dokka to`);
    text = text.replace(/^plugins \{$/m, `plugins {\n    id("org.jetbrains.dokka") version "${DOKKA_VERSION}"\n    id("org.jetbrains.kotlin.kapt")`);
    text += `
// ---- Added by openvireo-developer/scripts/apidocs/jvm.mjs (throwaway copy) ----
val ovDocsCommit = providers.gradleProperty("ov.docsCommit").get()
val ovDocsVersion = providers.gradleProperty("ov.docsVersion").get()
dependencies { "kapt"("${KAPT_DUMMY_PROCESSOR}") }
tasks.register("ovDocsClasspath") {
    val cp: FileCollection = configurations.getByName("compileClasspath")
    val out: File = layout.buildDirectory.file("ov-docs-classpath.txt").get().asFile
    inputs.files(cp)
    outputs.file(out)
    doLast { out.writeText(cp.files.joinToString(File.pathSeparator)) }
}
dokka {
    moduleName.set("openvireo-core-jvm")
    moduleVersion.set(ovDocsVersion)
    dokkaSourceSets.configureEach {
        includes.from(rootProject.layout.buildDirectory.file("dokka-module.md"))
        jdkVersion.set(11)
        reportUndocumented.set(false)
        skipEmptyPackages.set(true)
        // Hand-written sources link to GitHub; the generated ones (build/generated) aren't in the repo.
        sourceLink {
            localDirectory.set(rootDir.resolve("shared/src/main/kotlin"))
            remoteUrl("https://github.com/openvireo/openvireo-core/blob/$ovDocsCommit/bindings/kotlin/shared/src/main/kotlin")
            remoteLineSuffix.set("#L")
        }
        sourceLink {
            localDirectory.set(projectDir.resolve("src/main/kotlin"))
            remoteUrl("https://github.com/openvireo/openvireo-core/blob/$ovDocsCommit/bindings/kotlin/core-jvm/src/main/kotlin")
            remoteLineSuffix.set("#L")
        }
        externalDocumentationLinks.register("kotlinx.coroutines") {
            url("https://kotlinlang.org/api/kotlinx.coroutines/")
            packageListUrl("https://kotlinlang.org/api/kotlinx.coroutines/package-list")
        }
    }
    pluginsConfiguration.html {
        footerMessage.set("OpenVireo core, <a href=\\"https://github.com/openvireo/openvireo-core/tree/$ovDocsCommit\\">\${ovDocsCommit.take(12)}</a> &middot; <a href=\\"${SITE}/bindings/kotlin-java/\\">Kotlin and Java guide</a> &middot; <a href=\\"/reference/java/\\">Java reference</a> &middot; MIT OR Apache-2.0")
        homepageLink.set("${SITE}/bindings/kotlin-java/")
    }
}
`;
    writeFileSync(file, text);
}

// Package descriptions, shared by both views.
function packageDocs() {
    return {
    'com.openvireo.core': `The binding itself, generated by UniFFI from the \`ov-ffi\` crate: \`OvClient\`, \`Account\`, \`Vault\`,
\`ServiceAccount\`, \`SelfHosted\`, the records and enums they take and return, the Host interfaces
(\`HttpTransport\`, \`SecureStore\`, \`BlobCache\`, \`Clock\`, \`LogSink\`), \`OvException\` and the free
functions (crypto, share links, TOTP, OPAQUE). Network and disk calls are \`suspend\` functions; from Java,
use the wrappers in \`com.openvireo.core.java\`.`,
    'com.openvireo.core.hosts': `Ready-made Host parts and \`defaultHost(...)\`, so a program needs no glue: \`JavaNetHttpTransport\`,
\`UrlConnectionTransport\`, \`MemoryStore\`, \`FileCache\`, \`MemoryCache\`, \`SystemClock\`, \`JulLogSink\`.`,
    'com.openvireo.core.java': `The API for Java, without coroutines: \`J<Object>\` wrappers (\`JOvClient\`, \`JAccount\`, \`JVault\`, ...)
whose \`suspend\` methods return \`CompletableFuture\`, \`JOv\` (every free function as a static), \`JRecords\`
(records with unsigned fields), \`JErrors\`, and the future-based Host interfaces with \`JHosts\` and
\`JDefaultHosts\`. Generated from the binding on every build, so it can't drift from it.`,
};
}

/** The module and package pages for Dokka (its includes format). */
function moduleDoc() {
    return `# Module openvireo-core-jvm

The OpenVireo core for Kotlin and Java 11+ on macOS, Linux and Windows (\`com.openvireo:openvireo-core-jvm\`):
accounts, vaults, sync, share links and \`.kdbx\` files, on the same Rust code as the OpenVireo apps.

Start with the guide: [Kotlin and Java](${SITE}/bindings/kotlin-java/). This reference is generated from
openvireo-core at commit \`${commit}\`. Calling it from Java? See the [Java reference](/reference/java/).

${Object.entries(packageDocs()).map(([name, text]) => `# Package ${name}\n\n${text}\n`).join('\n')}`;
}

// ---- Java view ---------------------------------------------------------------------------------

/**
 * Turns kapt's stubs into the Java reference: picks the public API, converts the KDoc, runs javadoc.
 * Returns the output directory.
 */
function buildJavadoc(kotlinDir, docsVersion) {
    const stubs = join(kotlinDir, 'core-jvm', 'build', 'tmp', 'kapt3', 'stubs', 'main');
    if (!existsSync(join(stubs, 'com', 'openvireo', 'core'))) fail(`kapt wrote no stubs in ${stubs}`);
    const classpath = readFileSync(join(kotlinDir, 'core-jvm', 'build', 'ov-docs-classpath.txt'), 'utf8').trim();

    const hidden = hiddenDeclarations([
        join(kotlinDir, 'build', 'generated'),
        join(kotlinDir, 'shared', 'src', 'main', 'kotlin'),
        join(kotlinDir, 'core-jvm', 'src', 'main', 'kotlin'),
    ]);

    // Every stub goes on the sourcepath (so signatures resolve); only the public API is documented.
    const src = join(kotlinDir, 'build', 'javadoc-src');
    rmSync(src, { recursive: true, force: true });
    const documented = [];
    let skipped = 0;
    for (const name of readdirSync(stubs, { recursive: true })) {
        if (!name.endsWith('.java')) continue;
        const rel = name.split(sep).join('/');
        let text = readFileSync(join(stubs, name), 'utf8');
        const cls = rel.slice(rel.lastIndexOf('/') + 1, -'.java'.length);
        const show = rel.startsWith('com/openvireo/core/') && !hiddenClass(cls, hidden);
        text = cleanStub(text, show ? hidden : null);
        if (show && !/^\s+(public|protected) /m.test(text.replace(/\/\*\*[\s\S]*?\*\//g, ''))) {
            // A file-facade class (FooKt) whose members were all internal.
            skipped++;
        } else if (show) {
            documented.push(join(src, name));
        } else skipped++;
        mkdirSync(dirname(join(src, name)), { recursive: true });
        writeFileSync(join(src, name), text);
    }
    for (const [pkg, text] of Object.entries(packageDocs())) {
        const dir = join(src, ...pkg.split('.'));
        if (existsSync(dir)) writeFileSync(join(dir, 'package-info.java'), `/**\n${javadocBody(text, ' * ')}\n */\npackage ${pkg};\n`);
        documented.push(join(dir, 'package-info.java'));
    }
    writeFileSync(join(src, 'overview.html'), `<!DOCTYPE html><html><head><title>Overview</title></head><body>
<p>The OpenVireo core for Java 11+ on macOS, Linux and Windows (<code>com.openvireo:openvireo-core-jvm</code>):
accounts, vaults, sync, share links and <code>.kdbx</code> files, on the same Rust code as the OpenVireo apps.</p>
<p>From Java, start with <code>com.openvireo.core.java</code>: <code>JOvClient</code>, <code>JAccount</code>, <code>JVault</code>
return <code>CompletableFuture</code>s, and <code>JOv</code> has the free functions. The records, enums and errors they take
and return are in <code>com.openvireo.core</code>. Guide: <a href="${SITE}/bindings/kotlin-java/">Kotlin and Java</a>.
The same API in Kotlin: <a href="/reference/kotlin/">Kotlin reference</a>.</p>
<p>Generated from openvireo-core at commit <code>${commit}</code>.</p>
</body></html>
`);
    console.log(`  ${documented.length} files documented, ${skipped} stubs left out (UniFFI/JNA plumbing, internal)`);

    const out = join(kotlinDir, 'build', 'javadoc-out');
    rmSync(out, { recursive: true, force: true });
    const argfile = join(kotlinDir, 'build', 'javadoc.args');
    const q = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    writeFileSync(argfile, [
        '-d', out,
        '-sourcepath', src,
        '-classpath', classpath,
        '-encoding', 'UTF-8', '-docencoding', 'UTF-8', '-charset', 'UTF-8',
        '--release', '11',
        '-public', '-quiet', '-notimestamp', '-Xdoclint:none', '-Xmaxwarns', '1',
        '-windowtitle', `OpenVireo core for Java ${docsVersion}`,
        '-doctitle', `OpenVireo core for Java <small>(${docsVersion})</small>`,
        '-overview', join(src, 'overview.html'),
        '-bottom', `OpenVireo core, <a href="https://github.com/openvireo/openvireo-core/tree/${commit}">${short}</a> &middot; <a href="${SITE}/bindings/kotlin-java/">Kotlin and Java guide</a> &middot; <a href="/reference/kotlin/">Kotlin reference</a> &middot; MIT OR Apache-2.0`,
        '-link', JDK_API,
        '-group', 'Java API', 'com.openvireo.core.java',
        '-group', 'Generated binding and hosts', 'com.openvireo.core:com.openvireo.core.hosts',
        // KDoc tags javadoc doesn't know: accepted, not printed.
        ...['suppress', 'property', 'constructor', 'sample', 'receiver'].flatMap((tag) => ['-tag', `${tag}:X`]),
        ...documented,
    ].map(q).join('\n'));
    try {
        execFileSync('javadoc', [`@${argfile}`], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
        const lines = `${e.stdout ?? ''}${e.stderr ?? ''}`.split('\n').filter((l) => /error:/.test(l));
        console.error(lines.slice(0, 30).join('\n'));
        fail(`javadoc failed (${lines.length} errors)`);
    }
    // JDK 21's stylesheet imports DejaVu fonts it no longer ships (a 404 on every page); system fonts are fine.
    const css = join(out, 'stylesheet.css');
    writeFileSync(css, readFileSync(css, 'utf8').replace(/^@import url\('resources\/fonts\/dejavu\.css'\);?\n?/m, ''));
    return out;
}

/**
 * Names the Java reference leaves out, read from the Kotlin sources: top-level `internal` declarations
 * (public in bytecode, so kapt stubs and javadoc would show them) and top-level types or functions whose
 * KDoc says `@suppress` (UniFFI marks its plumbing so).
 */
function hiddenDeclarations(dirs) {
    const types = new Set();
    const members = new Set();
    const decl = /^((?:\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*)?)((?:@[\w.]+(?:\([^)\n]*\))?\s+)*)((?:(?:public|internal|private|open|abstract|sealed|data|enum|annotation|inline|value|const|suspend|fun(?= interface))\s+)*)(class|object|interface|fun|val|var)\s+(?:<[^>\n]*>\s*)?(?:[\w.]+(?:<[^>\n]*>)?\??\.)?`?(\w+)`?/gm;
    for (const dir of dirs) {
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir, { recursive: true })) {
            if (!name.endsWith('.kt')) continue;
            const text = readFileSync(join(dir, name), 'utf8');
            for (const m of text.matchAll(decl)) {
                const [, doc, , mods, kind, id] = m;
                const hide = /\binternal\b/.test(mods) || /@suppress\b/.test(doc);
                if (!hide) continue;
                if (kind === 'fun' || kind === 'val' || kind === 'var') members.add(id);
                else types.add(id);
            }
        }
    }
    return { types, members };
}

/** UniFFI/JNA plumbing by name, on top of what the sources mark. */
function hiddenClass(cls, hidden) {
    const outer = cls.split('.')[0];
    return hidden.types.has(outer)
        || /^(FfiConverter|Uniffi|uniffi|RustBuffer|ForeignBytes|IntegrityChecking|JavaLangRefClean|InternalException$|NoHandle$|Disposable$)/.test(outer)
        // The generated file's facade: its public functions are all on JOv, the rest is plumbing.
        || outer === 'Ov_ffiKt';
}

/**
 * One kapt stub, cleaned up for javadoc: no Kotlin metadata, no `@NotNull` noise, KDoc as Javadoc HTML,
 * and (for documented classes) no members marked `@suppress` or declared `internal`.
 */
function cleanStub(text, hidden) {
    text = text.replace(/^\s*@kotlin\.Metadata\(.*\)\s*$\n?/gm, '');
    text = text.replace(/^\s*@kotlin\.jvm\.JvmName\(.*\)\s*$\n?/gm, ''); // kapt puts @file:JvmName on the class
    text = text.replace(/\b([A-Z]\w*)\$([A-Z]\w*)\b/g, '$1.$2'); // nested JDK types: Flow$Publisher
    text = text.replace(/\$this\$\w+/g, 'receiver'); // extension receivers
    text = text.replace(/\$completion\b/g, 'continuation'); // suspend functions, as Java sees them
    text = text.replace(/@org\.jetbrains\.annotations\.NotNull\(\)\s*/g, '');
    text = text.replace(/@org\.jetbrains\.annotations\.Nullable\(\)/g, '@org.jetbrains.annotations.Nullable');
    if (hidden) {
        // A member: its Javadoc, annotations, then a field (`= ...;`), an abstract method (`;`) or a method or
        // constructor with a brace-free body (all kapt writes). Nested classes don't match and stay.
        const member = /^(?=([ \t]+)\S)((?:\1\/\*\*(?:(?!\*\/)[\s\S])*\*\/[ \t]*\n)?)((?:\1@[\w.]+(?:\([^)]*\))?[ \t]*\n)*)\1(?:public|protected)\b([^;{=(]*?)\b([\w$]+)(?:\s*\([^{;]*?\)(?:\s*throws\s+[\w.,\s]+?)?\s*(?:;|\{[^{}]*\})|\s*(?:=[^;]*)?;)[ \t]*\n/gm;
        text = text.replace(member, (all, indent, doc = '', annotations, head, name) => {
            // A suppressed constructor turns private rather than vanishing, or javadoc would invent a public
            // no-argument one.
            if (/@suppress\b/.test(doc)) return head.trim() ? '' : all.replace(/\bpublic\b/, 'private');
            if (name.includes('$')) return ''; // a mangled `internal` member
            if (/^component\d+$/.test(name)) return ''; // data-class destructuring, for Kotlin only
            // Top-level `internal` functions and vals land, unmangled, as statics on the file's FooKt class.
            if (/\bstatic\b/.test(head) && hidden.members.has(name)) return '';
            return all;
        });
        // Nested objects to drop: UniFFI's empty `companion object`s, and objects that are plumbing (an
        // exception's `ErrorHandler`). Their singleton fields go too.
        const dropped = [];
        // (Two patterns, each naming only what it drops, so a kept outer class never hides a nested match.)
        text = text.replace(/^([ \t]+)public static final class Companion \{\n([\s\S]*?)^\1\}\n/gm, (all, indent, body) => {
            if (/\bpublic\b/.test(body)) return all;
            dropped.push('Companion');
            return '';
        });
        text = text.replace(/^([ \t]+)public static final class (\w+)[^{\n]*com\.openvireo\.core\.(?:Uniffi|FfiConverter)[^{\n]*\{\n[\s\S]*?^\1\}\n/gm, (all, indent, name) => {
            dropped.push(name);
            return '';
        });
        for (const name of dropped) {
            text = text.replace(new RegExp(`^[ \\t]+public static final [\\w.]+\\.${name} ${name} = null;\\n`, 'gm'), '');
        }
    }
    text = text.replace(/(\bset\w*\((?:@[\w.]+\s*)?[\w.<>[\], ]+?\s)p0\)/g, '$1value)'); // kapt names setter parameters p0
    // KDoc → Javadoc, comment by comment.
    return text.replace(/\/\*\*([\s\S]*?)\*\//g, (_, body) => {
        const indent = '';
        const lines = body.split('\n').map((l) => l.replace(/^\s*\* ?/, ''));
        const md = lines.join('\n').trim();
        return `/**\n${javadocBody(md, `${indent} * `)}\n */`;
    });
}

/** KDoc Markdown → Javadoc HTML (block tags kept), each line prefixed. */
function javadocBody(md, prefix) {
    const tagStart = md.search(/^@\w+/m);
    const main = tagStart === -1 ? md : md.slice(0, tagStart);
    const tags = tagStart === -1 ? '' : md.slice(tagStart);
    const html = [markdownToHtml(main.trim())];
    for (const block of tags.split(/\n(?=@\w+)/)) {
        if (!block.trim()) continue;
        const m = /^@(\w+)\s*([\s\S]*)$/.exec(block.trim());
        const [, tag, rest] = m;
        if (['param', 'throws', 'exception'].includes(tag)) {
            const sp = /^(\S+)\s*([\s\S]*)$/.exec(rest);
            html.push(`@${tag} ${sp ? `${sp[1]} ${inline(sp[2])}` : ''}`);
        } else if (['return', 'since', 'deprecated'].includes(tag)) html.push(`@${tag} ${inline(rest)}`);
        else if (tag === 'see') html.push(`@see ${linkTarget(rest.trim().replace(/^\[|\]$/g, ''))}`);
        else html.push(`@${tag} ${inline(rest)}`); // disabled with -tag <name>:X
    }
    return html.filter(Boolean).join('\n').replace(/\*\//g, '*&#47;').split('\n').map((l) => `${prefix}${l}`.trimEnd()).join('\n');
}

function markdownToHtml(md) {
    if (!md) return '';
    const out = [];
    const blocks = md.split(/\n```/);
    // Even indices are prose, odd are fenced code (```lang\n...\n).
    blocks.forEach((block, i) => {
        if (i % 2 === 1) {
            const code = block.replace(/^[^\n]*\n/, '').replace(/\n?$/, '');
            out.push(`<pre>${escape(code).replace(/@/g, '&#64;')}</pre>`);
            return;
        }
        if (i > 0) block = block.replace(/^\s*\n/, '');
        for (const para of block.split(/\n\s*\n/)) {
            const p = para.trim();
            if (!p) continue;
            if (/^[-*] /.test(p)) {
                const items = p.split(/\n(?=[-*] )/).map((it) => `<li>${inline(it.replace(/^[-*] /, ''))}</li>`);
                out.push(`<ul>\n${items.join('\n')}\n</ul>`);
            } else if (/^\d+\. /.test(p)) {
                const items = p.split(/\n(?=\d+\. )/).map((it) => `<li>${inline(it.replace(/^\d+\. /, ''))}</li>`);
                out.push(`<ol>\n${items.join('\n')}\n</ol>`);
            } else if (/^\|/.test(p)) {
                out.push(`<pre>${escape(p)}</pre>`);
            } else out.push(out.length ? `<p>${inline(p)}` : inline(p));
        }
    });
    return out.join('\n');
}

/** Inline Markdown: code spans, KDoc links, Markdown links, emphasis. HTML-escapes the rest. */
function inline(text) {
    const parts = text.split(/(`[^`]+`)/);
    return parts.map((part, i) => {
        if (i % 2 === 1) return `<code>${escape(part.slice(1, -1)).replace(/@/g, '&#64;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')}</code>`;
        let s = escape(part).replace(/@/g, '&#64;');
        s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label, url) => `<a href="${url}">${label}</a>`);
        s = s.replace(/\[([^\]\n]+)\]\[([\w.]+)\]/g, (_, label, target) => `<code>${label}</code>`);
        s = s.replace(/\[([\w.]+)\](?![(\[])/g, (_, target) => {
            // KDoc links to types and members become {@link}; a bare lowercase name may be a property (whose
            // Java name is a getter), so it stays code.
            const m = /^((?:[a-z]\w*\.)*[A-Z]\w*(?:\.[A-Z]\w*)*)(?:\.([a-z]\w*))?$/.exec(target);
            const label = target.replace(/^com\.openvireo\.core\.(java\.|hosts\.)?/, '');
            if (!m) return `<code>${label}</code>`;
            return `{@link ${m[1]}${m[2] ? `#${m[2]}` : ''} ${label}}`;
        });
        s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:)]|$)/g, '$1<i>$2</i>');
        return s;
    }).join('');
}

function linkTarget(target) {
    return target.replace(/\.([a-z]\w*)$/, '#$1');
}

function escape(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tally(dir, ext) {
    let files = 0;
    let bytes = 0;
    for (const name of readdirSync(dir, { recursive: true })) {
        const p = join(dir, name);
        const s = statSync(p);
        if (!s.isFile() || (ext && !name.endsWith(ext))) continue;
        files++;
        bytes += s.size;
    }
    return { files, bytes };
}
