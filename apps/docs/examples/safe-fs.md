# @opengovsg/starter-kitty-fs

## Installation

```bash
npm i --save @opengovsg/starter-kitty-fs
```

## Usage

```javascript
import { safeFs } from '@opengovsg/starter-kitty-fs'

const fs = safeFs('/app/content')

// Writes to /app/content/hello.txt
fs.writeFileSync('hello.txt', 'Hello, world!')
```
