/** Operator presentation only. A God reply and a build job are not receipts of
 * native state changes; neither can mutate this client's scene. */
const statuses = new Set(['queued', 'working', 'completed', 'failed', 'cancelled']);
const pendingStatuses = new Set(['sending', 'queued', 'working']);
const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const limit = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const label = (status, role) => status === 'completed' ? role === 'god' ? 'Reply complete' : 'Request complete'
  : status === 'working' ? 'Working' : status === 'queued' ? 'Queued' : status === 'failed' ? 'Failed' : 'Cancelled';

export function developmentPresentation(snapshot, { localRequest = null, connected = true } = {}) {
  const development = snapshot?.development, visible = development?.enabled === true;
  const request = localRequest?.sourceId === snapshot?.sourceId ? localRequest : null;
  const pending = pendingStatuses.has(request?.status) || development?.busy === true;
  const messages = visible && Array.isArray(development.messages) ? development.messages.filter(message =>
    message && typeof message.id === 'string' && ['operator', 'god'].includes(message.role) && statuses.has(message.status)
    && typeof message.text === 'string' && Number.isFinite(message.atSimMs) && message.atSimMs >= 0
    && Number.isFinite(snapshot.atSimMs) && message.atSimMs <= snapshot.atSimMs).slice(-40).map(message => ({
      id: text(message.id, 180), role: message.role, text: text(message.text, 12000), status: message.status,
      label: label(message.status, message.role), atSimMs: message.atSimMs,
    })) : [];
  return { visible, pending, disabled: !visible || !connected || development?.available !== true || pending,
    canCompose: visible && connected && development?.available === true,
    status: text(development?.status, 1000), requestStatus: request?.status ?? null,
    requestDetail: request?.detail ?? '',
    limits: { maxBuildJobs: limit(development?.limits?.maxBuildJobs), maxRequests: limit(development?.limits?.maxRequests) },
    capabilities: visible && Array.isArray(development.capabilities) ? development.capabilities
      .filter(value => typeof value === 'string' && value.trim()).slice(0, 20).map(value => text(value, 240)) : [],
    jobs: visible && Array.isArray(development.jobs) ? development.jobs.filter(job => job && typeof job.id === 'string'
      && typeof job.status === 'string' && typeof job.summary === 'string').slice(-20).map(job => ({
        id: text(job.id, 180), status: text(job.status, 80), summary: text(job.summary, 1500),
      })) : [], messages };
}

/** One source-scoped submission at a time. An uncertain transport result keeps
 * its UUID and exact text for an explicit retry, never a fresh duplicate job.
 * The operator message's id is the requestId and its status is authoritative. */
export function createGodCommandState({ createRequestId = () => crypto.randomUUID() } = {}) {
  let sourceId = null, request = null;
  const current = (snapshot, token) => token && token.sourceId === snapshot?.sourceId && sourceId === token.sourceId
    && request?.requestId === token.requestId;
  const accept = status => {
    const acceptedText = request.acknowledged ? null : request.text;
    request.acknowledged = true; request.detail = '';
    if (!terminalStatuses.has(request.status) && !(request.status === 'working' && status === 'queued')) request.status = status;
    return { acceptedText };
  };
  const sync = snapshot => {
    if (sourceId !== snapshot?.sourceId) { sourceId = snapshot?.sourceId ?? null; request = null; }
    const row = request && developmentPresentation(snapshot).messages.find(message => message.id === request.requestId
      && message.role === 'operator' && message.text === request.text);
    return row ? accept(row.status) : { acceptedText: null };
  };
  return {
    sync,
    view(snapshot, connected = true) { return developmentPresentation(snapshot, { localRequest: request, connected }); },
    begin(snapshot, draft, connected = true) {
      sync(snapshot);
      const value = typeof draft === 'string' ? draft.trim() : '';
      if (!value || developmentPresentation(snapshot, { localRequest: request, connected }).disabled) return null;
      if (value.length > 2000) throw new Error('Keep the request within 2000 characters.');
      if (request?.status === 'unconfirmed' && value !== request.text) throw new Error('Retry the unchanged request or wait for its delivery status before writing another.');
      if (request?.status !== 'unconfirmed') {
        const requestId = createRequestId();
        if (!uuid.test(requestId)) throw new Error('A secure request identifier is unavailable. Reload before sending.');
        request = { sourceId, requestId, text: value, acknowledged: false, detail: '' };
      }
      request.status = 'sending'; request.detail = '';
      return { sourceId, requestId: request.requestId, text: request.text };
    },
    receive(snapshot, token, response) {
      if (!current(snapshot, token)) return null;
      if (!response || response.sourceId !== token.sourceId || response.requestId !== token.requestId
        || !statuses.has(response.status) || !Number.isFinite(response.atSimMs) || response.atSimMs < 0)
        throw new Error('God did not return a valid request acknowledgement. Delivery remains unconfirmed.');
      return accept(response.status);
    },
    fail(snapshot, token, detail) {
      if (!current(snapshot, token)) return false;
      // A polling acknowledgement wins over a later transport failure.
      if (!request.acknowledged) { request.status = 'unconfirmed'; request.detail = text(detail, 1000); }
      return true;
    },
  };
}
