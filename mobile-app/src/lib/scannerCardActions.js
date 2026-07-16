function requireIdentifier(value, label, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`Invalid ${label}.`);
  return normalized;
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] || null : data || null;
}

export async function loadScannerCardActionState(supabase, { cardId, setId } = {}) {
  if (!supabase) throw new Error("PackDex account services are unavailable.");
  const stableCardId = requireIdentifier(cardId, "card ID", 200);
  const canonicalSetId = requireIdentifier(setId, "set ID", 120);

  const [scannerReceipt, wishlistEntry] = await Promise.all([
    supabase.from("user_scanner_card_additions").select("card_id").eq("card_id", stableCardId).maybeSingle(),
    supabase.from("user_wishlist").select("card_id").eq("set_id", canonicalSetId).eq("card_id", stableCardId).maybeSingle(),
  ]);

  if (scannerReceipt.error) throw scannerReceipt.error;
  if (wishlistEntry.error) throw wishlistEntry.error;
  return {
    collectionAdded: Boolean(scannerReceipt.data?.card_id),
    wishlisted: Boolean(wishlistEntry.data?.card_id),
  };
}

export async function addScannedCardOnce(supabase, { cardId, setId } = {}) {
  if (!supabase) throw new Error("PackDex account services are unavailable.");
  const p_card_id = requireIdentifier(cardId, "card ID", 200);
  const p_set_id = requireIdentifier(setId, "set ID", 120);
  const { data, error } = await supabase.rpc("add_scanned_card_once", { p_card_id, p_set_id });
  if (error) throw error;

  const row = firstRow(data);
  if (!row) throw new Error("The scanner addition was not confirmed by the server.");
  return {
    added: row.added === true,
    alreadyAdded: row.already_added === true,
    quantity: Number(row.quantity || 0),
  };
}
