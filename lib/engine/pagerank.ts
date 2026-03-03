import { InfluenceEdge, ArtistNode } from './types';

// --- Internal graph representation ---

interface GraphNode {
  wikidataId: string;
  name: string;
  spotifyId?: string;
  outLinks: string[]; // IDs this node links to
  inLinks: string[];  // IDs that link to this node
}

// --- Graph construction ---

/**
 * Build a directed influence graph from an array of edges.
 *
 * Edge semantics:
 *  - 'influenced_by': fromId was influenced by toId → link from fromId → toId
 *  - 'influenced':    fromId influenced toId    → link from toId → fromId
 */
export function buildInfluenceGraph(
  edges: InfluenceEdge[],
): Map<string, GraphNode> {
  const graph = new Map<string, GraphNode>();

  const ensureNode = (id: string, name: string): GraphNode => {
    let node = graph.get(id);
    if (!node) {
      node = { wikidataId: id, name, outLinks: [], inLinks: [] };
      graph.set(id, node);
    }
    return node;
  };

  for (const edge of edges) {
    const fromNode = ensureNode(edge.fromId, edge.fromName);
    const toNode = ensureNode(edge.toId, edge.toName);

    // Attach spotifyId when available
    if (edge.toSpotifyId) {
      toNode.spotifyId = edge.toSpotifyId;
    }

    if (edge.direction === 'influenced_by') {
      // fromId was influenced by toId → directed link from → to
      fromNode.outLinks.push(edge.toId);
      toNode.inLinks.push(edge.fromId);
    } else {
      // 'influenced': fromId influenced toId → directed link to → from
      toNode.outLinks.push(edge.fromId);
      fromNode.inLinks.push(edge.toId);
    }
  }

  return graph;
}

// --- PageRank ---

/**
 * Standard iterative PageRank over the influence graph.
 *
 * Typically converges in <20 iterations for graphs of 200-500 nodes,
 * well under the 10ms budget on modern devices.
 */
export function computePageRank(
  graph: Map<string, GraphNode>,
  damping = 0.85,
  maxIter = 50,
  tolerance = 0.0001,
): Map<string, number> {
  const nodeIds = Array.from(graph.keys());
  const n = nodeIds.length;

  if (n === 0) {
    return new Map();
  }

  const initialRank = 1 / n;
  const rank = new Map<string, number>();

  // Initialize all ranks equally
  for (const id of nodeIds) {
    rank.set(id, initialRank);
  }

  // Pre-compute out-degree for each node (avoids repeated .length lookups)
  const outDegree = new Map<string, number>();
  for (const id of nodeIds) {
    const node = graph.get(id)!;
    outDegree.set(id, node.outLinks.length);
  }

  const base = (1 - damping) / n;

  for (let iter = 0; iter < maxIter; iter++) {
    let maxDelta = 0;

    // Accumulate dangling node rank (nodes with no outLinks)
    let danglingSum = 0;
    for (const id of nodeIds) {
      if (outDegree.get(id) === 0) {
        danglingSum += rank.get(id)!;
      }
    }

    const danglingContribution = damping * danglingSum / n;

    for (const id of nodeIds) {
      const node = graph.get(id)!;

      // Sum contributions from all nodes that link to this one
      let inSum = 0;
      for (const inId of node.inLinks) {
        const deg = outDegree.get(inId)!;
        if (deg > 0) {
          inSum += rank.get(inId)! / deg;
        }
      }

      const newRank = base + damping * inSum + danglingContribution;
      const oldRank = rank.get(id)!;
      const delta = Math.abs(newRank - oldRank);

      if (delta > maxDelta) {
        maxDelta = delta;
      }

      rank.set(id, newRank);
    }

    // Convergence check
    if (maxDelta < tolerance) {
      break;
    }
  }

  return rank;
}

// --- Blindspot detection ---

/**
 * Identify high-influence artists the user doesn't already listen to.
 *
 * 1. Build the influence graph from edges
 * 2. Compute PageRank scores
 * 3. Filter out artists already in the user's library
 * 4. Return the top `limit` results sorted by PageRank descending
 */
export function getBlindspots(
  edges: InfluenceEdge[],
  userArtistWikidataIds: Set<string>,
  limit = 20,
): ArtistNode[] {
  const graph = buildInfluenceGraph(edges);
  const ranks = computePageRank(graph);

  const blindspots: ArtistNode[] = [];

  ranks.forEach((pageRank, wikidataId) => {
    if (userArtistWikidataIds.has(wikidataId)) {
      return;
    }

    const node = graph.get(wikidataId)!;

    blindspots.push({
      wikidataId,
      name: node.name,
      spotifyId: node.spotifyId,
      pageRank,
      isUserArtist: false,
    });
  });

  // Sort descending by pageRank, take top N
  blindspots.sort((a, b) => b.pageRank - a.pageRank);

  return blindspots.slice(0, limit);
}
