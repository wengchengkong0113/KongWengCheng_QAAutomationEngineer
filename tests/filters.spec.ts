import { test, expect } from '@playwright/test';
import { performSearch } from './utils/helpers';

/**
 * Test Case 2: Apply Filters (Star Rating)
 *
 * Starts from a search results page, applies a star-rating filter, and
 * verifies that:
 *   1. The filter checkbox becomes checked / the URL reflects the filter
 *   2. The result list updates (count changes and/or every card shown
 *      matches the selected star rating)
 *
 * NOTE: booking.com's filter sidebar labels the star rating options as
 * "3 stars", "4 stars", "5 stars", etc. Update STAR_RATING below to change
 * which one gets applied. If the site's markup changes, re-check the
 * locator with: npx playwright codegen https://www.booking.com
 */

const DESTINATION = 'Kuala Lumpur';
const CHECK_IN = '2026-08-10';
const CHECK_OUT = '2026-08-13';
const ADULTS = 2;
const STAR_RATING = 4; // filter to apply: 4-star properties

test.describe('Apply filters', () => {
  test('user can filter search results by star rating', async ({ page }) => {
    await performSearch(page, {
      destination: DESTINATION,
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      adults: ADULTS,
    });

    // Capture the result count before filtering
    const resultsHeading = page.getByTestId('results-headline').or(page.getByRole('heading', { level: 1 }));
    const countBefore = await page.getByTestId('property-card').count();

    // --- Apply the star rating filter ---
    const starRatingGroup = page.getByTestId('filters-group').filter({
      has: page.getByText('Star Rating', { exact: false }),
    });

    const starOption = starRatingGroup.getByLabel(new RegExp(`${STAR_RATING} stars?`, 'i'));
    await starOption.check();

    // Wait for the results list to refresh after the filter is applied
    await page.waitForResponse(
      (response) => response.url().includes('searchresults') && response.status() === 200,
      { timeout: 20000 }
    ).catch(() => {
      // Some filter interactions update via client-side XHR that may not
      // match this pattern exactly — fall back to a short settle wait.
    });
    await page.waitForTimeout(1000);

    // --- Assertions ---

    // 1. The checkbox is now checked
    await expect(starOption).toBeChecked();

    // 2. URL reflects the applied filter (booking.com uses an `nflt` query
    //    param containing class= for star rating)
    await expect(page).toHaveURL(new RegExp(`class.*${STAR_RATING}`, 'i'));

    // 3. Results updated: still showing at least one property, and the
    //    count differs from (or is a subset of) the unfiltered results
    const results = page.getByTestId('property-card');
    await expect(results.first()).toBeVisible();
    const countAfter = await results.count();
    expect(countAfter).toBeGreaterThan(0);
    expect(countAfter).toBeLessThanOrEqual(countBefore || countAfter);

    // 4. Spot-check the first few visible cards show the selected star rating
    const cardsToCheck = Math.min(3, countAfter);
    for (let i = 0; i < cardsToCheck; i++) {
      const card = results.nth(i);
      const starRatingBadge = card.getByLabel(new RegExp(`${STAR_RATING} out of 5`, 'i'));
      await expect(starRatingBadge).toBeVisible();
    }
  });
});
