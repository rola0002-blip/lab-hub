# Changelog

All notable changes to COLOSSUS (the self-hosted LabHub platform) are documented in
this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0-beta] - 2026-07-14

### Added
- Equipment booking with per-instrument approval policies, certification gating, approvals, recurring bookings, and maintenance windows (SP1).
- Team messaging: public/private channels and DMs, threaded replies, @mentions and @channel, emoji reactions, file attachments, full-text search, realtime over SSE + Postgres LISTEN/NOTIFY, and opt-in Web Push (SP2).
- COLOSSUS workspace redesign: semantic design-token theming (light/dark), ten accent presets, grouped sidebar, command palette, and a gated accessibility baseline (SP3).
- Project management: issues and projects with a fractional-index board, statuses, labels, comments, and activity, guarded by a single issue-policy choke point (SP4).
- Read-only calendar sync (per-user `.ics` feed, per-booking downloads, Google/Outlook quick-add), the COLOSSUS Bot posting lab activity to `#lab-updates`, booking-policy exposure for recurring bookings, and a workspace-wide Files document library (SP5).
