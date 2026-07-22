# Add Expenses and Treasuries to System Admin Accounting

## Goal
To implement the exact same accounting logic (expenses, treasuries, transfers, multiple accounts, filters) found in the user dashboard's `/accounting` page, but specifically for the System Admin in `/system-admin/accounting`.

## Open Questions
None. The requirement is clear: replicate the user dashboard accounting functionality for the system admin's internal SaaS ledger.

## Proposed Changes

### Database Changes (`supabase/system_admin_accounting.sql`)
- [NEW] Create `system_financial_accounts` table (id, name, created_at) with RLS for system admins.
- [MODIFY] Alter `platform_transactions` table to add `account_name` TEXT.
- [MODIFY] Alter `platform_transactions` table to allow `type = 'transfer'` (currently constrained to `expense`, `revenue`).
- [NEW] Create RPC `get_system_treasury_balances` to aggregate balances for the system admin based on `platform_transactions`.

### Components (`src/components/system-admin/accounting/`)
- [NEW] `system-accounting-content.tsx`: The main Client Component replicating `AccountingContent` but targeting `platform_transactions`, `system_financial_accounts`, and `get_system_treasury_balances`.
- [NEW] `system-add-transaction-dialog.tsx`: Replicates `AddTransactionDialog`.
- [NEW] `system-manage-accounts-dialog.tsx`: Replicates `ManageAccountsDialog`.
- [NEW] `system-transfer-dialog.tsx`: Replicates `TransferDialog`.

### Pages
- [MODIFY] `src/app/system-admin/accounting/page.tsx`: 
  - Convert to use the new `SystemAccountingContent`.
  - Ensure the existing "Wallet Top-ups" (Revenue Transactions) data is preserved, perhaps in a separate tab or merged into the new system. (I will put the top-ups as a read-only tab or card since they are auto-generated).

## Verification Plan
1. Apply the SQL migration.
2. Navigate to System Admin -> Accounting.
3. Add a new treasury account (e.g., "Vodafone Cash").
4. Add an expense (e.g., "Server Hosting") and verify the balance decreases.
5. Add a revenue (e.g., "Manual Subscription Payment") and verify the balance increases.
6. Verify existing wallet top-up revenue is still visible.
