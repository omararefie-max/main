/* OPTIONALE Schnittstelle für eine KI-Bewertung mündlicher Antworten.
 *
 * Standard: AUS (aiEndpoint leer) → Bewertung läuft rein lokal (js/score.js).
 *
 * Wenn du einen Endpunkt einträgst (Einstellungen → Erweitert), sendet die App pro Antwort ein POST mit
 *   { question, modelAnswer, keyPoints, transcript }
 * und erwartet als JSON-Antwort (alle Felder optional):
 *   { percent: 0..100, covered: [true,false,...] (je Pflichtpunkt), feedback: "Text" }
 *
 * ACHTUNG: Dann verlassen Transkripte dein Gerät! Außerdem muss in index.html die Content-Security-Policy
 * (connect-src) um die Adresse des Endpunkts erweitert werden. Ein lokal laufender Dienst
 * (z. B. Ollama hinter einem kleinen Proxy im Heimnetz) hält die Daten trotzdem in deiner Hand.
 */
export async function aiEvaluate(q, transcript, settings) {
  if (!settings.aiEndpoint) return null;
  const res = await fetch(settings.aiEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: q.question, modelAnswer: q.modelAnswer, keyPoints: q.keyPoints, transcript })
  });
  if (!res.ok) throw new Error('KI-Endpunkt antwortete mit Status ' + res.status);
  return res.json();
}
