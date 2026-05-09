# Unified Chart Section Viewer (Metrics in Discover)

**Audience**: LLM coding agents working on the Metrics Experience in Discover.

This package implements the chart grid, flyout, toolbar, and hooks rendered when Discover's metrics data source profile activates. The activation profile itself lives in the discover plugin under `context_awareness/profile_providers/common/metrics_data_source_profile/`. Owned by `@elastic/obs-exploration-team`.

---

## Specialist guidance

- **[`metrics-discover` skill](../../../plugins/shared/discover/.agents/skills/metrics-discover/SKILL.md)** — Load for app-code work in this package or the discover-side activation profile: activation rules, adding supported ES|QL commands, debugging missing metrics in the grid, telemetry, wiring metrics views into Agent Builder. For Scout E2E test work, use the sibling **`metrics-discover-e2e`** skill.
