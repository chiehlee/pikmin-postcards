export type LocationNaming = {
  raw?: string | null;
  display?: string | null;
  endonym?: string | null;
  zh_tw?: string | null;
  language?: string | null;
  name_status?: 'researched' | 'provisional' | null;
  name_confidence?: 'high' | 'medium' | 'low' | null;
};

export function locationNeedsZhTw(language?: string | null): boolean;
export function researchedLocationDisplay(location?: LocationNaming | null): string;
export function researchedLocationQuery(location?: LocationNaming | null): string | null;
export function validateLocationNaming(location?: LocationNaming | null): string[];
