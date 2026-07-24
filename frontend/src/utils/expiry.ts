/**
 * Single source of truth for "days until expiry" logic.
 *
 * Every component used to reimplement this calculation independently, and
 * every copy used a `daysToExpiry >= 0` guard that silently excluded items
 * whose expiry date has already passed. That meant an already-expired item
 * showed up nowhere as a problem (green "Good" status, not counted in
 * "Expiring Soon", missing from waste tracking, etc.) — the opposite of
 * what an app meant to reduce food waste should do.
 *
 * Use `getDaysToExpiry` / `isExpiredOrExpiringSoon` everywhere instead of
 * re-deriving this so the fix only has to live in one place.
 */

/** Returns whole days until expiry (negative if already past), or null if no expiry date is set. */
export const getDaysToExpiry = (expiryDate: string | null | undefined): number | null => {
    if (!expiryDate) return null;
    const days = Math.ceil(
        (new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    return days;
};

export const isExpired = (expiryDate: string | null | undefined): boolean => {
    const days = getDaysToExpiry(expiryDate);
    return days !== null && days < 0;
};

/** True if the item is already expired OR will expire within `windowDays`. */
export const isExpiredOrExpiringSoon = (
    expiryDate: string | null | undefined,
    windowDays = 7
): boolean => {
    const days = getDaysToExpiry(expiryDate);
    if (days === null) return false;
    return days < windowDays;
};

/** Human-readable label: "Expired 3 days ago" / "Expires today" / "Expires in 5 days". */
export const formatExpiryLabel = (expiryDate: string | null | undefined): string => {
    const days = getDaysToExpiry(expiryDate);
    if (days === null) return 'N/A';
    if (days < 0) return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
    if (days === 0) return 'Expires today';
    return `Expires in ${days} day${days === 1 ? '' : 's'}`;
};