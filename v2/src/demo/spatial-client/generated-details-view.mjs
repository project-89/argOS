/** Read-only host-published scalar measurements. Field names have no rendering
 * semantics: no animations, sounds, geometry, units or private-state inference. */
export function generatedDetailsPresentation(snapshot) {
  if (!Array.isArray(snapshot?.entities)) return [];
  const rows = [];
  for (const entity of snapshot.entities) {
    if (!entity || typeof entity.key !== 'string' || !entity.key || typeof entity.name !== 'string' || !Array.isArray(entity.details)) continue;
    const details = entity.details.filter(detail => detail && typeof detail.component === 'string' && detail.component.trim()
      && typeof detail.field === 'string' && detail.field.trim()
      && (typeof detail.value === 'boolean' || typeof detail.value === 'number' && Number.isFinite(detail.value) && Math.abs(detail.value) <= 1e6))
      .slice(0, 24).map(({ component, field, value }) => ({ component: component.slice(0, 120), field: field.slice(0, 120), value }));
    if (details.length) rows.push({ key: entity.key, name: entity.name.slice(0, 120), details });
    if (rows.length >= 24) break;
  }
  return rows;
}
