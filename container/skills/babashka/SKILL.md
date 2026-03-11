---
name: babashka
description: Fast Clojure scripting with Babashka (bb). Run Clojure scripts, process data with functional programming, and leverage the extensive bb standard library. The bb CLI is available via Bash.
allowed-tools: Bash(bb:*)
---

# Babashka: Fast Clojure Scripting

## Quick start

```bash
# Run an expression
bb -e '(println "Hello from Babashka!")'

# Check version
bb -e '(System/getProperty "babashka.version")'

# Run a script file
bb script.clj

# Pipe data through bb
echo "hello world" | bb -e '(str/upper-case (read-line))'
```

## Data processing

```bash
# Parse JSON
echo '{"name":"alice","age":30}' | bb -e '(-> (read-line) (json/parse-string keyword) :name)'

# Parse CSV
bb -e '(require '[clojure.data.csv :as csv])
       (with-open [r (io/reader "data.csv")]
         (doall (csv/read-csv r)))'

# Process EDN
bb -e '(-> (slurp "config.edn") edn/read-string :database :host)'

# HTTP requests
bb -e '(-> (curl/get "https://api.example.com/data") :body (json/parse-string keyword))'
```

## File operations

```bash
# Read and transform a file
bb -e '(->> (slurp "input.txt")
            str/split-lines
            (filter #(str/includes? % "ERROR"))
            (str/join "\n")
            (spit "errors.txt"))'

# List files in a directory
bb -e '(->> (file-seq (io/file "."))
            (filter #(.isFile %))
            (map #(.getName %))
            (sort)
            (run! println))'
```

## Shell scripting

```bash
# Run shell commands
bb -e '(-> (shell/sh "ls" "-la") :out println)'

# Script with arguments
bb -e '(let [[name] *command-line-args*]
         (println (str "Hello, " name "!")))' -- "World"
```

## Tips

- Babashka starts in milliseconds — ideal for scripting tasks
- Most of `clojure.core`, `clojure.string`, `clojure.set`, `clojure.edn`, `clojure.java.io` are available
- Built-in libraries: `cheshire` (JSON), `babashka.curl` (HTTP), `babashka.fs` (filesystem)
- Use `bb nrepl-server` to start an nREPL for interactive development
- Scripts are stored in `/workspace/group/` (per-group) or `/workspace/extra/` (shared)
- Use `#!/usr/bin/env bb` as shebang for executable scripts
