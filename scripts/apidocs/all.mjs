#!/usr/bin/env node
// Regenerates every language's API reference into public/reference/<lang>/ from one openvireo-core ref.
//   npm run apidocs                       # origin/develop
//   npm run apidocs -- --ref v1.2.0
// Needs: Rust (the core's pinned toolchain), JDK 17+, uv or Python 3.10+, Doxygen, and macOS + Xcode for Swift
// (pass --skip swift elsewhere). TypeScript's TypeDoc reference is built by `npm run sync` instead.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const ref = args.includes('--ref') ? ['--ref', args[args.indexOf('--ref') + 1]] : [];
const skip = new Set(args.includes('--skip') ? args[args.indexOf('--skip') + 1].split(',') : []);

for (const lang of ['rust', 'jvm', 'swift', 'python', 'cpp']) {
	if (skip.has(lang)) continue;
	console.log(`\n== ${lang} ==`);
	execFileSync('node', [join(here, `${lang}.mjs`), ...ref], { stdio: 'inherit' });
}
