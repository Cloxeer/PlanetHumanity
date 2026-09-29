/** THIS FILE DOES: Locks the low-bandwidth globe loading policy (auto / on-demand / off) with unit tests, ROLE: Automation, MAINTAINER NOTE: If one of these cases changes, 3G and data-saver users start silently downloading ~0.6 MB they never asked for. **/
import test from 'node:test';
import assert from 'node:assert/strict';
import { globePolicy } from '../src/ui/GlobeStage.js';

const p = (search, connection, webgl = true) => globePolicy({ search, connection, webgl });

test('fast or unknown connection auto-loads the globe', () => {
  assert.equal(p('', { effectiveType: '4g' }), 'auto');
  assert.equal(p('', undefined), 'auto');
});

test('3G, 2G and data-saver never auto-download the globe', () => {
  for (const effectiveType of ['3g', '2g', 'slow-2g']) assert.equal(p('', { effectiveType }), 'on-demand');
  assert.equal(p('', { effectiveType: '4g', saveData: true }), 'on-demand');
});

test('no WebGL means list only, even when ?view=globe is requested', () => {
  assert.equal(p('?view=globe', { effectiveType: '4g' }, false), 'off');
});

test('URL overrides', () => {
  assert.equal(p('?view=list', { effectiveType: '4g' }), 'off');
  assert.equal(p('?view=globe', { effectiveType: '3g' }), 'auto');
});
