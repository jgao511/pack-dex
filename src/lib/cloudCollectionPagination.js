export const CLOUD_COLLECTION_PAGE_SIZE = 1000;
export const CLOUD_COLLECTION_COLUMNS = "id,set_id,card_id,quantity,created_at,updated_at";

function normalizePageSize(pageSize) {
  const normalized = Number(pageSize);

  if (!Number.isInteger(normalized) || normalized < 1 || normalized > CLOUD_COLLECTION_PAGE_SIZE) {
    throw new RangeError(`PackDex collection page size must be between 1 and ${CLOUD_COLLECTION_PAGE_SIZE}.`);
  }

  return normalized;
}

export async function loadCloudCollectionPages(
  client,
  userId,
  onPage,
  { pageSize = CLOUD_COLLECTION_PAGE_SIZE } = {}
) {
  if (!client || !userId) return 0;
  if (typeof onPage !== "function") throw new TypeError("PackDex collection pagination requires an onPage callback.");

  const normalizedPageSize = normalizePageSize(pageSize);
  let from = 0;
  let totalRows = 0;

  while (true) {
    const { data, error } = await client
      .from("user_collection")
      .select(CLOUD_COLLECTION_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + normalizedPageSize - 1);

    if (error) throw error;

    const page = Array.isArray(data) ? data : [];
    await onPage(page, { from, totalRows });
    totalRows += page.length;

    if (page.length < normalizedPageSize) break;
    from += normalizedPageSize;
  }

  return totalRows;
}
