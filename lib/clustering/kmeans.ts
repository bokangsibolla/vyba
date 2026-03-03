type Point = number[];

interface Cluster {
  centroid: Point;
  points: Point[];
  indices: number[];
}

function euclideanDistance(a: Point, b: Point): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

function mean(points: Point[]): Point {
  if (points.length === 0) return [];
  const dim = points[0].length;
  const result = new Array(dim).fill(0) as number[];
  for (const p of points) {
    for (let i = 0; i < dim; i++) {
      result[i] += p[i];
    }
  }
  return result.map((v) => v / points.length);
}

function initCentroids(points: Point[], k: number): Point[] {
  const centroids: Point[] = [];
  centroids.push(points[Math.floor(Math.random() * points.length)]);

  for (let c = 1; c < k; c++) {
    const distances = points.map((p) => {
      const minDist = Math.min(...centroids.map((cent) => euclideanDistance(p, cent)));
      return minDist * minDist;
    });
    const totalDist = distances.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalDist;
    for (let i = 0; i < points.length; i++) {
      r -= distances[i];
      if (r <= 0) {
        centroids.push(points[i]);
        break;
      }
    }
    if (centroids.length === c) {
      centroids.push(points[Math.floor(Math.random() * points.length)]);
    }
  }

  return centroids;
}

export function kMeans(points: Point[], k: number, maxIterations = 50): { clusters: Cluster[] } {
  if (points.length <= k) {
    return {
      clusters: points.map((p, i) => ({ centroid: p, points: [p], indices: [i] })),
    };
  }

  let centroids = initCentroids(points, k);
  let assignments = new Array(points.length).fill(0) as number[];

  for (let iter = 0; iter < maxIterations; iter++) {
    const newAssignments = points.map((p) => {
      let minDist = Infinity;
      let minIdx = 0;
      for (let c = 0; c < centroids.length; c++) {
        const dist = euclideanDistance(p, centroids[c]);
        if (dist < minDist) {
          minDist = dist;
          minIdx = c;
        }
      }
      return minIdx;
    });

    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;
    if (!changed) break;

    centroids = centroids.map((_, c) => {
      const clusterPoints = points.filter((_, i) => assignments[i] === c);
      return clusterPoints.length > 0 ? mean(clusterPoints) : centroids[c];
    });
  }

  const clusters: Cluster[] = centroids.map((centroid, c) => ({
    centroid,
    points: points.filter((_, i) => assignments[i] === c),
    indices: assignments.reduce<number[]>((acc, a, i) => (a === c ? [...acc, i] : acc), []),
  }));

  return { clusters: clusters.filter((c) => c.points.length > 0) };
}
