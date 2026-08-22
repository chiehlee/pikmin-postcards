export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type SortablePostcard = {
  id: string;
  found_date: string | null;
  curation: {
    rating: number | null;
  };
  location: {
    raw: string;
    latitude?: number | null;
    longitude?: number | null;
  };
};

export type PostcardSortOptions = {
  field: 'rating' | 'date' | 'distance';
  direction: 'asc' | 'desc';
  origin?: Coordinates | null;
};

export function postcardCoordinates(record: Pick<SortablePostcard, 'location'>): Coordinates | null;
export function distanceKilometers(
  record: Pick<SortablePostcard, 'location'>,
  origin: Coordinates | null,
): number | null;
export function sortPostcards<T extends SortablePostcard>(
  records: T[],
  options: PostcardSortOptions,
): T[];
