import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEntryType } from './plugin-manager.mjs';

describe('getEntryType', () => {
  describe('显式 type 字段', () => {
    it('type: "doc" 返回 doc', () => {
      assert.equal(getEntryType({ entry: 'test.md', type: 'doc' }), 'doc');
    });

    it('type: "script" 返回 script', () => {
      assert.equal(getEntryType({ entry: 'test.mjs', type: 'script' }), 'script');
    });

    it('显式 type 优先于扩展名', () => {
      assert.equal(getEntryType({ entry: 'test.mjs', type: 'doc' }), 'doc');
      assert.equal(getEntryType({ entry: 'test.md', type: 'script' }), 'script');
    });
  });

  describe('扩展名自动推断', () => {
    it('.md 推断为 doc', () => {
      assert.equal(getEntryType({ entry: 'weread-skills/SKILL.md' }), 'doc');
    });

    it('.mjs 推断为 script', () => {
      assert.equal(getEntryType({ entry: 'extract-chapter.mjs' }), 'script');
    });

    it('其他扩展名默认推断为 script', () => {
      assert.equal(getEntryType({ entry: 'test.js' }), 'script');
      assert.equal(getEntryType({ entry: 'test.ts' }), 'script');
    });

    it('无扩展名默认推断为 script', () => {
      assert.equal(getEntryType({ entry: 'Makefile' }), 'script');
    });

    it('entry 为空字符串不崩溃', () => {
      assert.equal(getEntryType({ entry: '' }), 'script');
    });
  });

  describe('未知 type 值回退扩展名', () => {
    it('type: "unknown" 回退扩展名推断', () => {
      assert.equal(getEntryType({ entry: 'test.md', type: 'unknown' }), 'doc');
      assert.equal(getEntryType({ entry: 'test.mjs', type: 'unknown' }), 'script');
    });
  });

  describe('设计规格全覆盖', () => {
    it('所有组合正确推断', () => {
      const cases = [
        { feature: { entry: 'doc.md', type: 'doc' }, expected: 'doc' },
        { feature: { entry: 'script.mjs', type: 'script' }, expected: 'script' },
        { feature: { entry: 'script.mjs' }, expected: 'script' },
        { feature: { entry: 'doc.md' }, expected: 'doc' },
        { feature: { entry: 'sub/dir/doc.md' }, expected: 'doc' },
      ];
      for (const { feature, expected } of cases) {
        assert.equal(getEntryType(feature), expected);
      }
    });
  });
});