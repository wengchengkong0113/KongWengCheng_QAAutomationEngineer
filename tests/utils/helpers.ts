import { Page, expect } from '@playwright/test';

/**
 * booking.com regularly shows interruption overlays (cookie consent banner,
 * "Sign in, save money" modal, currency/genius promo popups). These need to
 * be dismissed before interacting with the page, otherwise clicks on the
 * search form can be intercepted.
 */
export async function dismissOverlays(page: Page): Promise<void> {
  // Cookie consent banner
  const acceptCookies = page.getByRole('button', { name: /Accept/i });
  try {
    await acceptCookies.click({ timeout: 5000 });
  } catch {
    // banner not shown — continue
  }

  // "Sign in, save money" / genius login modal — close via the X button
  const closeModal = page.getByRole('button', { name: /Dismiss sign in information/i });
  try {
    await closeModal.click({ timeout: 3000 });
  } catch {
    // modal not shown — continue
  }

  // Generic close buttons for any other promo/interstitial modal
  const genericClose = page.getByRole('button', { name: /^close$/i }).first();
  try {
    await genericClose.click({ timeout: 2000 });
  } catch {
    // none shown — continue
  }

  // Nudge away any lingering dropdown/overlay animation
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
}

/**
 * Clicks a locator, tolerating the transient "subtree intercepts pointer
 * events" issue booking.com's animated search widget sometimes triggers
 * right after page load. Tries a normal click first; if that's still being
 * blocked after a short settle, falls back to a forced click.
 */
async function robustClick(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
  try {
    await locator.click({ timeout: 8000 });
    return;
  } catch {
    // fall through to retry
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click({ timeout: 8000, force: true });
}

/**
 * Builds a set of regexes matching how a calendar day's accessible name
 * (aria-label / visible text) commonly reads, e.g. "10 August 2026",
 * "August 10, 2026", "Aug 10, 2026". Used as a fallback when a raw
 * `data-date` attribute isn't present on the current markup.
 */
function buildDateLabelRegexes(isoDate: string): RegExp[] {
  const d = new Date(`${isoDate}T00:00:00`);
  const day = d.getDate();
  const monthLong = d.toLocaleString('en-US', { month: 'long' });
  const monthShort = d.toLocaleString('en-US', { month: 'short' });
  const year = d.getFullYear();
  return [
    new RegExp(`,\\s*${day}\\s+${monthLong}\\s+${year}\\b`, 'i'), // "Monday, 10 August 2026" (confirmed real format)
    new RegExp(`\\b${day}\\s+${monthLong}\\s+${year}\\b`, 'i'),
    new RegExp(`\\b${monthLong}\\s+${day},?\\s+${year}\\b`, 'i'),
    new RegExp(`\\b${monthShort}\\s+${day},?\\s+${year}\\b`, 'i'),
  ];
}

/**
 * Finds and clicks a calendar day cell for the given ISO date, trying the
 * legacy `[data-date]` attribute first and falling back to accessible-name
 * matching (button/gridcell aria-label or text). Throws with diagnostics
 * (screenshot + full page HTML dump) if nothing matches.
 */
async function selectCalendarDate(page: Page, isoDate: string): Promise<void> {
  const attrCandidate = page.locator(`[data-date="${isoDate}"]`).first();
  if (await attrCandidate.isVisible({ timeout: 3000 }).catch(() => false)) {
    await robustClick(page, attrCandidate);
    return;
  }

  const labelRegexes = buildDateLabelRegexes(isoDate);
  for (const regex of labelRegexes) {
    const byCheckbox = page.getByRole('checkbox', { name: regex }).first();
    if (await byCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await robustClick(page, byCheckbox);
      return;
    }
    const byRole = page.getByRole('button', { name: regex }).first();
    if (await byRole.isVisible({ timeout: 2000 }).catch(() => false)) {
      await robustClick(page, byRole);
      return;
    }
    const byGridCell = page.getByRole('gridcell', { name: regex }).first();
    if (await byGridCell.isVisible({ timeout: 2000 }).catch(() => false)) {
      await robustClick(page, byGridCell);
      return;
    }
    const byLabel = page.getByLabel(regex).first();
    if (await byLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
      await robustClick(page, byLabel);
      return;
    }
  }

  // Nothing matched — dump diagnostics so the failure is actionable
  const safeName = isoDate.replace(/[^0-9a-zA-Z-]/g, '');
  await page.screenshot({ path: `test-results/calendar-not-found-${safeName}.png`, fullPage: true });
  const html = await page.content();
  const fs = await import('fs');
  await fs.promises.mkdir('test-results', { recursive: true }).catch(() => {});
  await fs.promises.writeFile(`test-results/calendar-page-dump-${safeName}.html`, html).catch(() => {});
  throw new Error(
    `Could not find a calendar cell for ${isoDate} using [data-date] or accessible-name matching. ` +
    `Check test-results/calendar-not-found-${safeName}.png and ` +
    `test-results/calendar-page-dump-${safeName}.html for the actual markup, ` +
    'or re-record with npx playwright codegen.'
  );
}

export interface SearchParams {
  destination: string;
  /** Format: YYYY-MM-DD */
  checkIn: string;
  /** Format: YYYY-MM-DD */
  checkOut: string;
  adults: number;
}

/**
 * Fills in the homepage search widget (destination, dates, occupancy) and
 * submits the search. Leaves the browser on the search results page.
 *
 * NOTE: booking.com's DOM/attributes change fairly often. If a locator
 * below stops matching, re-record it with:
 *   npx playwright codegen https://www.booking.com
 */
export async function performSearch(page: Page, params: SearchParams): Promise<void> {
  const { destination, checkIn, checkOut, adults } = params;

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');
  await dismissOverlays(page);

  // --- Destination ---
  // Try a few known/likely selectors in order, since booking.com's markup
  // shifts between data-testid, id="ss", and plain placeholder text
  // depending on region/experiment. First one that appears wins.
  const destinationCandidates = [
    page.locator('input#ss'),
    page.getByPlaceholder(/where are you going/i),
    page.getByTestId('destination-container').getByRole('combobox'),
    page.locator('[name="ss"]'),
  ];

  let destinationInput = destinationCandidates[0];
  let found = false;
  for (const candidate of destinationCandidates) {
    if (await candidate.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      destinationInput = candidate.first();
      found = true;
      break;
    }
  }
  if (!found) {
    // Surface a screenshot + page dump before failing, to make diagnosis easier
    await page.screenshot({ path: 'test-results/destination-not-found.png', fullPage: true });
    throw new Error(
      'Could not locate the destination search input with any known selector. ' +
      'Run `npx playwright codegen https://www.booking.com` to find the current one, ' +
      'or check test-results/destination-not-found.png.'
    );
  }

  await robustClick(page, destinationInput);
  await destinationInput.fill(destination);

  // Select the first autocomplete suggestion. Rather than depending on an
  // exact suggestion-item selector (which changes often), use the keyboard —
  // booking.com's autocomplete listbox supports arrow-down + enter.
  await page.waitForTimeout(800); // let suggestions render
  await destinationInput.press('ArrowDown');
  await destinationInput.press('Enter');

  // --- Dates ---
  // On the current booking.com UI, after picking a destination the whole
  // search widget collapses into a single compact summary button
  // (data-testid="search-overview", e.g. "Kuala Lumpur, 9 Jul - 16 Jul").
  // Clicking it opens a "Select dates" panel (data-testid="search-dates-close"
  // on its close button) containing the calendar. Each day is rendered as
  // <span role="checkbox" data-date="YYYY-MM-DD" aria-label="Monday, 10 August 2026">
  // inside a <td role="gridcell">, and a data-testid="sb-dates-apply" button
  // confirms the selected range.
  const searchOverviewTrigger = page.getByTestId('search-overview');
  if (await searchOverviewTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
    await robustClick(page, searchOverviewTrigger);
    await page.waitForTimeout(500); // let the overlay/sheet finish opening

    // The search-overview button appears to open an intermediate overlay
    // with separate destination/dates/guests sub-fields (mirroring the old
    // 3-field layout), rather than jumping straight to the calendar. Try a
    // handful of likely triggers for the "dates" sub-field within it.
    if (!(await page.locator('[data-date]').first().isVisible({ timeout: 2000 }).catch(() => false))) {
      const dateSubTriggerCandidates = [
        page.getByTestId('searchbox-dates-container'),
        page.getByTestId('search-dates'),
        page.getByRole('button', { name: /\d{1,2}\s+\w{3}\s*[-–]\s*\d{1,2}\s+\w{3}/ }), // e.g. "9 Jul - 16 Jul"
        page.getByRole('button', { name: /check[- ]?in/i }),
      ];
      let subTriggerFound = false;
      for (const candidate of dateSubTriggerCandidates) {
        if (await candidate.first().isVisible({ timeout: 2000 }).catch(() => false)) {
          await robustClick(page, candidate.first());
          subTriggerFound = true;
          break;
        }
      }
      if (!subTriggerFound) {
        // Dump the intermediate overlay so we can see what sub-fields it
        // actually contains, in case none of the guessed candidates matched
        const overlayHtml = await page.content();
        const fs = await import('fs');
        await fs.promises.mkdir('test-results', { recursive: true }).catch(() => {});
        await fs.promises
          .writeFile('test-results/overlay-after-search-overview-click.html', overlayHtml)
          .catch(() => {});
      }
    }
  } else {
    // Fall back to the older separate dates-button UI, in case this run
    // landed on that variant instead
    const datesButton = page.getByTestId('searchbox-dates-container');
    if (await datesButton.isVisible().catch(() => false)) {
      await robustClick(page, datesButton);
    }
  }

  // Wait for the "Select dates" panel to actually render before looking for
  // day cells inside it — this is what previous attempts were missing.
  const datesPanelReady = page.locator('[data-date]').first();
  if (!(await datesPanelReady.isVisible({ timeout: 10000 }).catch(() => false))) {
    await page.screenshot({ path: 'test-results/calendar-not-visible.png', fullPage: true });
    const html = await page.content();
    const fs = await import('fs');
    await fs.promises.mkdir('test-results', { recursive: true }).catch(() => {});
    await fs.promises.writeFile('test-results/panel-after-search-overview.html', html).catch(() => {});
    throw new Error(
      'The "Select dates" panel did not render any [data-date] cells within 10s of clicking ' +
      'the search-overview trigger. Check test-results/calendar-not-visible.png and ' +
      'test-results/panel-after-search-overview.html.'
    );
  }

  await selectCalendarDate(page, checkIn);
  await selectCalendarDate(page, checkOut);

  // Confirm the date range
  const applyDatesButton = page.getByTestId('sb-dates-apply');
  if (await applyDatesButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await robustClick(page, applyDatesButton);
  }

  // --- Occupancy (adults) ---

  const occupancyTrigger = page.getByTestId('occupancy-config');
  if (!(await occupancyTrigger.isVisible({ timeout: 5000 }).catch(() => false))) {
    await page.screenshot({ path: 'test-results/occupancy-not-found.png', fullPage: true });
    throw new Error(
      'Could not find the occupancy/guests control (data-testid="occupancy-config"). ' +
      'Check test-results/occupancy-not-found.png or re-record with npx playwright codegen.'
    );
  }
  await robustClick(page, occupancyTrigger);

  const adultsInput = page.getByTestId('occupancy-adults');
  const currentAdultsText = await adultsInput.textContent();
  const currentAdults = parseInt(currentAdultsText ?? '2', 10);

  const diff = adults - currentAdults;
  if (diff > 0) {
    const increaseBtn = page.getByTestId('occupancy-adults-increase-button');
    for (let i = 0; i < diff; i++) {
      await increaseBtn.click();
    }
  } else if (diff < 0) {
    const decreaseBtn = page.getByTestId('occupancy-adults-decrease-button');
    for (let i = 0; i < Math.abs(diff); i++) {
      await decreaseBtn.click();
    }
  }

  // Close occupancy panel
  await robustClick(page, page.getByTestId('occupancy-config'));

  // --- Submit search ---
  await robustClick(page, page.getByRole('button', { name: /^Search$/i }));

  // Wait for results page to load
  await expect(page).toHaveURL(/searchresults/);
  await page.getByTestId('property-card').first().waitFor({ state: 'visible', timeout: 20000 });
}