import { NextRequest, NextResponse } from 'next/server';

const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'VybaApp/1.0 (https://vyba.vercel.app; contact@vyba.app)';

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Missing SPARQL query' }, { status: 400 });
    }

    const response = await fetchWithRetry(query);
    const data = await response.json();

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function fetchWithRetry(query: string, retries = 1): Promise<Response> {
  const response = await fetch(WIKIDATA_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({ query }),
  });

  if (response.status === 429 && retries > 0) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return fetchWithRetry(query, retries - 1);
  }

  if (!response.ok) {
    throw new Error(`Wikidata API error: ${response.status}`);
  }

  return response;
}
