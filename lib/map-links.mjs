export function googleMapsSearchUrl(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function googleMapsEmbedUrl(query) {
  const parameters = new URLSearchParams({ q: query, output: "embed" });
  return `https://www.google.com/maps?${parameters.toString()}`;
}
