/** Run: node src/utils/region.check.ts (from frontend/) */
import assert from 'node:assert/strict';
import {regionOf, regionsOf} from './region.ts';

assert.equal(
  regionOf('El Sheikh Zayed St, Sheikh Zayed City, Giza Governorate 12588, Egypt'),
  'Sheikh Zayed City',
);
assert.equal(regionOf('12 Tahrir St, Dokki, Giza Governorate, Egypt'), 'Dokki');
assert.equal(regionOf('90th North St, New Cairo 1, Cairo Governorate, Egypt'), 'New Cairo 1');
// Real Distance Matrix responses — the district wins over the wider city.
assert.equal(
  regionOf(
    'حدائق الاهرام عقار ٧٣, Al Omraneyah Ash Sharqeyah, Al Giza, Giza Governorate 3724113, Egypt',
  ),
  'Al Omraneyah Ash Sharqeyah',
);
assert.equal(
  regionOf('105 شارع الحكمه, First Al Sheikh Zayed, Giza Governorate 3241501, Egypt'),
  'First Al Sheikh Zayed',
);
assert.equal(regionOf('Zamalek'), 'Zamalek');
// Arabic commas and an Arabic governorate line — this once came out whole as
// "El-Khalifa، محافظة القاهرة 4414161".
assert.equal(
  regionOf('11571 شارع 9، الأباجية, El-Khalifa، محافظة القاهرة\u202c 4414161, Egypt'),
  'الأباجية',
);
assert.equal(regionOf('شارع التحرير، الدقي، محافظة الجيزة ١٢٦١١، مصر'), 'الدقي');
// Numbered districts are real regions, not postcodes.
assert.equal(regionOf('Street 90, New Cairo 1, Cairo Governorate, Egypt'), 'New Cairo 1');
assert.equal(regionOf('30.0444, 31.2357'), null); // coordinates are not an address
assert.equal(regionOf(null), null);
assert.equal(regionOf('Cairo Governorate, Egypt'), null); // nothing narrower named

assert.deepEqual(
  regionsOf(['A St, Dokki, Egypt', 'B St, Dokki, Egypt', 'C St, Zamalek, Egypt', null]),
  ['Dokki', 'Zamalek'],
);

console.log('region: ok');
