import { lazy, Suspense } from 'react'
import type { BridgeProps } from '../lib/sync'
import SyncBridgeReal from './SyncBridgeReal'

// The test stand-in is only included when the build is made with VITE_FAKE_SYNC=true.
const Fake = import.meta.env.VITE_FAKE_SYNC === 'true' ? lazy(() => import('./SyncBridgeFake')) : null

export function SyncBridge(props: BridgeProps) {
  if (Fake) {
    return (
      <Suspense fallback={null}>
        <Fake {...props} />
      </Suspense>
    )
  }
  return <SyncBridgeReal {...props} />
}
