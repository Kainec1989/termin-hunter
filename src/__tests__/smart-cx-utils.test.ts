import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCsrf,
  isAmbiguousHtml,
  isBookingSuccessHtml,
  isNoSlotsHtml,
  isSessionExpiredHtml,
} from '../smart-cx-utils';

describe('extractCsrf', () => {
  it('finds token by id then name', () => {
    const html =
      '<input id="RequestVerificationToken" name="__RequestVerificationToken" value="abc123" />';
    assert.deepEqual(extractCsrf(html), {
      name: '__RequestVerificationToken',
      value: 'abc123',
    });
  });

  it('returns null when missing', () => {
    assert.equal(extractCsrf('<html></html>'), null);
  });
});

describe('isSessionExpiredHtml', () => {
  it('detects German session expired message', () => {
    assert.equal(isSessionExpiredHtml('Ihre Sitzung ist abgelaufen'), true);
    assert.equal(isSessionExpiredHtml('Sitzung abgelaufen'), true);
  });

  it('ignores live calendar page', () => {
    const html = '<div id="json_appointment_list">{}</div>';
    assert.equal(isSessionExpiredHtml(html), false);
  });

  it('detects Object moved without live markers', () => {
    assert.equal(isSessionExpiredHtml('<html>Object moved</html>'), true);
  });
});

describe('isNoSlotsHtml', () => {
  it('detects nothing found', () => {
    assert.equal(isNoSlotsHtml('Keine freien Termine gefunden'), true);
    assert.equal(isNoSlotsHtml('"appointments":"nothing_Found"'), true);
  });
});

describe('isAmbiguousHtml', () => {
  it('flags empty response', () => {
    assert.equal(isAmbiguousHtml(''), true);
  });

  it('accepts no-slots page', () => {
    assert.equal(isAmbiguousHtml('Keine freien Termine gefunden'), false);
  });
});

describe('isBookingSuccessHtml', () => {
  it('detects success markers', () => {
    assert.equal(isBookingSuccessHtml('Ihre Buchung war erfolgreich', ''), true);
    assert.equal(isBookingSuccessHtml('ok', 'https://x.de/step_finish'), true);
  });

  it('rejects explicit failure', () => {
    assert.equal(isBookingSuccessHtml('Buchung fehlgeschlagen', ''), false);
  });
});
