import { InfluenceEdge } from './types';
import { getCached, setCache, CACHE_TTL, getCacheKey } from './cache';

const WIKIDATA_API = '/api/wikidata';

async function sparqlQuery<T>(query: string): Promise<T> {
  const res = await fetch(WIKIDATA_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Wikidata proxy error: ${res.status}`);
  return res.json();
}

interface SparqlResult {
  results: {
    bindings: Record<string, { type: string; value: string }>[];
  };
}

/**
 * Find Wikidata IDs for a batch of Spotify artist IDs.
 * Uses P1902 (Spotify artist ID) property.
 * Max 50 per query to stay within SPARQL limits.
 */
export async function findWikidataIdsBySpotifyIds(
  spotifyIds: string[]
): Promise<Map<string, string>> {
  const cacheKey = getCacheKey('wikidata_ids', spotifyIds);
  const cached = getCached<Record<string, string>>(cacheKey);
  if (cached) return new Map(Object.entries(cached));

  const result = new Map<string, string>();
  const batches = chunk(spotifyIds, 50);

  for (const batch of batches) {
    const values = batch.map((id) => `"${id}"`).join(' ');
    const query = `
      SELECT ?artist ?spotifyId WHERE {
        VALUES ?spotifyId { ${values} }
        ?artist wdt:P1902 ?spotifyId .
      }
    `;

    const data = await sparqlQuery<SparqlResult>(query);

    for (const binding of data.results.bindings) {
      const wikidataId = binding.artist.value.split('/').pop()!;
      const spotifyId = binding.spotifyId.value;
      result.set(spotifyId, wikidataId);
    }
  }

  // Cache as plain object
  setCache(cacheKey, Object.fromEntries(result), CACHE_TTL.wikidata);
  return result;
}

/**
 * Get influence relationships (P737 = influenced by) for a set of Wikidata IDs.
 * Returns bidirectional edges: who influenced whom + who they influenced.
 * Also resolves Spotify IDs via P1902 where available.
 */
export async function getInfluences(
  wikidataIds: string[]
): Promise<InfluenceEdge[]> {
  const cacheKey = getCacheKey('influences', wikidataIds);
  const cached = getCached<InfluenceEdge[]>(cacheKey);
  if (cached) return cached;

  const values = wikidataIds.map((id) => `wd:${id}`).join(' ');

  // Bidirectional: find who these artists were influenced by AND who was influenced by them
  const query = `
    SELECT ?artist ?artistLabel ?influencer ?influencerLabel ?influencerSpotifyId ?direction WHERE {
      VALUES ?source { ${values} }
      {
        ?source wdt:P737 ?influencer .
        BIND(?source AS ?artist)
        BIND("influenced_by" AS ?direction)
        OPTIONAL { ?influencer wdt:P1902 ?influencerSpotifyId . }
      }
      UNION
      {
        ?influenced wdt:P737 ?source .
        BIND(?source AS ?influencer)
        BIND(?influenced AS ?artist)
        BIND("influenced" AS ?direction)
        OPTIONAL { ?influenced wdt:P1902 ?influencerSpotifyId . }
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 500
  `;

  const data = await sparqlQuery<SparqlResult>(query);

  const edges: InfluenceEdge[] = data.results.bindings.map((b) => ({
    fromId: b.artist.value.split('/').pop()!,
    fromName: b.artistLabel?.value ?? 'Unknown',
    toId: b.influencer.value.split('/').pop()!,
    toName: b.influencerLabel?.value ?? 'Unknown',
    toSpotifyId: b.influencerSpotifyId?.value,
    direction: b.direction.value as 'influenced_by' | 'influenced',
  }));

  setCache(cacheKey, edges, CACHE_TTL.wikidata);
  return edges;
}

/**
 * Get genres (P136) for a set of Wikidata artist IDs.
 */
export async function getArtistGenres(
  wikidataIds: string[]
): Promise<Map<string, string[]>> {
  const cacheKey = getCacheKey('genres', wikidataIds);
  const cached = getCached<Record<string, string[]>>(cacheKey);
  if (cached) return new Map(Object.entries(cached));

  const values = wikidataIds.map((id) => `wd:${id}`).join(' ');

  const query = `
    SELECT ?artist ?genreLabel WHERE {
      VALUES ?artist { ${values} }
      ?artist wdt:P136 ?genre .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
  `;

  const data = await sparqlQuery<SparqlResult>(query);

  const result = new Map<string, string[]>();

  for (const binding of data.results.bindings) {
    const wikidataId = binding.artist.value.split('/').pop()!;
    const genre = binding.genreLabel?.value ?? '';
    if (!genre) continue;

    const existing = result.get(wikidataId) ?? [];
    existing.push(genre);
    result.set(wikidataId, existing);
  }

  setCache(cacheKey, Object.fromEntries(result), CACHE_TTL.wikidata);
  return result;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
