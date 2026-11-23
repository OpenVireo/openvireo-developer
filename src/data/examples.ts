/**
 * The runnable example repos, one per language (github.com/openvireo/openvireo-examples-<lang>), and
 * which file in each holds the code of each guide. Shown on /guides/examples/ (written by scripts/examples-page.ts: run npm run examples-page after a change), in the "Runnable
 * examples" strip under the title of each guide page (PageTitle.astro) and on the home page.
 */

/** A guide that has examples, by its page path, and the example's name in the repos. */
export const exampleGuides = [
	{ slug: 'first-program', title: 'A first program', href: '/sdk/' },
	{ slug: 'hosted-account', title: 'Hosted accounts', href: '/sdk/guides/hosted-account/' },
	{ slug: 'vaults-and-sharing', title: 'Vaults and sharing', href: '/sdk/guides/vaults-and-sharing/' },
	{ slug: 'events', title: 'Events', href: '/sdk/guides/events/' },
	{ slug: 'offline', title: 'Offline', href: '/sdk/guides/offline/' },
	{ slug: 'move-to-account', title: 'Moving to an account', href: '/sdk/guides/move-to-account/' },
	{ slug: 'recovery', title: 'Recovery', href: '/sdk/guides/recovery/' },
	{ slug: 'self-hosted-sync', title: 'Self-hosted sync', href: '/sdk/guides/self-hosted-sync/' },
	{ slug: 'service-accounts', title: 'Service accounts', href: '/sdk/guides/service-accounts/' },
	{ slug: 'share-links', title: 'Share links', href: '/sdk/guides/share-links/' },
] as const;

export type ExampleSlug = (typeof exampleGuides)[number]['slug'];

const pascal = (slug: string) => slug.split('-').map((p) => p[0]!.toUpperCase() + p.slice(1)).join('');
const kotlinPackage: Record<string, string> = { 'vaults-and-sharing': 'vaults', 'self-hosted-sync': 'selfhosted' };

export interface ExampleLanguage {
	label: string;
	repo: string;
	/** What you need, in a few words. */
	needs: string;
	/** The command that runs the first program. */
	run: string;
	/** The file for a guide, relative to the repo root; null when the language has none for it. */
	file: (slug: ExampleSlug) => string | null;
}

const cliScripts: Partial<Record<ExampleSlug, string>> = {
	'first-program': 'examples/first-program.sh',
	'hosted-account': 'examples/hosted-account.sh',
	'vaults-and-sharing': 'examples/vaults-and-sharing.sh',
	'service-accounts': 'examples/service-accounts.sh',
	'share-links': 'examples/share-links.sh',
};

export const exampleLanguages: ExampleLanguage[] = [
	{
		label: 'TypeScript',
		repo: 'openvireo-examples-typescript',
		needs: 'Node 22.18+, a GitHub token for GitHub Packages',
		run: 'npm run example -- first-program',
		file: (s) => `examples/${s}.ts`,
	},
	{
		label: 'Python',
		repo: 'openvireo-examples-python',
		needs: 'Python 3.10+ and uv',
		run: 'uv run examples/first_program.py',
		file: (s) => `examples/${s.replaceAll('-', '_')}.py`,
	},
	{
		label: 'Kotlin',
		repo: 'openvireo-examples-kotlin',
		needs: 'JDK 21',
		run: './gradlew run --args="first-program"',
		file: (s) => `src/main/kotlin/examples/${kotlinPackage[s] ?? s.replaceAll('-', '')}/${pascal(s)}.kt`,
	},
	{
		label: 'Java',
		repo: 'openvireo-examples-java',
		needs: 'JDK 21',
		run: './gradlew run --args="first-program"',
		file: (s) => `src/main/java/examples/${pascal(s)}.java`,
	},
	{
		label: 'Swift',
		repo: 'openvireo-examples-swift',
		needs: 'macOS 13+ and Xcode 16',
		run: 'swift run Examples first-program',
		file: (s) => `Sources/Examples/${pascal(s)}.swift`,
	},
	{
		label: 'C++',
		repo: 'openvireo-examples-cpp',
		needs: 'CMake 3.21+, a C++17 compiler, libcurl',
		run: 'build/examples first-program',
		file: (s) => `src/${s.replaceAll('-', '_')}.cpp`,
	},
	{
		label: 'ov CLI',
		repo: 'openvireo-examples-cli',
		needs: 'ov (scripts/install-ov.sh)',
		run: './examples/first-program.sh you@example.com',
		file: (s) => cliScripts[s] ?? null,
	},
];

export const repoUrl = (lang: ExampleLanguage) => `https://github.com/openvireo/${lang.repo}`;
export const fileUrl = (lang: ExampleLanguage, path: string) => `${repoUrl(lang)}/blob/main/${path}`;

/** The guide a page shows, by its path. */
export const exampleGuideFor = (pathname: string) => exampleGuides.find((g) => g.href === pathname);

/** Pages about one language that link to that language's repo. */
export const languagePages: Record<string, string[]> = {
	'/bindings/python/': ['Python'],
	'/bindings/kotlin-java/': ['Kotlin', 'Java'],
	'/cli/': ['ov CLI'],
	'/bindings/': ['Python', 'Kotlin', 'Java', 'Swift', 'C++'],
};
