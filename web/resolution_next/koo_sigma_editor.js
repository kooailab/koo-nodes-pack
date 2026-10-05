let pointSequence = 0;

export const clamp = (value, low, high) => {
  const number = Number(value);
  return Math.max(low, Math.min(high, Number.isFinite(number) ? number : low));
};

export const newPointId = () => `p${Date.now().toString(36)}${(++pointSequence).toString(36)}`;

export function parseSigmaList(text) {
  return String(text || "")
    .trim()
    .split(/\s*->\s*|[,;\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite)
    .map((value) => Math.max(0, value));
}

export function sanitizePoints(raw, startSigma, endSigma, lockMonotonic = true, normalizeEndpoints = true, preventDuplicates = false) {
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw || "[]"); } catch { parsed = []; }
  }
  const source = Array.isArray(parsed) ? parsed : [];
  const span = startSigma - endSigma;
  const points = source.map((point, index) => {
    if (!point || typeof point !== "object") return null;
    const x = clamp(point.x ?? index / Math.max(1, source.length - 1), 0, 1);
    const sigma = Number.isFinite(Number(point.sigma)) ? Math.max(0, Number(point.sigma))
      : Number.isFinite(Number(point.y)) ? endSigma + clamp(point.y, 0, 1) * span : NaN;
    if (!Number.isFinite(sigma)) return null;
    return { id: String(point.id || newPointId()), x, sigma };
  }).filter(Boolean).sort((a, b) => a.x - b.x);

  if (points.length < 2) points.splice(0, points.length,
    { id: "start", x: 0, sigma: startSigma }, { id: "end", x: 1, sigma: endSigma });
  const merged = [];
  for (const point of points) {
    if (merged.length && Math.abs(point.x - merged.at(-1).x) < 1e-7) merged[merged.length - 1] = point;
    else merged.push(point);
  }
  if (normalizeEndpoints) {
    if (merged[0].x > 1e-8) merged.unshift({ id: "start", x: 0, sigma: startSigma });
    else Object.assign(merged[0], { id: merged[0].id || "start", x: 0, sigma: startSigma });
    if (merged.at(-1).x < 1 - 1e-8) merged.push({ id: "end", x: 1, sigma: endSigma });
    else Object.assign(merged.at(-1), { id: merged.at(-1).id || "end", x: 1, sigma: endSigma });
  }
  if (lockMonotonic) {
    for (let index = 1; index < merged.length; index++) merged[index].sigma = Math.min(merged[index].sigma, merged[index - 1].sigma);
  }
  if (preventDuplicates && merged.length > 2 && merged[0].sigma > merged.at(-1).sigma) {
    const epsilon = Math.max(1e-12, (merged[0].sigma - merged.at(-1).sigma) / (merged.length - 1) * 1e-7);
    for (let index = 1; index < merged.length - 1; index++) {
      const ceiling = merged[index - 1].sigma - epsilon;
      const floor = merged.at(-1).sigma + epsilon * (merged.length - 1 - index);
      merged[index].sigma = clamp(merged[index].sigma, floor, ceiling);
    }
  }
  return merged;
}

export function serializePoints(points) {
  return JSON.stringify(points.map(({ id, x, sigma }) => ({
    id,
    x: Number(x.toFixed(8)),
    sigma: Number(sigma.toFixed(9)),
  })));
}

export function pointsFromSigmas(values) {
  return values.map((sigma, index) => ({ id: index === 0 ? "start" : index === values.length - 1 ? "end" : newPointId(), x: index / Math.max(1, values.length - 1), sigma }));
}

export function manualValues(points, count, ease) {
  const result = [];
  let cursor = 0;
  for (let index = 0; index < count; index++) {
    const x = index / Math.max(1, count - 1);
    while (cursor < points.length - 2 && x > points[cursor + 1].x) cursor++;
    const left = points[cursor];
    const right = points[Math.min(cursor + 1, points.length - 1)];
    const local = ease((x - left.x) / Math.max(1e-12, right.x - left.x));
    result.push(left.sigma + (right.sigma - left.sigma) * local);
  }
  return result;
}

export function movePoint(points, id, nextX, nextSigma, { lockMonotonic = true, normalizeEndpoints = true, preventDuplicates = false, snapSteps = 0 } = {}) {
  const output = points.map((point) => ({ ...point }));
  const index = output.findIndex((point) => point.id === id);
  if (index < 0) return output;
  const point = output[index];
  const endpoint = index === 0 || index === output.length - 1;
  if (!endpoint || !normalizeEndpoints) {
    const minX = index ? output[index - 1].x + 1e-5 : 0;
    const maxX = index < output.length - 1 ? output[index + 1].x - 1e-5 : 1;
    let candidateX = nextX;
    if (snapSteps > 0) {
      candidateX = Math.round(nextX * snapSteps) / snapSteps;
      if (candidateX > maxX) candidateX = Math.floor(maxX * snapSteps) / snapSteps;
      if (candidateX < minX) candidateX = Math.ceil(minX * snapSteps) / snapSteps;
    }
    point.x = clamp(candidateX, minX, maxX);
    point.sigma = Math.max(0, Number(nextSigma));
  }
  if (lockMonotonic) {
    const epsilon = preventDuplicates ? Math.max(1e-12, Math.abs(output[0].sigma - output.at(-1).sigma) / Math.max(1, output.length - 1) * 1e-7) : 0;
    const ceiling = index ? output[index - 1].sigma - epsilon : Infinity;
    const floor = index < output.length - 1 ? output[index + 1].sigma + epsilon : 0;
    point.sigma = clamp(point.sigma, floor, ceiling);
  }
  return output;
}

export function addPoint(points, x, sigma) {
  const output = [...points.map((point) => ({ ...point })), { id: newPointId(), x: clamp(x, 1e-5, 1 - 1e-5), sigma: Math.max(0, sigma) }];
  output.sort((a, b) => a.x - b.x);
  const index = output.findIndex((point, position) => position > 0 && Math.abs(point.x - output[position - 1].x) < 1e-5);
  if (index >= 0) output[index].x = clamp(output[index - 1].x + 1e-5, 0, 1);
  return output;
}

export function deletePoint(points, id) {
  const index = points.findIndex((point) => point.id === id);
  return index <= 0 || index >= points.length - 1 ? points.map((point) => ({ ...point })) : points.filter((point) => point.id !== id).map((point) => ({ ...point }));
}

export function redistributePoints(points) {
  return points.map((point, index) => ({ ...point, x: index / Math.max(1, points.length - 1) }));
}

export function smoothPoints(points) {
  return points.map((point, index) => index === 0 || index === points.length - 1 ? { ...point } : {
    ...point,
    sigma: point.sigma * .5 + (points[index - 1].sigma + points[index + 1].sigma) * .25,
  });
}

export function simplifyPoints(points, tolerance = .006) {
  if (points.length <= 3) return points.map((point) => ({ ...point }));
  const start = points[0].sigma;
  const end = points.at(-1).sigma;
  const span = Math.max(1e-9, start - end);
  return points.filter((point, index) => {
    if (index === 0 || index === points.length - 1) return true;
    const left = points[index - 1];
    const right = points[index + 1];
    const t = (point.x - left.x) / Math.max(1e-12, right.x - left.x);
    const linear = left.sigma + (right.sigma - left.sigma) * t;
    return Math.abs(point.sigma - linear) / span > tolerance;
  }).map((point) => ({ ...point }));
}
