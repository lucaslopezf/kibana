# Metrics in Discover

**Audience**: LLM coding agents working on the Metrics Experience in Discover.

The metrics data source profile activates a metrics-specific chart grid and details flyout when an ES|QL query resolves to it. The profile lives here; the grid, flyout, and chart machinery live in `@kbn/unified-chart-section-viewer`. Owned by `@elastic/obs-exploration-team`.

---

## Specialist guidance

- **[`metrics-discover` skill](../../../../../.agents/skills/metrics-discover/SKILL.md)** — Load for app-code work in this profile or the `@kbn/unified-chart-section-viewer` package: activation rules, adding supported ES|QL commands, debugging missing metrics in the grid, telemetry, wiring metrics views into Agent Builder. For Scout E2E test work, use the sibling **`metrics-discover-e2e`** skill.
