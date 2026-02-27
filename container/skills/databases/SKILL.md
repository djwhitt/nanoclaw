---
name: databases
description: Query and analyze data with SQLite and DuckDB. Use SQLite for simple storage and CRUD, DuckDB for analytics and large dataset processing. Both CLIs are available via Bash.
allowed-tools: Bash(sqlite3:*) Bash(duckdb:*)
---

# Database Tools: SQLite & DuckDB

## When to use which

- **SQLite** — Simple storage, CRUD operations, small-to-medium datasets, application databases
- **DuckDB** — Analytics, aggregations, large datasets, CSV/Parquet/JSON ingestion, columnar queries

## SQLite (`sqlite3`)

### Quick start

```bash
sqlite3 data.db "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);"
sqlite3 data.db "INSERT INTO users VALUES (1, 'Alice', 'alice@example.com');"
sqlite3 data.db "SELECT * FROM users;"
```

### Common operations

```bash
# Interactive mode
sqlite3 data.db

# Run SQL from file
sqlite3 data.db < query.sql

# Output modes
sqlite3 -header -column data.db "SELECT * FROM users;"   # Table format
sqlite3 -header -csv data.db "SELECT * FROM users;"      # CSV output
sqlite3 -json data.db "SELECT * FROM users;"             # JSON output

# Import CSV
sqlite3 data.db ".mode csv" ".import data.csv tablename"

# Export to CSV
sqlite3 -header -csv data.db "SELECT * FROM users;" > users.csv

# Show tables and schema
sqlite3 data.db ".tables"
sqlite3 data.db ".schema tablename"
```

## DuckDB (`duckdb`)

### Quick start

```bash
duckdb "SELECT 42 AS answer;"
duckdb mydb.duckdb "CREATE TABLE t AS SELECT * FROM 'data.csv';"
duckdb mydb.duckdb "SELECT * FROM t WHERE value > 100;"
```

### Read files directly (no import needed)

```bash
# CSV
duckdb "SELECT * FROM 'data.csv' LIMIT 10;"
duckdb "SELECT col1, COUNT(*) FROM 'data.csv' GROUP BY col1;"

# Parquet
duckdb "SELECT * FROM 'data.parquet' LIMIT 10;"

# JSON
duckdb "SELECT * FROM read_json_auto('data.json') LIMIT 10;"

# Glob patterns
duckdb "SELECT * FROM 'logs/*.csv';"
```

### Common operations

```bash
# Interactive mode
duckdb mydb.duckdb

# In-memory (no persistence)
duckdb

# Run SQL from file
duckdb mydb.duckdb < query.sql

# Output modes
duckdb -csv "SELECT * FROM 'data.csv';"
duckdb -json "SELECT * FROM 'data.csv';"
duckdb -markdown "SELECT * FROM 'data.csv';"

# Export results
duckdb "COPY (SELECT * FROM 'input.csv' WHERE val > 0) TO 'output.csv' (HEADER, DELIMITER ',');"
duckdb "COPY (SELECT * FROM 'input.csv') TO 'output.parquet' (FORMAT PARQUET);"

# Summarize a dataset
duckdb "SUMMARIZE SELECT * FROM 'data.csv';"

# Describe columns
duckdb "DESCRIBE SELECT * FROM 'data.csv';"
```

### Analytical queries

```bash
# Window functions
duckdb "SELECT *, ROW_NUMBER() OVER (PARTITION BY category ORDER BY value DESC) AS rank FROM 'data.csv';"

# Pivoting
duckdb "PIVOT 'sales.csv' ON month USING SUM(amount) GROUP BY product;"

# Sampling
duckdb "SELECT * FROM 'large.csv' USING SAMPLE 1000;"
```

## Example: CSV analysis pipeline

```bash
# Inspect the data
duckdb "DESCRIBE SELECT * FROM 'sales.csv';"
duckdb "SELECT COUNT(*) FROM 'sales.csv';"

# Analyze
duckdb "SELECT region, SUM(amount) AS total FROM 'sales.csv' GROUP BY region ORDER BY total DESC;"

# Save results
duckdb "COPY (SELECT region, SUM(amount) AS total FROM 'sales.csv' GROUP BY region) TO 'summary.csv' (HEADER);"
```

## Example: SQLite app database

```bash
# Create schema
sqlite3 app.db "CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, done BOOLEAN DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);"

# Insert data
sqlite3 app.db "INSERT INTO tasks (title) VALUES ('Build feature'), ('Write tests');"

# Query
sqlite3 -json app.db "SELECT * FROM tasks WHERE done = 0;"

# Update
sqlite3 app.db "UPDATE tasks SET done = 1 WHERE id = 1;"
```
