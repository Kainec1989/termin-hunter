import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AmbiguousResponseError,
  enrichBookingLink,
  parseSlotsFromHtml,
  SessionExpiredError,
} from '../api';

const WSID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const UID = 'c97bb32a-92b8-41ba-b5c2-f91d0e90019f';

const session = {
  uid: UID,
  wsid: WSID,
  bookingUrl: `https://terminvereinbarung.leipzig.de/m/leipzig-kfz/extern/calendar/?uid=${UID}&wsid=${WSID}`,
  createdAt: Date.now(),
};

describe('parseSlotsFromHtml', () => {
  it('parses json_appointment_list', () => {
    const html = `
      <div id="json_appointment_list">{"appointments":[{"date_time":"Mo 10.06. 10:00","link":"/booking?x=1","datetime_iso86001":"2026-06-10T10:00:00+02:00","unit_uid":"loc-1"}]}</div>
    `;

    const result = parseSlotsFromHtml(html);
    assert.equal(result.slots.length, 1);
    assert.equal(result.slots[0].date_time, 'Mo 10.06. 10:00');
    assert.equal(result.slots[0].unit_uid, 'loc-1');
  });

  it('returns empty for no slots', () => {
    const result = parseSlotsFromHtml('Keine freien Termine gefunden');
    assert.equal(result.slots.length, 0);
    assert.equal(result.no_slots, true);
  });

  it('throws SessionExpiredError', () => {
    assert.throws(
      () => parseSlotsFromHtml('Ihre Sitzung ist abgelaufen'),
      SessionExpiredError,
    );
  });

  it('throws AmbiguousResponseError', () => {
    assert.throws(
      () => parseSlotsFromHtml('<html><body>???</body></html>'),
      AmbiguousResponseError,
    );
  });
});

describe('enrichBookingLink', () => {
  it('adds uid wsid lang', () => {
    const link = enrichBookingLink('/m/leipzig-kfz/extern/calendar/booking?appointment_datetime=1', session);
    const url = new URL(link);

    assert.equal(url.searchParams.get('uid'), UID);
    assert.equal(url.searchParams.get('wsid'), WSID);
    assert.equal(url.searchParams.get('lang'), 'de');
  });
});
