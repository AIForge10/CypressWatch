/**
 * Offline queue (IndexedDB). Actions taken with no signal are stored here and
 * replayed in order when signal returns. Item shape follows
 * contracts/mocks/offline_queue_item.json. Photos live in their own store
 * because they are binary, keyed by `photo_blob_key`.
 */
import type { ReportRequest } from '../contracts/types'

export type QueueItem =
  | {
      client_id: string
      /** Local only: who made this on this phone, so one person's items are never sent as another. */
      owner_user_id?: string
      kind: 'create_report'
      created_at: string
      attempts: number
      payload: ReportRequest
      photo_blob_key: string
    }
  | {
      // Not in contract v0.1 yet; proposed addition so acknowledgments also work offline.
      client_id: string
      owner_user_id?: string
      kind: 'acknowledge'
      created_at: string
      attempts: number
      payload: { alert_id: string }
      photo_blob_key?: undefined
    }

const DB = 'cw-crew'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('queue', { keyPath: 'client_id' })
      req.result.createObjectStore('photos')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function run<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode)
        const req = fn(tx)
        tx.oncomplete = () => {
          db.close()
          resolve(req ? (req.result as T) : undefined)
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

export async function enqueue(item: QueueItem, photo?: Blob): Promise<void> {
  await run(['queue', 'photos'], 'readwrite', (tx) => {
    if (photo && item.photo_blob_key) tx.objectStore('photos').put(photo, item.photo_blob_key)
    return tx.objectStore('queue').put(item)
  })
}

export async function listQueue(): Promise<QueueItem[]> {
  const all = (await run<QueueItem[]>(['queue'], 'readonly', (tx) => tx.objectStore('queue').getAll())) ?? []
  return all.sort((a, b) => a.created_at.localeCompare(b.created_at))
}

export async function getPhoto(key: string): Promise<Blob | undefined> {
  return run<Blob>(['photos'], 'readonly', (tx) => tx.objectStore('photos').get(key))
}

export async function removeItem(item: QueueItem): Promise<void> {
  await run(['queue', 'photos'], 'readwrite', (tx) => {
    if (item.photo_blob_key) tx.objectStore('photos').delete(item.photo_blob_key)
    return tx.objectStore('queue').delete(item.client_id)
  })
}

export async function bumpAttempts(item: QueueItem): Promise<void> {
  await run(['queue'], 'readwrite', (tx) => tx.objectStore('queue').put({ ...item, attempts: item.attempts + 1 }))
}

/** Remove only this person's waiting items (and their photos). Other people on this phone keep theirs. */
export async function clearQueueFor(userId: string | null): Promise<void> {
  for (const item of await listQueue()) if (!item.owner_user_id || item.owner_user_id === userId) await removeItem(item)
}

export async function clearQueue(): Promise<void> {
  await run(['queue', 'photos'], 'readwrite', (tx) => {
    tx.objectStore('photos').clear()
    return tx.objectStore('queue').clear()
  })
}
