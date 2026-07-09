import { test, expect } from '@playwright/test';
import { performSearch } from './utils/helpers';

/**
 * Test Case 1: Search Function
 *
 * Verifies that a user can search for a destination on booking.com with
 * specific check-in/check-out dates and 2 adult guests, and lands on a
 * search results page that reflects that search.
 *
 * Adjust DESTINATION / CHECK_IN / CHECK_OUT below, or pull them from
 * environment variables / a test-data file if you want to parameterize runs.
 */

const DESTINATION = 'Kuala Lumpur';
const CHECK_IN = '2026-08-10';
const CHECK_OUT = '2026-08-13';
const ADULTS = 2;

test.describe('Search function', () => {
  test('user can search a destination with dates and guests', async ({ page }) => {
    await performSearch(page, {
      destination: DESTINATION,
      checkIn: CHECK_IN,
      checkOut: CHECK_OUT,
      adults: ADULTS,
    });

    // 1. URL reflects the search
    await expect(page).toHaveURL(/searchresults/);

    // 2. Destination input on the results page shows what we searched for
    const destinationDisplay = page.getByTestId('destination-container').getByRole('combobox');
    await expect(destinationDisplay).toHaveValue(new RegExp(DESTINATION, 'i'));

    // 3. Results are actually returned
    const results = page.getByTestId('property-card');
    await expect(results.first()).toBeVisible();
    const resultCount = await results.count();
    expect(resultCount).toBeGreaterThan(0);

    // 4. Sanity check: heading/results summary mentions the destination
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      new RegExp(DESTINATION, 'i')
    );
  });
});
