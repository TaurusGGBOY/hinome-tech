import fs from 'node:fs';
import vm from 'node:vm';
import { editedFields, linkKey, parseCatalog, receiptPattern, sourceLink } from '../worker/fields.mjs';

const source = 'public/recommendations.js';
const releaseNotes = 'public/releases.json';
const { id, state, url, ...candidate } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!receiptPattern.test(id) || state !== 'publish') throw new Error('Invalid publication request');
const entry = { id, url: sourceLink(url), ...editedFields(candidate) };
const rows = parseCatalog(fs.readFileSync(source, 'utf8'));
const releases = JSON.parse(fs.readFileSync(releaseNotes, 'utf8'));
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('public/resources.js', 'utf8'), context, { timeout: 500 });
const existing = rows.find((row) => row.id === id);
if (existing) {
  if (JSON.stringify(existing) !== JSON.stringify(entry)) throw new Error('Publication record differs');
  const release = releases.find(({ resources }) => resources?.some(({ url }) => url === entry.url));
  console.log(release?.version ?? '');
} else {
  const links = context.RESOURCE_GROUPS.flatMap(({ items }) => items).concat(rows).map(({ url }) => linkKey(url));
  if (links.includes(linkKey(entry.url))) throw new Error('Link already exists in the catalog');
  const previousVersion = /^v(\d+\.\d+)\.(\d+)$/.exec(releases[0].version);
  if (!previousVersion) throw new Error('Invalid current site version');
  const version = 'v' + previousVersion[1] + '.' + (Number(previousVersion[2]) + 1);
  const date = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format();
  const { title, url, section, description } = entry;
  releases.unshift({ version, date, title: '资源收录', resources: [{ title, url, section, description }] });
  rows.push(entry);
  fs.writeFileSync(source, 'window.HINOME_RECOMMENDATIONS = ' + JSON.stringify(rows, null, 2) + ';\n');
  fs.writeFileSync(releaseNotes, JSON.stringify(releases, null, 2) + '\n');
  console.log(version);
}
