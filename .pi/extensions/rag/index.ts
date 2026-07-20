/**
 * The documentation search extension was replaced by scripts/docs-search.mjs.
 *
 * This no-op module remains so pi installations that auto-discover existing
 * extension paths do not try to load the old Pi-specific implementation.
 * Use `node scripts/docs-search.mjs --query "..."` (or docs-search.cmd on
 * Windows) from the repository root instead.
 */
export default function docsSearchExtensionRemoved() {
  // Intentionally empty: documentation search is now a standalone CLI.
}
