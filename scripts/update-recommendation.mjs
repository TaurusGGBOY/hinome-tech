import fs from 'node:fs';
import vm from 'node:vm';
import { editedFields, linkKey, parseCatalog, receiptPattern, sourceLink } from '../worker/fields.mjs';

const source = 'public/recommendations.js';
const { id, state, url, ...candidate } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!receiptPattern.test(id) || state !== 'publish') throw new Error('Invalid publication request');
const entry = { id, url: sourceLink(url), ...editedFields(candidate) };
const rows = parseCatalog(fs.readFileSync(source, 'utf8'));
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('public/resources.js', 'utf8'), context, { timeout: 500 });
const existing = rows.find((row) => row.id === id);
if (existing) {
  if (JSON.stringify(existing) !== JSON.stringify(entry)) throw new Error('Publication record differs');
} else {
  const links = context.RESOURCE_GROUPS.flatMap(({ items }) => items).concat(rows).map(({ url }) => linkKey(url));
  if (links.includes(linkKey(entry.url))) throw new Error('Link already exists in the catalog');
  rows.push(entry);
  fs.writeFileSync(source, 'window.HINOME_RECOMMENDATIONS = ' + JSON.stringify(rows, null, 2) + ';\n');
}
