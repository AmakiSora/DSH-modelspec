/**
 * Reading what the deployment configured. One settings namespace view and one
 * provider directory entry produce the route rows the panel renders, before
 * any catalog answer is involved.
 */

import type { LlmConfigurableProvider, SettingsDescribeValue, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsDevModality } from './types.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** The two field names a DSH model entry stores its accepted modalities under. */
export type ModalityField = 'input' | 'inputModalities'

/** One configured model entry, as the effective settings value resolved it. */
export interface ConfiguredModel {
  /** Position of the entry in the namespace's model array, which is its write address. */
  readonly index: number
  /** Model id the provider accepts. */
  readonly id: string
  /** Display name, when the entry declares one. */
  readonly name?: string
  /** Configured combined context, when the entry declares one. */
  readonly contextWindow?: number
  /** Configured output cap, when the entry declares one. */
  readonly maxTokens?: number
  /** Accepted modalities the entry declares; empty means the route inherits them. */
  readonly inputModalities: readonly ModelsDevModality[]
  /** Field name this namespace family stores modalities under; absent when the entry declares neither one. */
  readonly modalityField?: ModalityField
}

/** One provider route and the models its settings namespace declares. */
export interface ConfiguredRoute {
  /** Settings namespace that owns the route. */
  readonly settingsNs: string
  /** Provider route key the deployment configured. */
  readonly provider: string
  /** Product name the directory publishes for the route. */
  readonly displayName: string
  /** Path from the namespace root to the route profile; empty when the section is the profile. */
  readonly settingsPath: readonly string[]
  /**
   * Endpoint the route's models live at, when its profile declares one.
   * A route the adapter's own catalog describes needs none; a gateway or a
   * self-hosted server is the one that declares it, and the only one whose
   * models have to be asked for over the wire.
   */
  readonly baseURL?: string
  /** Wire protocol the route speaks, when its profile declares one. */
  readonly api?: string
  /** Namespace revision every write carries. */
  readonly revision: number
  /**
   * Length of the user layer's own `models` array, entries this panel could not
   * read included. Appending addresses the first index past this length, so it
   * is that array's length rather than the number of rows shown — and that array
   * rather than the resolved one, because the edit lands on the user layer.
   */
  readonly arrayLength: number
  /**
   * Whether the adapter ships this route instead of the deployment declaring
   * it. The directory answers this per adapter: pi-ai marks a route `declared`
   * only when configuration introduced it, and the native DeepSeek adapters
   * leave the field off for the two routes they bring themselves. Anything but
   * `declared: true` is a preset, which the panel compares but never writes.
   */
  readonly preset: boolean
  /** Configuration diagnostic the directory reports for this route. */
  readonly error?: string
  /** Configured models in namespace order. */
  readonly models: readonly ConfiguredModel[]
}

/** Narrow one JSON value to an object whose members can be addressed. */
function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : undefined
}

/** Read one path-addressed member, or `undefined` when the path leaves the document. */
function atPath(root: JsonValue | undefined, path: readonly string[]): JsonValue | undefined {
  let current: JsonValue | undefined = root
  for (const segment of path) {
    current = asRecord(current)?.[segment]
    if (current === undefined) return undefined
  }
  return current
}

/** Keep only a positive integer capacity, matching what both adapters accept. */
function capacity(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** Keep only a non-empty string, the shape both endpoint facts are declared in. */
function text(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** The endpoint facts a route profile declares, when it declares any. */
interface RouteEndpoint {
  /** Endpoint this route's models live at. */
  readonly baseURL?: string
  /** Wire protocol this route speaks. */
  readonly api?: string
}

/**
 * Read the endpoint one route profile declares.
 *
 * Both fields belong to the adapter rather than to this panel, and both are
 * optional: an adapter answers for a route its own catalog describes without
 * reaching the network at all. This reads them so the panel can hand its
 * interrogation the same facts the route itself is configured with.
 */
function routeEndpoint(profile: JsonValue | undefined): RouteEndpoint {
  const record = asRecord(profile)
  const baseURL = text(record?.['baseURL'])
  const api = text(record?.['api'])
  return {
    ...baseURL === undefined ? {} : { baseURL },
    ...api === undefined ? {} : { api },
  }
}

/** Keep only the modalities a DSH model entry can declare. */
function modalities(value: JsonValue | undefined): ModelsDevModality[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
    .filter((entry): entry is ModelsDevModality => entry === 'text' || entry === 'image')
}

/**
 * Name the field one model entry stores modalities under.
 *
 * Both families materialize the field while the settings value resolves, so the
 * resolved entry names its own family: the Messages adapter defaults to
 * `['text']` under `inputModalities` and the pi-ai adapter to `[]` under
 * `input`. An entry carrying neither declares no modalities here, and the
 * panel offers nothing to write for that field.
 */
function modalityField(entry: Record<string, JsonValue>): ModalityField | undefined {
  if (Array.isArray(entry['inputModalities'])) return 'inputModalities'
  if (Array.isArray(entry['input'])) return 'input'
  return undefined
}

/** The models one resolved profile declares, and how long its array is. */
interface ProfileModels {
  /** Length of the raw `models` array, entries this panel could not read included. */
  readonly arrayLength: number
  /** The readable entries, in array order. */
  readonly models: ConfiguredModel[]
}

/** Read the models one resolved profile declares, in array order. */
function profileModels(profile: JsonValue | undefined): ProfileModels {
  const raw = asRecord(profile)?.['models']
  if (!Array.isArray(raw)) return { arrayLength: 0, models: [] }
  const models: ConfiguredModel[] = []
  raw.forEach((entry, index) => {
    const record = asRecord(entry)
    if (record === undefined) return
    const id = record['id']
    if (typeof id !== 'string' || id.length === 0) return
    const name = record['name']
    const contextWindow = capacity(record['contextWindow'])
    const maxTokens = capacity(record['maxTokens'])
    const field = modalityField(record)
    models.push({
      index,
      id,
      ...typeof name === 'string' && name.length > 0 ? { name } : {},
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
      inputModalities: field === undefined ? [] : modalities(record[field]),
      ...field === undefined ? {} : { modalityField: field },
    })
  })
  return { arrayLength: raw.length, models }
}

/**
 * Read how many models the namespace's own user layer stores.
 *
 * A path-addressed edit is applied to the user section and then merged over the
 * resolved value, so the array an append indexes into is the one the user wrote
 * — not the resolved one, which can be longer because a schema default or a
 * composition base contributed an entry the user never typed. Addressing the
 * resolved length would ask for an index the user array does not have, and the
 * document refuses an index past its end.
 *
 * @param view - the redacted namespace view.
 * @param path - path from the section root to the route profile.
 * @param resolved - the resolved array length, used when the user layer holds no section.
 * @returns the length a new entry is appended at.
 */
function userArrayLength(view: SettingsNamespaceView, path: readonly string[], resolved: number): number {
  const own = asRecord(atPath(view.user, path))?.['models']
  return Array.isArray(own) ? own.length : resolved
}

/**
 * Read the provider routes this deployment actually configured models for.
 *
 * The directory publishes every route the adapter knows about — the pi-ai
 * catalog ships dozens — whether or not the deployment configured one, so a
 * route only appears when its settings namespace resolves a profile that
 * declares at least one model. Everything else has nothing to compare.
 *
 * @param directory - provider routes the adapter directory publishes.
 * @param described - redacted settings namespaces, as `settings.describe` returns them.
 * @returns one row per configured route, in directory order.
 */
export function readRoutes(
  directory: readonly LlmConfigurableProvider[],
  described: SettingsDescribeValue,
): ConfiguredRoute[] {
  const views = new Map(described.namespaces.map(view => [view.ns, view] as const))
  const configured: ConfiguredRoute[] = []
  for (const entry of directory) {
    const view: SettingsNamespaceView | undefined = views.get(entry.settingsNs)
    if (view === undefined) continue
    const profile = atPath(view.value, entry.settingsPath)
    const { arrayLength, models } = profileModels(profile)
    if (models.length === 0) continue
    const endpoint = routeEndpoint(profile)
    configured.push({
      settingsNs: entry.settingsNs,
      provider: entry.provider,
      displayName: entry.displayName,
      settingsPath: entry.settingsPath,
      ...endpoint,
      revision: view.revision,
      arrayLength: userArrayLength(view, entry.settingsPath, arrayLength),
      preset: entry.declared !== true,
      ...entry.error === undefined ? {} : { error: entry.error },
      models,
    })
  }
  return configured
}
