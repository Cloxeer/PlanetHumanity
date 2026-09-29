/** THIS FILE DOES: Locks the reference-photo relevance rule with real cases from the live Wikipedia audit, ROLE: Automation, MAINTAINER NOTE: Every case here was a real wrong or missed match once; if you loosen relevant(), a person or the wrong university will show up as a paper's "reference photo" again. **/
import test from 'node:test';
import assert from 'node:assert/strict';
import { relevant } from '../src/ui/RefImage.js';

const ok = (title, term, city) => relevant({ title }, term, false, city);

test('rejects people and look-alike institutions', () => {
  assert.equal(ok('Desmond Tutu', 'Desmond Tutu HIV Centre, University of Cape Town', 'Cape Town'), false);
  assert.equal(ok("King's College London", 'Institute of Cardiovascular Sciences, University College London', 'London'), false);
  assert.equal(ok('University of Toronto Faculty of Medicine', 'Department of Ophthalmology, Osaka University Graduate School of Medicine', 'Osaka'), false);
});

test('accepts the right institution', () => {
  assert.equal(ok('Columbia University Irving Medical Center', 'Department of Pediatrics, Columbia University Irving Medical Center', 'New York'), true);
  assert.equal(ok('Sun Yat-sen University', 'Sun Yat-sen University Cancer Center', 'Guangzhou'), true);
  assert.equal(ok('Institute of Hematology and Blood Diseases Hospital, CAMS & PUMC', 'Institute of Hematology & Blood Diseases Hospital, Chinese Academy of Medical Sciences & Peking Union Medical College', 'Tianjin'), true);
});

test('a city-named university still matches (city is its distinctive word)', () => {
  assert.equal(ok('University of Oxford', 'University of Oxford', 'Oxford'), true);
  assert.equal(ok('Uppsala University', 'Department of Medical Cell Biology, Uppsala University', 'Uppsala'), true);
});

test('city fallback must be the city page itself', () => {
  assert.equal(relevant({ title: 'Milan' }, 'Milan', true), true);
  assert.equal(relevant({ title: 'Luigi Naldini' }, 'Milan', true), false);
});
