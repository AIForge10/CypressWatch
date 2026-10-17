/**
 * Live sync collections for the crew app (demo mode).
 *
 * - demo_strike   one row per site: the time of the latest SIMULATED lightning strike. Pressing
 *                 "Simulate strike" on one phone writes it; every phone reads it and starts the countdown.
 * - crew_acks     one row per person per alert: "I have stopped work". Rows never change once written.
 * - crew_reports  hazard reports (text only; the photo stays on the phone that took it for now).
 *
 * Permission notes:
 * - Anyone signed in can read. Signed-out visitors can read and write nothing.
 * - demo_strike can be written by any signed-in member so teammates can demo from their own phones.
 *   It is DEMO ONLY. In the live app the stop-work state must come from the server, and this
 *   collection should become admin-only (change `member` below) or be removed.
 * - `user_id` is stamped by the server from the login, so nobody can confirm or report as someone else.
 * - Nothing here is filtered by site on the server yet; `site_id` filtering is for convenience only.
 */
import type { CollectionSchema } from 'deepspace/schema'

const NONE = { read: false, create: false, update: false, delete: false } as const

export const demoStrikeSchema: CollectionSchema = {
  name: 'demo_strike',
  columns: [
    { name: 'site_id', storage: 'text', interpretation: 'plain', required: true },
    // Milliseconds since 1970 of the latest simulated strike. 0 means "cleared".
    { name: 'at', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'by_name', storage: 'text', interpretation: 'plain', default: '' },
  ],
  uniqueOn: ['site_id'],
  permissions: {
    viewer: NONE,
    member: { read: true, create: true, update: true, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

export const crewAcksSchema: CollectionSchema = {
  name: 'crew_acks',
  columns: [
    { name: 'client_id', storage: 'text', interpretation: 'plain', required: true },
    { name: 'site_id', storage: 'text', interpretation: 'plain', required: true },
    { name: 'alert_id', storage: 'text', interpretation: 'plain', required: true },
    { name: 'user_id', storage: 'text', interpretation: 'plain', userBound: true, immutable: true, required: true },
    { name: 'user_name', storage: 'text', interpretation: 'plain', default: '' },
    { name: 'acked_at', storage: 'text', interpretation: 'plain', required: true },
  ],
  uniqueOn: ['alert_id', 'user_id'],
  permissions: {
    viewer: NONE,
    member: { read: true, create: true, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

export const crewReportsSchema: CollectionSchema = {
  name: 'crew_reports',
  columns: [
    { name: 'client_id', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'site_id', storage: 'text', interpretation: 'plain', required: true },
    { name: 'hazard', storage: 'text', interpretation: 'plain', default: '' },
    { name: 'note', storage: 'text', interpretation: 'plain', default: '' },
    { name: 'lat', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'lon', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'captured_at', storage: 'text', interpretation: 'plain', required: true },
    { name: 'uploaded_at', storage: 'text', interpretation: 'plain', required: true },
    { name: 'user_id', storage: 'text', interpretation: 'plain', userBound: true, immutable: true, required: true },
    { name: 'user_name', storage: 'text', interpretation: 'plain', default: '' },
    { name: 'status', storage: 'text', interpretation: 'plain', default: 'pending_review' },
  ],
  uniqueOn: ['client_id'],
  permissions: {
    viewer: NONE,
    // Members can't set `status`: only a supervisor-level role reviews a report.
    member: {
      read: true,
      create: true,
      update: false,
      delete: false,
      writableFields: ['client_id', 'site_id', 'hazard', 'note', 'lat', 'lon', 'captured_at', 'uploaded_at', 'user_name'],
    },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
