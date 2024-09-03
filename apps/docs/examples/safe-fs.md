# @opengovsg/starter-kitty-fs

## Installation

```bash
npm i --save @opengovsg/starter-kitty-fs
```

## Usage

```javascript
import safeFs from '@opengovsg/starter-kitty-fs'

const fs = safeFs('/app/content')

// Writes to /app/content/hello.txt
fs.writeFileSync('hello.txt', 'Hello, world!')

// Tries to read from /app/content/etc/passwd
fs.readFileSync('../../etc/passwd')
```

The interfaces for all `fs` methods are the exact same as the built-in `fs` module, but if a `PathLike` parameter is given,
it will be normalized, stripped of leading traversal characters, then resolved relative to the based directory passed to `safeFs`.

This guarantees that the resolved path will always be within the base directory or its subdirectories.

For example, if the base directory is `/app/content`:

- `hello.txt` resolves to `/app/content/hello.txt`
- `../../etc/passwd` resolves to `/app/content/etc/passwd`
- `/etc/passwd` resolves to `/app/content/etc/passwd`
