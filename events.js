/**
 * Builders for generic overlay announcements.
 *
 * The overlay server routes SSE events by `event.type`, so every builder here
 * returns `{ type: 'announcement', ... }` and the widget listens for the
 * `announcement` event. This channel is separate from the `redemption` event
 * that drives the Scorpio burn effect, which stays untouched.
 *
 * Rendering safety: the widget renders all fields with `textContent`, so no
 * HTML escaping happens here. Details are truncated to a banner-friendly
 * length; obvious toxicity filtering is intentionally skipped for these short
 * notices (only the Scorpio phrase goes through the Jev classifier).
 */

export const ANNOUNCE_MAX_DETAIL = 120;

const ANNOUNCE_KINDS = new Set(['redemption', 'bits', 'sub']);

/**
 * Collapse whitespace and clip a detail line so a banner stays readable.
 */
export function truncateDetail(text, maxChars = ANNOUNCE_MAX_DETAIL) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/**
 * Build the SSE payload consumed by the overlay `announcement` layer.
 */
export function createAnnouncement({ kind, title, username, detail = '', important = false } = {}) {
  if (!ANNOUNCE_KINDS.has(kind)) {
    throw new Error(`Invalid announcement kind: ${kind}`);
  }
  return {
    type: 'announcement',
    kind,
    title: String(title ?? ''),
    username: String(username ?? ''),
    detail: truncateDetail(detail),
    important: important === true,
    ts: Date.now(),
  };
}

/**
 * Small (non-important) banner for a non-highlight channel point redemption.
 * Never triggers the Scorpio burn.
 */
export function genericRedemptionAnnouncement(redemption = {}) {
  return createAnnouncement({
    kind: 'redemption',
    title: redemption.rewardTitle ?? 'Reward redeemed',
    username: redemption.userName ?? 'unknown',
    detail: redemption.userInput ?? '',
    important: false,
  });
}

/**
 * Important banner for a bits cheer. `bits` is the cheer count.
 */
export function bitsAnnouncement(username, bits, message = '') {
  const count = Number(bits) || 0;
  return createAnnouncement({
    kind: 'bits',
    title: `${count} ${count === 1 ? 'bit' : 'bits'}`,
    username,
    detail: message,
    important: true,
  });
}

/**
 * Important banner for a new subscription.
 */
export function subAnnouncement(username, plan = '', message = '') {
  const detail = [plan, message].filter(Boolean).join(' · ');
  return createAnnouncement({
    kind: 'sub',
    title: 'New SUB',
    username,
    detail,
    important: true,
  });
}

/**
 * Important banner for a resubscription.
 */
export function resubAnnouncement(username, months, plan = '', message = '') {
  const detail = [plan, message].filter(Boolean).join(' · ');
  return createAnnouncement({
    kind: 'sub',
    title: `Resub x${Number(months) || 1}`,
    username,
    detail,
    important: true,
  });
}

/**
 * Important banner for a gifted subscription.
 */
export function subGiftAnnouncement(gifter, recipient, plan = '') {
  const detail = [`to ${recipient ?? 'unknown'}`, plan].filter(Boolean).join(' · ');
  return createAnnouncement({
    kind: 'sub',
    title: 'Gift Sub',
    username: gifter,
    detail,
    important: true,
  });
}

/**
 * Important banner for a mystery multi-gift.
 */
export function mysteryGiftAnnouncement(username, count) {
  const total = Number(count) || 0;
  return createAnnouncement({
    kind: 'sub',
    title: `${total} Gift Subs`,
    username,
    detail: '',
    important: true,
  });
}
