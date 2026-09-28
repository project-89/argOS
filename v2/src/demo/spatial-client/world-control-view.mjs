/** Operator UI only. Availability never grants engine execution authority. */
export function worldControlAvailability(snapshot, localPending = false, connected = true) {
  const control = snapshot?.worldControl;
  const visible = !!control || snapshot?.scenario?.id === 'blackout';
  const pending = localPending || control?.busy === true;
  return {
    visible,
    pending,
    disabled: !connected || !snapshot?.running || control?.available !== true || pending,
    summary: control?.summary || 'Available in a running Blackout session.',
  };
}

/** HTTP success is not an applied world change. Only the exact native receipt
 * status gets a confirmed outcome; malformed/absent receipts stay unconfirmed. */
export function worldCommandReceipt(response) {
  if (!response || !['applied', 'unchanged', 'rejected'].includes(response.status)
    || typeof response.detail !== 'string' || !response.detail.trim()
    || !Number.isFinite(response.atSimMs) || response.atSimMs < 0) {
    throw new Error('The house spirit did not return a valid outcome receipt.');
  }
  return { status: response.status,
    title: response.status === 'applied' ? 'Applied to the world' : response.status === 'unchanged' ? 'No change needed' : 'Not applied',
    detail: response.detail, atSimMs: response.atSimMs };
}

export function isCurrentWorldCommand(sourceId, requestId, snapshot, latestRequestId) {
  return sourceId === snapshot?.sourceId && requestId === latestRequestId;
}
