// Shared response shape for the household history logs (reorder + consumption).
//
// Both collections store snake_case in Mongo but must expose camelCase over the
// wire, and the in-memory dev-mode fallbacks in inventoryController build the
// same payload by hand. Those three places drifting apart is exactly how the
// reorder log ended up rendering blank fields whenever the DB was unavailable,
// so the common envelope lives here once instead of relying on every copy being
// edited in step.
//
// Storage stays snake_case on purpose: the timestamps mapping
// (`timestamps: { createdAt: 'created_at', ... }`) matches the documents already
// written to these collections, and the `.sort({ created_at: -1 })` queries read
// those stored field names. Only the JSON leaving the API is normalized.

/**
 * Renames the fields every history log shares, in place, and strips Mongo
 * internals. Callers handle their own event-specific fields afterwards.
 */
export function applyCommonHistoryFields(ret) {
    ret.id = ret._id.toString();
    ret.householdId = ret.household_id.toString();
    ret.itemId = ret.item_id;
    ret.itemName = ret.item_name;
    ret.createdAt = ret.created_at;
    ret.updatedAt = ret.updated_at;

    delete ret._id;
    delete ret.__v;
    delete ret.household_id;
    delete ret.item_id;
    delete ret.item_name;
    delete ret.created_at;
    delete ret.updated_at;

    return ret;
}

/**
 * The dev-mode (no DB) counterpart of applyCommonHistoryFields — produces the
 * same shared fields so an in-memory entry is indistinguishable from a
 * serialized Mongo document as far as the client is concerned.
 */
export function buildDevHistoryBase(id, householdId, item) {
    // History rows are append-only, so updatedAt equals createdAt here. It's
    // emitted anyway because Mongo's `timestamps` always sets it, and the whole
    // point of this helper is that a client can't tell the two paths apart.
    const now = new Date().toISOString();
    return {
        id,
        householdId,
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        unit: item.unit,
        createdAt: now,
        updatedAt: now,
    };
}
