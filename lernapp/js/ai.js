// OPTIONALE Schnittstelle für eine KI-Bewertung der mündlichen Antworten.
// Standardmäßig AUS – die App bewertet dann rein lokal (evaluate.js).
//
// Wenn in den Einstellungen aktiviert und eine URL eingetragen ist, sendet die App pro Antwort
// genau EINEN POST an diese URL (z. B. ein KI-Server in deinem WLAN oder ein eigener Proxy).
//
// Anfrage (JSON):
//   { model?, question, modelAnswer, keyPoints:[label,…], transcript }
// Erwartete Antwort (JSON):
//   { percent: 0-100, matchedPoints?: [label,…], missingPoints?: [label,…], feedback?: "Text" }
//
// Eigenes Protokoll (z. B. OpenAI-kompatibel)? -> nur diese Datei anpassen (buildRequest/parseResponse).

import { state } from './store.js';

export const aiConfigured = () => !!state.settings.aiEnabled && /^https?:\/\//i.test(state.settings.aiUrl || '');

function buildRequest(q, transcript) {
  const s = state.settings;
  return {
    url: s.aiUrl,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(s.aiKey ? { Authorization: `Bearer ${s.aiKey}` } : {}) },
      body: JSON.stringify({
        ...(s.aiModel ? { model: s.aiModel } : {}),
        question: q.question, modelAnswer: q.modelAnswer, keyPoints: q.keyPoints.map((k) => k.label), transcript,
      }),
    },
  };
}

function parseResponse(j, q) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(j.percent))));
  if (!Number.isFinite(percent)) throw new Error('Antwort der KI ohne "percent"');
  const matchedSet = new Set((j.matchedPoints || []).map(String));
  const missingSet = new Set((j.missingPoints || []).map(String));
  const all = q.keyPoints.map((k) => k.label);
  const matched = all.filter((l) => matchedSet.has(l)).map((label) => ({ label, via: 'KI' }));
  const missing = (missingSet.size ? all.filter((l) => missingSet.has(l)) : all.filter((l) => !matchedSet.has(l))).map((label) => ({ label }));
  return { percent, matched, missing, feedback: j.feedback ? String(j.feedback) : '', words: 0, engine: 'ai' };
}

export async function evaluateWithAI(q, transcript) {
  const { url, init } = buildRequest(q, transcript);
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`KI-Endpunkt antwortete mit Status ${res.status}`);
  return parseResponse(await res.json(), q);
}
