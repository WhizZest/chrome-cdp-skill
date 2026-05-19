import { registerCommand } from '../lib/command-registry.mjs';

registerCommand('open', async ({ cdp, args }) => {
  const url = args[0] || 'about:blank';
  const { targetId } = await cdp.send('Target.createTarget', { url });
  return { targetId, url };
});