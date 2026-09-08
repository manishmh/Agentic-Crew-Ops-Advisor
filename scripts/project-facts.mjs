import { readFileSync, writeFileSync } from 'node:fs';
const read = (path) => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const flights = read('data/flights.json');
const facts = {
  offlineCases: (readFileSync(new URL('../evals/agentCases.ts', import.meta.url), 'utf8').match(/^  c\(/gm) ?? []).length,
  flights: flights.length,
  crew: read('data/crew.json').length,
  pairings: read('data/rosters.json').pairings.length,
  reserves: read('data/reserve_pool.json').length,
  certifications: read('data/certifications.json').length,
  stations: new Set(flights.flatMap(f => [f.dep_station, f.arr_station])).size,
};
// Only aggregate counts reach the browser; no operational records or env values.
writeFileSync(new URL('../frontend/src/data/projectFacts.json', import.meta.url), JSON.stringify(facts, null, 2) + '\n');
