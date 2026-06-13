# SuperInstance Agent

The **agent abstraction layer** for the SuperInstance fleet — defining the canonical trait that every ship (including the Cocapn captain) implements, unifying identity, conservation state, and lifecycle management.

## Why It Matters

A fleet of autonomous agents needs a common interface. Whether an agent is a worker ship processing data, a scout exploring new configurations, or the Cocapn coordinating the fleet, they all share core capabilities: a unique identity, a conservation state (γ, η, C), and the ability to receive and produce messages. The agent trait abstracts these commonalities, enabling the fleet to treat all members uniformly for routing, monitoring, and conservation-law enforcement. This is the same pattern as Kubernetes' controller-runtime Reconciler interface, but for autonomous agents governed by the γ + η = C conservation law.

## How It Works

### The Agent Trait

Every ship implements a minimal trait exposing identity and conservation state:

```rust
trait Agent {
    fn id(&self) -> &ShipId;
    fn state(&self) -> ConservationState;
}
```

### ConservationState

Each agent maintains its γ/η/C vector:

```
ConservationState {
    gamma: f64,   // exploitation budget consumed
    eta: f64,     // exploration budget consumed
    c: f64,       // total capacity
}

Invariant: gamma + eta ≈ c (within tolerance)
```

### The Cocapn as Agent

The fleet captain (Cocapn) is itself an agent, with γ=0.1 (mostly coordination), η=0.9 (mostly observation), C=1.0. This symmetry — the captain is also a ship — enables recursive fleet hierarchies and uniform treatment.

### Architecture Integration

```
Agent trait (this crate)
    ↑ implements
    ├── InMemoryCocapn (captain)
    ├── WorkerShip (crate: superinstance-harness)
    ├── ScoutShip (crate: superinstance-assets)
    └── FutureShip types...
```

## Quick Start

```rust
// See superinstance-cocapn for the InMemoryCocapn implementation
// that implements the Agent trait.

// The trait is:
// pub trait Agent {
//     fn id(&self) -> &ShipId;
//     fn state(&self) -> ConservationState;
// }
```

## API

### `Agent` trait
- `id() -> &ShipId` — unique fleet identifier
- `state() -> ConservationState` — current γ/η/C vector

### Dependencies
- `ShipId` and `ConservationState` from `superinstance-cocapn` / `superinstance-core`

## Architecture Notes

This crate is the canonical home for the Agent trait in the SuperInstance ecosystem. Every ship's conservation state is queryable through this interface, enabling the Cocapn to compute fleet-wide γ + η = C aggregates and make routing decisions. See [Architecture](https://github.com/SuperInstance/SuperInstance/blob/main/ARCHITECTURE.md).

## References

- Russell, S. & Norvig, P. (2020). *AI: A Modern Approach*, 4th ed., §2 (Intelligent Agents).
- Kubernetes. *Controller Pattern*. kubernetes.io/docs/concepts/architecture/controller
- Wooldridge, M. (2009). *An Introduction to MultiAgent Systems*, 2nd ed. Wiley.

## License

MIT
