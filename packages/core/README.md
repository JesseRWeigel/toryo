# toryo-core

Core engine for the [Toryo](https://github.com/JesseRWeigel/toryo) intelligent agent orchestrator.

Provides the orchestration loop, task management, quality ratcheting, trust-based delegation, knowledge store, and smart truncation.

## Installation

```bash
npm install toryo-core
```

## Usage

```ts
import { createOrchestrator, createDelegation, createRatchet, createMetrics } from 'toryo-core';
```

Each subsystem is a standalone factory function — use the full orchestrator or individual pieces:

```ts
// Use just the delegation system
const delegation = createDelegation({ initialTrust: 0.5 });

// Use just the ratchet for git-based quality gates
const ratchet = createRatchet({ threshold: 7.0 }, process.cwd());

// Use just the metrics for experiment tracking
const metrics = createMetrics('.toryo');
```

See the [main Toryo README](https://github.com/JesseRWeigel/toryo#readme) for full documentation.

## License

MIT
