# Booking.com Playwright Automation (TypeScript)

Two automated test cases against **booking.com**:

1. `tests/search.spec.ts` — Search a destination (Kuala Lumpur) with check-in/check-out dates and 2 guests.
2. `tests/filters.spec.ts` — Starting from search results, apply a **Star Rating** filter and verify it takes effect.

Shared logic (dismissing cookie/login popups, performing a search) lives in `tests/utils/helpers.ts` so both specs stay DRY.

## Setup in VS Code

1. **Open the folder** in VS Code (`File > Open Folder…` → select `booking-tests`).
2. **Install Node.js** (v18+) if you don't have it already.
3. Open a terminal in VS Code (`` Ctrl+` ``) and run:
   ```bash
   npm install
   npx playwright install --with-deps chromium
   ```
4. (Optional but recommended) Install the **Playwright Test for VS Code** extension from the Extensions marketplace — it lets you run/debug individual tests from the editor gutter and gives you a Test Explorer view.

## Running the tests

```bash
# Run everything, headless
npm test

# Run everything with a visible browser window
npm run test:headed

# Run with Playwright's interactive UI mode (great for debugging)
npm run test:ui

# Run a single spec
npm run test:search
npm run test:filters

# View the HTML report after a run
npm run report
```

## Project structure

```
booking-tests/
├── package.json
├── playwright.config.ts
├── tsconfig.json
├── tests/
│   ├── search.spec.ts       # Test Case 1: search function
│   ├── filters.spec.ts      # Test Case 2: apply star-rating filter
│   └── utils/
│       └── helpers.ts       # dismissOverlays() + performSearch()
```

## Configuration you may want to change

- **Destination / dates / guest count**: constants at the top of `search.spec.ts` and `filters.spec.ts` (`DESTINATION`, `CHECK_IN`, `CHECK_OUT`, `ADULTS`).
- **Star rating filtered on**: `STAR_RATING` constant in `filters.spec.ts`.
- **Browser(s)**: `playwright.config.ts` → `projects` array (currently Chromium only; add `firefox` / `webkit` device entries if you want cross-browser runs).

## Important note on selectors

booking.com is a large, frequently-updated production site, and it doesn't publish a stable test-automation API — `data-testid` attributes, class names, and even the cookie-consent/login-popup behavior can change over time or vary by region/A-B test. The locators in `helpers.ts` and the specs are based on the current site structure, but if a test fails on a locator (rather than an assertion), the fastest fix is:

```bash
npx playwright codegen https://www.booking.com
```

This opens a browser + inspector where you can interact with the real page and copy the up-to-date locator, then swap it into `helpers.ts`.

## Notes on the filter test

- It assumes `search.spec.ts`'s search flow (via `performSearch`) successfully lands on a results page — if that helper's locators drift, both specs are affected, so fix it in one place.
- The filter assertion checks the checkbox state, the URL query parameter, and the visible star-rating badge on the first few result cards. If booking.com changes how it labels star ratings (currently `"X out of 5"` accessible label), update the regex in `filters.spec.ts`.
