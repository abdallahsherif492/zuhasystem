# Expiration & Suspension Handling Plan

## Goal
Implement a warning banner for subscriptions nearing expiration and a 7-day grace period suspension mechanism that locks the user out of the dashboard (except the settings page) if they fail to renew.

## Proposed Changes

### 1. Update Business Context (`src/contexts/BusinessContext.tsx`)
- [MODIFY] Add `subscription_end_date: string | null` to the `Business` interface.
- [MODIFY] Ensure `subscription_end_date` is included in the Supabase query when fetching the user's businesses.

### 2. Create Expiration Banner (`src/components/layout/expiration-banner.tsx`)
- [NEW] Create a new banner component that reads `subscription_end_date` from `BusinessContext`.
- Logic: If `subscription_end_date` is within the next 10 days (and hasn't expired yet), display a prominent yellow/red banner at the top of the screen warning them of the impending suspension, along with a "Renew Now" button that routes to `/settings?tab=subscription`.

### 3. Create Subscription Guard (`src/components/layout/subscription-guard.tsx`)
- [NEW] Create a new layout wrapper component.
- Logic:
  - If `isSystemAdmin` is true, bypass the check.
  - If the `pathname` starts with `/settings`, bypass the check (allow access so they can renew).
  - Calculate the difference between `now` and `subscription_end_date`.
  - If the subscription has expired AND the 7-day grace period has passed (i.e., expired more than 7 days ago), block access. Render a full-page "Account Suspended" screen instead of the dashboard children, with a button to go to Settings to renew.
  - Otherwise, render `children`.

### 4. Inject into Layout (`src/app/(dashboard)/layout.tsx`)
- [MODIFY] Add `<ExpirationBanner />` directly below `<AnnouncementBanner />`.
- [MODIFY] Wrap the `{children}` with `<SubscriptionGuard>`.

## Verification Plan
1. Manually manipulate a test business's `subscription_end_date` in Supabase to be 5 days in the future and verify the banner appears.
2. Change it to 3 days in the past and verify the banner disappears but the system still works (grace period).
3. Change it to 10 days in the past and verify the system locks the user out, but allows them to navigate to Settings.
4. Verify System Admins are not accidentally locked out.
