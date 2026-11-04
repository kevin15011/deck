/**
 * Common instruction fragments shared across multiple instruction bundles.
 *
 * These functions generate the base markdown content that is reused by
 *
 * The content that repeats across surface variants (agent/skill/session) includes:
 * - Container Tag Conventions
 * - When to Save / When to Search
 * - Save Format
 * - Authority Rule
 * - Fail-Open provision
 */

import type { CapabilityInstructionSurface } from "./index";
