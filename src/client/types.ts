/** Client-safe views of the models.dev catalog and of one configured model matched against it. */

import type { EntryBinding } from './bindings.ts'

/** Input modalities a DSH model entry can declare, mirroring the adapters' `ModelModality`. */
export type ModelsDevModality = 'text' | 'image'

/** Published token prices in US dollars per million tokens. */
export interface ModelsDevCost {
  /** Price of one million input tokens. */
  input?: number
  /** Price of one million output tokens. */
  output?: number
  /** Price of one million cached-read tokens. */
  cacheRead?: number
}

/** One catalog entry reduced to the facts a DSH model row can be configured from. */
export interface ModelsDevModel {
  /** models.dev provider key the entry is published under. */
  providerId: string
  /** Model id the provider accepts. */
  id: string
  /** Display name published for the model. */
  name: string
  /** One-line summary published for the model. */
  description?: string
  /** Combined request and response context in tokens, when published. */
  contextWindow?: number
  /** Maximum output tokens, when published. */
  maxOutputTokens?: number
  /** Modalities DSH can declare on this route's model entry, always including `text`. */
  inputModalities: readonly ModelsDevModality[]
  /** Whether the model returns separate reasoning output. */
  reasoning: boolean
  /** Whether the model accepts tool calls. */
  toolCall: boolean
  /** Whether the model accepts a structured-output response format. */
  structuredOutput: boolean
  /** Whether the request accepts a temperature. */
  temperature: boolean
  /** Publication date as published, for example `2026-07-06` or `2025-09`. */
  releaseDate?: string
  /** Catalog lifecycle status, for example `deprecated`. */
  status?: string
  /** Published token prices, when the entry carries them. */
  cost?: ModelsDevCost
}

/** One provider row of the catalog index. */
export interface ModelsDevProviderSummary {
  /** models.dev provider key. */
  id: string
  /** Display name published for the provider. */
  name: string
  /** Documentation address published for the provider. */
  doc?: string
  /** Model entries published under this provider. */
  modelCount: number
}

/** Catalog facts a consumer needs before it renders or matches anything. */
export interface ModelsDevCatalogView {
  /** Address the catalog was read from. */
  source: string
  /** Unix milliseconds the currently held catalog was retrieved. */
  fetchedAt: number
  /** Every provider the document published. */
  providers: readonly ModelsDevProviderSummary[]
  /** Model entries across every provider, including the ones this deployment cannot use. */
  modelCount: number
  /** Entries the document published in a form this package could not read. */
  skippedCount: number
}

/** How one configured model id was located in the catalog. */
export type ModelsDevMatchStrategy =
  /** Identical model id inside the resolved provider. */
  | 'exact'
  /** The entry's `canonical_model_id`. */
  | 'canonical'
  /** The entry id after its vendor prefix, as gateways publish foreign models. */
  | 'bare'
  /** Ignoring case, punctuation, and a trailing release date. */
  | 'normalized'
  /** The entry this browser pinned for the model, rather than one it resolved. */
  | 'bound'
  /** No entry in the catalog matched. */
  | 'none'

/** One catalog entry offered as a possible match for a model id being added. */
export interface ModelsDevCandidate {
  /** models.dev provider that publishes the entry. */
  readonly providerId: string
  /** The published entry. */
  readonly model: ModelsDevModel
  /** Which comparison located it. */
  readonly strategy: ModelsDevMatchStrategy
}

/** How close an entry's id came to the one a fuzzy search was asked about. */
export type ModelsDevSimilarity =
  /** The two ids are identical once case, punctuation, and a release date are folded away. */
  | 'folded'
  /** One id contains the other, so one of them is a spelling of a wider or narrower model. */
  | 'contains'
  /** The ids differ by a character or two. */
  | 'near'

/** One catalog entry a fuzzy search offered, with how close it came. */
export interface ModelsDevSimilar {
  /** models.dev provider that publishes the entry. */
  readonly providerId: string
  /** The published entry. */
  readonly model: ModelsDevModel
  /** How the entry came to be offered. */
  readonly similarity: ModelsDevSimilarity
  /** Character edits between the two ids; absent unless `similarity` is `near`. */
  readonly distance?: number
}

/** One entry the add dialog can offer, whichever search located it. */
export type ModelsDevOption = ModelsDevCandidate | ModelsDevSimilar

/** One configured provider route and model the consumer asks about. */
export interface ModelsDevLookup {
  /** Provider route key the deployment configured. */
  provider: string
  /** Model id the deployment configured. */
  modelId: string
  /**
   * The entry this browser pinned for the model. It answers the lookup outright
   * while the catalog still publishes it, because the reader chose it over every
   * comparison this plugin can make on the id alone.
   */
  binding?: EntryBinding
}

/** What the catalog says about one configured provider route and model. */
export interface ModelsDevMatch {
  /** Provider route key the consumer asked about. */
  provider: string
  /** Model id the consumer asked about. */
  modelId: string
  /** models.dev provider the route key resolved to; absent when no provider matched it. */
  routeProviderKey?: string
  /** models.dev provider that supplied the entry; absent when nothing matched. */
  providerKey?: string
  /** Which comparison found the entry. */
  strategy: ModelsDevMatchStrategy
  /** Published entry; absent when `strategy` is `none`. */
  model?: ModelsDevModel
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The catalog could not be read or did not parse into a usable document. */
    'models-dev/catalog-unavailable': {
      /** Address the read was attempted against. */
      readonly source: string
    }
  }
}
