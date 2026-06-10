/**
 * Общие утилиты парсинга Smart CX HTML (CSRF, session expiry).
 */

export function extractCsrf(html: string): { name: string; value: string } | null {
  const match = html.match(
    /<input[^>]*id=["']RequestVerificationToken["'][^>]*name=["']([^"']+)["'][^>]*value=["']([^"']+)["'][^>]*>/i,
  );

  if (match) return { name: match[1], value: match[2] };

  const alt = html.match(
    /<input[^>]*name=["']([^"']+)["'][^>]*id=["']RequestVerificationToken["'][^>]*value=["']([^"']+)["'][^>]*>/i,
  );

  if (alt) return { name: alt[1], value: alt[2] };

  return null;
}

/** Живая страница с контентом — не считать session_expired */
function hasLivePageMarkers(html: string): boolean {
  return /Keine freien Termine|json_appointment_list|services-list|step_search_results|RequestVerificationToken/i.test(
    html,
  );
}

/** Не путать с JS url_expired: "session_expired?uid=..." на живой странице */
export function isSessionExpiredHtml(html: string): boolean {
  if (/Ihre Sitzung ist abgelaufen/i.test(html)) return true;
  if (/Sitzung abgelaufen/i.test(html)) return true;
  if (/id=["']step_session_expired["']/i.test(html)) return true;
  if (hasLivePageMarkers(html)) return false;
  if (/Object moved/i.test(html)) return true;
  return false;
}

export function isNoSlotsHtml(html: string): boolean {
  return /Keine freien Termine gefunden|nothing_Found|nothing_found/i.test(html);
}

export function hasJsonAppointmentList(html: string): boolean {
  return /id=["']json_appointment_list["']/i.test(html);
}

export function isAmbiguousHtml(html: string): boolean {
  if (!html.trim()) return true;
  if (isSessionExpiredHtml(html)) return false;
  if (isNoSlotsHtml(html)) return false;
  if (hasJsonAppointmentList(html)) return false;
  if (/"date_time"\s*:\s*"/.test(html)) return false;
  return true;
}

export function isBookingSuccessHtml(html: string, finalUrl: string): boolean {
  if (/session_expired|fehlgeschlagen/i.test(html) && !/erfolg|bestätig|confirmation|buchung.*erfolg/i.test(html)) {
    return false;
  }

  if (/erfolg|bestätig|confirmation|buchung.*erfolg|termin.*gebucht/i.test(html)) {
    return true;
  }

  if (/step_finish|booking.*success|finish/i.test(finalUrl)) {
    return true;
  }

  if (/fehler|error|fehlgeschlagen/i.test(html)) {
    return false;
  }

  // POST прошёл без явной ошибки — осторожный успех
  return !isSessionExpiredHtml(html);
}
