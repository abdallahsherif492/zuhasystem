# User Dashboard Subscription Management Improvements

## Goal
To improve the subscription management page for users by adding purchase confirmations, a real-time countdown timer for subscription expiration, and an automated package renewal system using Supabase `pg_cron`.

## Open Questions
1. **Automated Tasks**: To implement the automated auto-renew process, we will use Supabase's `pg_cron` extension. The provided SQL script will need to be executed in your Supabase SQL Editor, and it will require the `pg_cron` extension to be enabled in your database extensions.

## Proposed Changes

### Database Changes (`supabase/subscription_automation.sql`)
- [MODIFY] Add `auto_renew_enabled` (BOOLEAN DEFAULT false) and `auto_renew_package_id` (UUID) columns to the `businesses` table.
- [NEW] Create `process_auto_renewals()` function. This function will:
  - Find all businesses where `subscription_end_date` is less than 24 hours away.
  - Check if `auto_renew_enabled` is true and they have enough `wallet_balance`.
  - Deduct the balance, extend the date, and insert a `package_purchase` transaction into `revenue_transactions`.
- [NEW] Schedule the function to run every hour using `pg_cron`.

### UI Components (`src/components/settings/subscription-settings.tsx`)
- [MODIFY] **Countdown Timer**: Implement a `useEffect` hook that updates every second to display remaining Months, Days, Hours, Minutes, and Seconds until the `subscription_end_date`.
- [MODIFY] **Buy Confirmation Prompt**: Add an `AlertDialog` when the user clicks "Buy Package". The prompt will show the package name, cost, and the exact new expiration date.
- [MODIFY] **Auto-Renew Switch**: Add a toggle switch to each package card allowing the user to enable/disable auto-renew for that specific package. When toggled, it will update the `businesses` table (`auto_renew_enabled`, `auto_renew_package_id`).

## Verification Plan
1. Ensure the `AlertDialog` correctly blocks accidental purchases and shows accurate future dates.
2. Verify the countdown timer ticks down accurately in real-time.
3. Test the toggle switch to ensure it correctly saves the auto-renew preference to the Supabase backend.
4. The user will run the SQL script to activate the background cron job for auto-renewals.
