export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type SortablePostcard = {
  id: string;
  found_date: string | null;
  archived_on: string | null;
  archived_at?: string | null;
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
  field: 'rating' | 'found_date' | 'archived_on' | 'distance';
  direction: 'asc' | 'desc';
  origin?: Coordinates | null;
};

export type PaginationResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  start: number;
  end: number;
};

export function postcardCoordinates(record: Pick<SortablePostcard, 'location'>): Coordinates | null;
export function archiveTimestamp(record: Pick<SortablePostcard, 'archived_on' | 'archived_at'>): string | null;
export function distanceKilometers(
  record: Pick<SortablePostcard, 'location'>,
  origin: Coordinates | null,
): number | null;
export function sortPostcards<T extends SortablePostcard>(
  records: T[],
  options: PostcardSortOptions,
): T[];
export function paginateRecords<T>(
  records: T[],
  requestedPage: number,
  pageSize?: number,
): PaginationResult<T>;
