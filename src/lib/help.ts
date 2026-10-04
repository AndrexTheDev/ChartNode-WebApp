// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.

export interface HelpMetricDoc {
  name: string;
  body: string;
}

/** Flatten the nested help.metrics tree while preserving stable dotted IDs. */
export function flattenMetricDocs(value: unknown, prefix = ''): Array<[string, HelpMetricDoc]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];

  const flattened: Array<[string, HelpMetricDoc]> = [];
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const id = prefix ? `${prefix}.${key}` : key;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

    const candidate = entry as Partial<HelpMetricDoc>;
    if (typeof candidate.name === 'string' && typeof candidate.body === 'string') {
      flattened.push([id, { name: candidate.name, body: candidate.body }]);
    } else {
      flattened.push(...flattenMetricDocs(entry, id));
    }
  }
  return flattened;
}
