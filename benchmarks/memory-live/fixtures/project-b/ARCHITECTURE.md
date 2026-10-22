# Architecture

apps/worker consumes queue jobs; apps/console is the operator UI. @harbor/kernel owns shared data shapes. Plugins in packages/plugin-* own routing decisions and transport details. Changesets govern package releases; ADRs govern architecture.
