import { registerCommand } from '../lib/command-registry.mjs';
import { getPages, formatPageList } from '../lib/cdp-client.mjs';

registerCommand('list', async ({ cdp }) => {
  const pages = await getPages(cdp);
  return formatPageList(pages);
});

registerCommand('list_raw', async ({ cdp }) => {
  const pages = await getPages(cdp);
  return JSON.stringify(pages);
});
