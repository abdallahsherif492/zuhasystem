# Replace Hardcoded Colors with Theme Variables

## Problem
The system is using hardcoded Tailwind colors (e.g., `bg-blue-500`, `text-gray-900`) instead of the dynamic theme variables (`primary`, `secondary`, `muted`, `foreground`). This causes the user's custom brand colors not to appear across the dashboard.

## Proposed Solution
I will write a script to search the entire `src/` directory and replace hardcoded color classes with their semantic equivalents. 

### Mapping Rules
1. **Primary Actions & Highlights (Blue, Indigo, Purple, Pink)**
   - `bg-[color]-500/600/700` ➔ `bg-primary`
   - `hover:bg-[color]-600/700` ➔ `hover:bg-primary/90`
   - `text-[color]-500/600/700` ➔ `text-primary`
   - `bg-[color]-50/100` ➔ `bg-primary/10` or `bg-primary/20`

2. **Neutral Colors (Gray, Slate, Zinc)**
   - `bg-[color]-50` ➔ `bg-secondary` or `bg-muted/50`
   - `bg-[color]-100/200` ➔ `bg-muted`
   - `text-[color]-400/500/600` ➔ `text-muted-foreground`
   - `text-[color]-700/800/900` ➔ `text-foreground`
   - `border-[color]-200/300` ➔ `border-border`

> [!IMPORTANT]
> **Semantic Colors Exception**: I plan to **EXCLUDE** status colors like `green` (Success/Delivered), `red` (Failed/Cancelled/Destructive), and `yellow` (Pending/Warning) from this mass replacement. Replacing these with `primary` and `secondary` would make all status badges look identical and harm the user experience. 
> 
> *Do you agree with leaving `green`, `red`, and `yellow` alone for statuses?*

## Execution Plan
1. Create a Node.js script in `scratch/replace-colors.js`.
2. Run the script over the `src/` directory.
3. Verify the changes locally and ensure no components break visually.
4. Push the changes to GitHub.
