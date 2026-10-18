/**
 * site_assignments: which site each crew member works at (demo mode).
 *
 * One row per person. Only an admin can create, change or remove rows (the "Team" tab).
 * Crew can read the list, so the app can find its own row; it holds only a name and a site.
 * (DeepSpace cannot yet limit a read to "rows about me" when the row was made by someone else.)
 *
 * In the live app the backend decides this: `GET /api/me` returns `site_ids`.
 */
import type { CollectionSchema } from 'deepspace/schema'

export const siteAssignmentsSchema: CollectionSchema = {
  name: 'site_assignments',
  columns: [
    { name: 'user_id', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'user_name', storage: 'text', interpretation: 'plain', default: '' },
    { name: 'site_id', storage: 'text', interpretation: 'plain', required: true },
    { name: 'site_name', storage: 'text', interpretation: 'plain', default: '' },
  ],
  uniqueOn: ['user_id'],
  permissions: {
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
