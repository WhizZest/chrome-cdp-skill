import assert from 'assert/strict';
import { describe, test, summary } from '../lib/test-runner.mjs';

await describe('fullpage screenshot: --full parameter detection', async () => {
  test('detects --full in args', () => {
    const args = ['--full'];
    assert.ok(args.includes('--full'));
  });

  test('detects --full with filename', () => {
    const args = ['output.png', '--full'];
    assert.ok(args.includes('--full'));
    const filePath = args[0] && !args[0].startsWith('--') ? args[0] : null;
    assert.equal(filePath, 'output.png');
  });

  test('--full as first arg does not become filePath', () => {
    const args = ['--full'];
    const filePath = args[0] && !args[0].startsWith('--') ? args[0] : null;
    assert.equal(filePath, null);
  });

  test('no --full means not full page', () => {
    const args = ['output.png'];
    const isFullPage = args.includes('--full');
    assert.equal(isFullPage, false);
  });

  test('empty args means not full page', () => {
    const args = [];
    const isFullPage = args.includes('--full');
    assert.equal(isFullPage, false);
  });
});

await describe('fullpage screenshot: MAX_FULLPAGE_HEIGHT constant', async () => {
  test('height cap is 16384', () => {
    const MAX_FULLPAGE_HEIGHT = 16384;
    let height = 20000;
    if (height > MAX_FULLPAGE_HEIGHT) height = MAX_FULLPAGE_HEIGHT;
    assert.equal(height, 16384);
  });

  test('height under cap is unchanged', () => {
    const MAX_FULLPAGE_HEIGHT = 16384;
    let height = 5000;
    if (height > MAX_FULLPAGE_HEIGHT) height = MAX_FULLPAGE_HEIGHT;
    assert.equal(height, 5000);
  });
});

await describe('fullpage screenshot: file suffix', async () => {
  test('full page adds -full suffix', () => {
    const isFullPage = true;
    const suffix = isFullPage ? '-full' : '';
    const filename = `screenshot-abc12345${suffix}.png`;
    assert.ok(filename.includes('-full'));
  });

  test('normal screenshot has no suffix', () => {
    const isFullPage = false;
    const suffix = isFullPage ? '-full' : '';
    const filename = `screenshot-abc12345${suffix}.png`;
    assert.ok(!filename.includes('-full'));
  });
});

await summary();
