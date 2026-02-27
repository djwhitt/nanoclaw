---
name: hledger
description: Plain-text double-entry accounting with hledger. Track finances, generate reports (balance sheet, income statement, cash flow), and import CSV bank statements. The hledger CLI is available via Bash.
allowed-tools: Bash(hledger:*)
---

# hledger: Plain-Text Accounting

## Quick start

```bash
# Create a journal file
cat > finances.journal <<'EOF'
2024-01-01 Opening balances
    assets:checking         $1000.00
    equity:opening balances

2024-01-05 Grocery store
    expenses:food            $50.00
    assets:checking

2024-01-15 Salary
    assets:checking         $3000.00
    income:salary
EOF

# View balances
hledger -f finances.journal bal

# Register of transactions
hledger -f finances.journal reg

# Income statement
hledger -f finances.journal is
```

## Common reports

```bash
# Balance sheet
hledger -f finances.journal bs

# Income statement
hledger -f finances.journal is

# Cash flow
hledger -f finances.journal cf

# Balance with tree structure
hledger -f finances.journal bal --tree

# Monthly breakdown
hledger -f finances.journal bal --monthly

# Filter by account
hledger -f finances.journal reg expenses:food

# Filter by date
hledger -f finances.journal bal --begin 2024-01-01 --end 2024-02-01

# Filter by description
hledger -f finances.journal reg desc:grocery
```

## Journal file format

```
; Comments start with semicolon
; Dates are YYYY-MM-DD

2024-01-05 Grocery store    ; transaction description
    expenses:food       $50.00   ; posting with amount
    assets:checking              ; balancing posting (amount inferred)

2024-01-10 * Rent payment   ; * means cleared
    expenses:rent      $1200.00
    assets:checking

2024-01-15 ! Pending charge  ; ! means pending
    expenses:misc        $25.00
    assets:checking
```

## CSV import

```bash
# Create a CSV rules file for your bank
cat > bank.csv.rules <<'EOF'
skip 1
fields date, description, amount
date-format %m/%d/%Y
currency $
account1 assets:checking
if grocery
    account2 expenses:food
if salary
    account2 income:salary
if
    account2 expenses:unknown
EOF

# Import CSV
hledger import --rules-file bank.csv.rules bank.csv

# Preview before importing (dry run)
hledger -f bank.csv --rules-file bank.csv.rules print
```

## Tips

- Journal files are stored in `/workspace/group/` (per-group) or `/workspace/extra/` (shared)
- Use `include` directive to split large journals: `include 2024.journal`
- Use `--alias` to rename accounts on the fly: `hledger bal --alias food=groceries`
- Amounts must balance to zero in each transaction (hledger enforces this)
- Use `hledger check` to validate a journal file
- Use `hledger accounts` to list all accounts in a journal
