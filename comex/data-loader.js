async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.json();
}

export async function loadAllData(commodity) {
  const manifest = await fetchJSON(`${commodity}/manifest.json`);
  const docs = await Promise.all(manifest.map(f => fetchJSON(`${commodity}/${f}`)));
  return docs.filter(d => !d.empty);
}
