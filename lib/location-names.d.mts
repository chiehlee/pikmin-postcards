export type LocationNaming = {
  raw?: string | null;
  display?: string | null;
  endonym?: string | null;
  zh_tw?: string | null;
  language?: string | null;
  name_status?: 'researched' | 'provisional' | null;
  name_confidence?: 'high' | 'medium' | 'low' | null;
  country_code?: string | null;
  country?: string | null;
  country_endonym?: string | null;
  address_local?: string | null;
  precision?: 'country' | 'region' | 'city' | 'district' | 'locality' | 'road' | 'full_address' | 'coordinates' | 'unknown' | null;
};

export function locationNeedsZhTw(language?: string | null): boolean;
export function normalizeLocalAddress(
  address?: string | null,
  countryCode?: string | null,
  countryEndonym?: string | null,
): string | null;
export function normalizeZhTwAddress(
  address?: string | null,
  countryCode?: string | null,
  countryZhTw?: string | null,
): string | null;
export function normalizeResearchedLocation<T extends LocationNaming>(location: T): T & {
  display: string;
  address_local: string | null;
  zh_tw: string | null;
};
export function canonicalCountryZhTw(countryCode?: string | null, fallback?: string | null): string | null;
export function researchedLocationDisplay(location?: LocationNaming | null): string;
export function researchedLocationQuery(location?: LocationNaming | null): string | null;
export function validateLocationNaming(location?: LocationNaming | null): string[];
