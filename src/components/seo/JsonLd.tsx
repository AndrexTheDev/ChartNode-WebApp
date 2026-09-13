/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Renders structured data (schema.org) as a JSON-LD script block.
 * Server-safe: pure <script> tag, no client state.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  // Ohne `@context` kann keine Suchmaschine die Entitäten auflösen – Arrays
  // werden als `@graph` gekapselt, Einzelobjekte bekommen den Context direkt.
  const payload = Array.isArray(data)
    ? { '@context': 'https://schema.org', '@graph': data }
    : { '@context': 'https://schema.org', ...data };
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe inside <script> except for `</script>`
      // sequences – escape angle brackets defensively.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(payload).replace(/</g, '\\u003c') }}
    />
  );
}
