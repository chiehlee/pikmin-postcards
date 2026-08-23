const earthRadiusKilometers = 6371.0088;

export function postcardCoordinates(record) {
  const latitude = record.location?.latitude;
  const longitude = record.location?.longitude;
  if (validCoordinates(latitude, longitude)) return { latitude, longitude };

  const raw = record.location?.raw ?? "";
  const visible = raw.match(/^\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?$/);
  if (!visible) return null;
  const parsedLatitude = Number(visible[1]);
  const parsedLongitude = Number(visible[2]);
  return validCoordinates(parsedLatitude, parsedLongitude)
    ? { latitude: parsedLatitude, longitude: parsedLongitude }
    : null;
}

export function distanceKilometers(record, origin) {
  const target = postcardCoordinates(record);
  if (!target || !validCoordinates(origin?.latitude, origin?.longitude)) return null;

  const latitudeDelta = radians(target.latitude - origin.latitude);
  const longitudeDelta = radians(target.longitude - origin.longitude);
  const originLatitude = radians(origin.latitude);
  const targetLatitude = radians(target.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(originLatitude) * Math.cos(targetLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKilometers * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function sortPostcards(records, { field, direction, origin = null }) {
  const distanceByRecord = field === "distance" && origin
    ? new Map(records.map((record) => [record, distanceKilometers(record, origin)]))
    : null;
  return [...records].sort((left, right) => {
    let primary = 0;
    if (field === "rating") {
      primary = compareNullable(left.curation.rating, right.curation.rating, direction, numericCompare);
    } else if (field === "found_date") {
      primary = compareNullable(left.found_date, right.found_date, direction, textCompare);
    } else if (field === "archived_on") {
      primary = compareNullable(left.archived_on, right.archived_on, direction, textCompare);
    } else if (distanceByRecord) {
      primary = compareNullable(
        distanceByRecord.get(left) ?? null,
        distanceByRecord.get(right) ?? null,
        direction,
        numericCompare,
      );
    }
    if (primary) return primary;

    const ratingFallback = compareNullable(
      left.curation.rating,
      right.curation.rating,
      "desc",
      numericCompare,
    );
    if (ratingFallback) return ratingFallback;
    const dateFallback = compareNullable(left.found_date, right.found_date, "desc", textCompare);
    return dateFallback || left.id.localeCompare(right.id);
  });
}

export function paginateRecords(records, requestedPage, pageSize = 60) {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError("pageSize must be a positive integer");
  }

  const totalItems = records.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const numericPage = Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1;
  const page = Math.min(Math.max(numericPage, 1), totalPages);
  const startIndex = totalItems ? (page - 1) * pageSize : 0;
  const endIndex = Math.min(startIndex + pageSize, totalItems);

  return {
    items: records.slice(startIndex, endIndex),
    page,
    pageSize,
    totalItems,
    totalPages,
    start: totalItems ? startIndex + 1 : 0,
    end: endIndex,
  };
}

function compareNullable(left, right, direction, compare) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return direction === "asc" ? compare(left, right) : compare(right, left);
}

function numericCompare(left, right) {
  return left - right;
}

function textCompare(left, right) {
  return left.localeCompare(right);
}

function radians(value) {
  return value * Math.PI / 180;
}

function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}
