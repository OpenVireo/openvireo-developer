/** Task guides, shown on the home page (first six) and /guides/. Each links to a synced docs page. */
export const guides = [
	{ tag: 'CI/CD', title: 'Load secrets into GitHub Actions', summary: 'Use a service account and the GitHub Action to load and mask secrets in a workflow.', href: '/cli/github-action/' },
	{ tag: 'Kubernetes', title: 'Serve secrets with ov connect', summary: 'Run a REST server for one service account inside your cluster, with ready manifests.', href: '/cli/connect/' },
	{ tag: 'Self-hosting', title: 'Run your own sync server', summary: 'Install, configure and pair devices with a sync server you operate.', href: '/self-hosting/install/' },
	{ tag: 'Sharing', title: 'Create no-login share links', summary: 'Share one item or field, with an expiry, a passcode or a single view.', href: '/sdk/guides/share-links/' },
	{ tag: 'Apps', title: 'Work offline', summary: 'Keep working without the network, and catch up afterwards.', href: '/sdk/guides/offline/' },
	{ tag: 'Upgrading', title: 'Migrate to SDK 1.0', summary: 'What changed in 1.0, on the shared Rust core, and how to upgrade.', href: '/sdk/reference/migrating-to-1.0/' },
	{ tag: 'Automation', title: 'Service accounts', summary: 'Secrets for CI, servers and long-running processes, without a password.', href: '/sdk/guides/service-accounts/' },
	{ tag: 'Scripts', title: 'Inject secrets into config files', summary: 'Fill templates and environment variables from ov:// references with ov inject and ov run.', href: '/cli/' },
	{ tag: 'Apps', title: 'React to changes', summary: 'Subscribe to events from other devices and to access changes.', href: '/sdk/guides/events/' },
	{ tag: 'Migration', title: 'Turn a .kdbx into a vault', summary: 'Move an existing KeePass database into an account vault.', href: '/sdk/guides/move-to-account/' },
	{ tag: 'Python', title: 'Use the core from Python', summary: 'Install the openvireo package, sign in, open vaults and sync.', href: '/bindings/python/' },
	{ tag: 'Rust', title: 'Use the core from Rust', summary: 'Depend on openvireo-core, write a Host, sign in and open vaults.', href: '/bindings/rust/' },
	{ tag: 'Kotlin / Java', title: 'Use the core on the JVM and Android', summary: 'Add the Maven Central artifact, sign in and open vaults from Kotlin or Java.', href: '/bindings/kotlin-java/' },
	{ tag: 'C++', title: 'Use the core from C++', summary: 'Link the libovcore CMake package from a release, write a Host and sign in.', href: '/bindings/cpp/' },
	{ tag: 'Swift', title: 'Use the core from Swift', summary: 'Add the openvireo-swift package to an iOS or macOS app and call the core.', href: '/bindings/swift/' },
	{ tag: 'Testing', title: 'Test against in-memory servers', summary: 'Run your integration tests without a network or real accounts.', href: '/sdk/guides/testing/' },
];
