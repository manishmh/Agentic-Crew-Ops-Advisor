// Reports filenames only; never print credential matches or environment values.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
const env = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};
const secrets = Object.entries({ ...process.env, ...env }).filter(([key, value]) => /API_KEY$/.test(key) && value && value.length >= 8).map(([, value]) => value);
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const bundleFiles = [];
function walk(path) { for (const entry of readdirSync(path, { withFileTypes: true })) { const next = path + '/' + entry.name; if (entry.isDirectory()) walk(next); else bundleFiles.push(next); } }
if (existsSync('frontend/dist')) walk('frontend/dist');
const matches = [];
for (const path of new Set([...files, ...bundleFiles])) {
  if (!existsSync(path)) continue;
  const text = readFileSync(path, 'utf8');
  if (secrets.some(secret => text.includes(secret)) || /\b(?:sk-proj-|gsk_)[A-Za-z0-9_-]{24,}/.test(text)) matches.push(path);
}
const trackedEnv = execFileSync('git', ['ls-files', '--', '.env'], { encoding: 'utf8' }).trim();
if (trackedEnv || matches.length) { console.error('FAIL secret audit: ' + [...new Set([...matches, ...(trackedEnv ? ['.env is tracked'] : [])])].join(', ')); process.exitCode = 1; }
else console.log('PASS secret audit: tracked/new source and frontend bundle; no credential matches; .env not tracked.');
