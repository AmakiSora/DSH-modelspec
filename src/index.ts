/**
 * Model specs panel plugin, node half. The browser half in `src/client/` owns
 * the whole feature: it reads the models.dev catalog from the address that
 * service publishes with open CORS, so no Host service or Remote is needed and
 * the package installs into any profile as one browser row.
 */

/** Host plugin body — the whole feature ships through `exports["./client"]`. */
export function apply(): void {}
