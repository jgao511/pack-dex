export const COLLECTION_SNAPSHOT_PAGE_SIZE = 500;
export const COLLECTION_SNAPSHOT_STALE_CODE = "COLLECTION_SNAPSHOT_STALE";

const COLLECTION_COLUMNS = "set_id,card_id,quantity,created_at,updated_at";

export class CollectionSnapshotLoadError extends Error {
  constructor(message, { cause = null, code = "COLLECTION_SNAPSHOT_LOAD_FAILED", page = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "CollectionSnapshotLoadError";
    this.code = code;
    this.page = page;
    this.recoverable = true;
  }
}

export class CollectionSnapshotStaleError extends CollectionSnapshotLoadError {
  constructor() {
    super("A newer collection refresh replaced this request.", {
      code: COLLECTION_SNAPSHOT_STALE_CODE,
    });
    this.name = "CollectionSnapshotStaleError";
  }
}

function rowKey(row) {
  const setId = String(row?.set_id || "");
  const cardId = String(row?.card_id || "");
  if (!setId || !cardId) {
    throw new CollectionSnapshotLoadError("The collection response contained a row without its full unique key.", {
      code: "COLLECTION_SNAPSHOT_INVALID_ROW",
    });
  }
  return `${setId}\u0000${cardId}`;
}

export function createCollectionSnapshotLoader() {
  let generation = 0;

  function invalidate() {
    generation += 1;
  }

  function isCurrent(snapshot) {
    return Boolean(snapshot) && snapshot.generation === generation;
  }

  async function load({
    client,
    userId,
    table = "user_collection",
    pageSize = COLLECTION_SNAPSHOT_PAGE_SIZE,
    onPageRequest = null,
  }) {
    const normalizedUserId = String(userId || "");
    if (!client || !normalizedUserId) {
      throw new CollectionSnapshotLoadError("A signed-in account is required to load a collection snapshot.", {
        code: "COLLECTION_SNAPSHOT_USER_REQUIRED",
      });
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize >= 1_000) {
      throw new CollectionSnapshotLoadError("Collection page size must be an integer below the server row cap.", {
        code: "COLLECTION_SNAPSHOT_INVALID_PAGE_SIZE",
      });
    }

    const requestGeneration = ++generation;
    const requestStartedAt = Date.now();
    const rows = [];
    const seenKeys = new Set();
    let total = null;
    let page = 0;

    const assertCurrent = () => {
      if (requestGeneration !== generation) throw new CollectionSnapshotStaleError();
    };

    while (true) {
      assertCurrent();
      const from = page * pageSize;
      const to = from + pageSize - 1;
      onPageRequest?.({ page, from, to, userId: normalizedUserId });

      let response;
      try {
        response = await client
          .from(table)
          .select(COLLECTION_COLUMNS, page === 0 ? { count: "exact" } : undefined)
          .eq("user_id", normalizedUserId)
          .order("set_id", { ascending: true })
          .order("card_id", { ascending: true })
          .range(from, to);
      } catch (cause) {
        assertCurrent();
        throw new CollectionSnapshotLoadError(`Collection page ${page + 1} could not be loaded.`, {
          cause,
          page,
        });
      }

      assertCurrent();
      if (response?.error) {
        throw new CollectionSnapshotLoadError(`Collection page ${page + 1} could not be loaded.`, {
          cause: response.error,
          page,
        });
      }
      if (!Array.isArray(response?.data)) {
        throw new CollectionSnapshotLoadError(`Collection page ${page + 1} returned a malformed response.`, {
          code: "COLLECTION_SNAPSHOT_MALFORMED_RESPONSE",
          page,
        });
      }

      if (page === 0 && Number.isInteger(response.count) && response.count >= 0) {
        total = response.count;
      }

      for (const row of response.data) {
        const key = rowKey(row);
        if (seenKeys.has(key)) {
          throw new CollectionSnapshotLoadError("The collection response contained a duplicate unique key.", {
            code: "COLLECTION_SNAPSHOT_DUPLICATE_ROW",
            page,
          });
        }
        seenKeys.add(key);
        rows.push(row);
      }

      if (total !== null && rows.length > total) {
        throw new CollectionSnapshotLoadError("The collection response exceeded its reported total.", {
          code: "COLLECTION_SNAPSHOT_TOTAL_MISMATCH",
          page,
        });
      }

      const reachedReportedTotal = total !== null && rows.length === total;
      const reachedShortPage = response.data.length < pageSize;
      if (reachedReportedTotal || reachedShortPage) break;
      page += 1;
    }

    assertCurrent();
    if (total !== null && rows.length !== total) {
      throw new CollectionSnapshotLoadError("The collection response ended before its reported total was loaded.", {
        code: "COLLECTION_SNAPSHOT_TOTAL_MISMATCH",
        page,
      });
    }

    return {
      rows,
      userId: normalizedUserId,
      requestStartedAt,
      generation: requestGeneration,
      requestCount: page + 1,
      total: total ?? rows.length,
    };
  }

  return { invalidate, isCurrent, load };
}
