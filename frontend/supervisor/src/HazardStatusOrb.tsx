import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type { Group, Mesh, MeshBasicMaterial } from 'three';
import type { HazardType } from './data';

export type OrbState = 'stop' | 'watch' | 'monitor';

type OrbProps = { state: OrbState; hazard?: HazardType };

const colors: Record<OrbState, string> = {
  stop: '#cd533b',
  watch: '#d19743',
  monitor: '#4f958a',
};

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

function canUseWebGL() {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

class OrbErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function OrbModel({ state, reducedMotion }: { state: OrbState; reducedMotion: boolean }) {
  const group = useRef<Group>(null);
  const pulse = useRef<Mesh>(null);
  const color = colors[state];
  useFrame(({ clock }, delta) => {
    if (reducedMotion) return;
    if (group.current) group.current.rotation.y += delta * (state === 'stop' ? 0.62 : 0.36);
    if (pulse.current) {
      const wave = (Math.sin(clock.elapsedTime * (state === 'stop' ? 3.2 : 1.9)) + 1) / 2;
      pulse.current.scale.setScalar(1 + wave * (state === 'stop' ? 0.16 : 0.06));
      const material = pulse.current.material as MeshBasicMaterial;
      material.opacity = state === 'stop' ? 0.3 + wave * 0.25 : 0.2 + wave * 0.1;
    }
  });
  return <>
    <ambientLight intensity={1.45} />
    <directionalLight position={[2, 3, 4]} intensity={2.1} />
    <group ref={group} rotation={[0.2, 0.2, 0]}>
      <mesh><sphereGeometry args={[0.48, 36, 24]} /><meshStandardMaterial color={color} roughness={0.32} metalness={0.22} /></mesh>
      <mesh><sphereGeometry args={[0.525, 32, 20]} /><meshBasicMaterial color={color} transparent opacity={0.11} depthWrite={false} /></mesh>
      <mesh rotation={[Math.PI / 2.7, 0.2, 0]}><torusGeometry args={[0.74, 0.026, 8, 64]} /><meshBasicMaterial color={color} /></mesh>
      <mesh rotation={[0.1, Math.PI / 3.1, 0.3]}><torusGeometry args={[0.8, 0.013, 8, 64]} /><meshBasicMaterial color={color} transparent opacity={0.55} /></mesh>
    </group>
    <mesh ref={pulse} rotation={[0, 0, 0]}><torusGeometry args={[0.95, 0.025, 8, 64]} /><meshBasicMaterial color={color} transparent opacity={0.25} depthWrite={false} /></mesh>
  </>;
}

function HazardGlyph({ hazard }: { hazard?: HazardType }) {
  const label = hazard === 'Lightning' ? 'Lightning' : hazard === 'Flooding' || hazard === 'Soil saturation' ? 'Water' : hazard === 'Heat' ? 'Heat' : hazard === 'Wildfire' ? 'Fire' : 'Site status';
  return <span className={`cw-status-orb-glyph cw-status-orb-glyph-${label.toLowerCase().replace(' ', '-')}`} aria-hidden="true">
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {label === 'Lightning' ? <path d="M16 2 7 15h6l-1 11 9-14h-6l1-10Z" fill="currentColor" stroke="none" />
        : label === 'Water' ? <><path d="M7 5v6m7-9v7m7-4v6M7 16v5m7-7v8m7-6v5" /></>
        : label === 'Heat' ? <><circle cx="14" cy="14" r="5" /><path d="M14 1v4m0 18v4M1 14h4m18 0h4M4.8 4.8l2.8 2.8m12.8 12.8 2.8 2.8m0-18.4-2.8 2.8M7.6 20.4l-2.8 2.8" /></>
        : label === 'Fire' ? <path d="M15 2c1 5-2 6-1 10 2-1 3-3 3-5 5 4 7 9 5 14-2 4-6 6-10 5-5-1-8-5-7-10 1-4 4-7 5-10 0 3 1 5 2 6 2-3 1-6 3-10Z" />
        : <circle cx="14" cy="14" r="5" fill="currentColor" stroke="none" />}
    </svg>
  </span>;
}

export function HazardStatusOrb({ state, hazard }: OrbProps) {
  const reducedMotion = useReducedMotion();
  const [webglAvailable] = useState(canUseWebGL);
  const [contextLost, setContextLost] = useState(false);
  const canvasElement = useRef<HTMLCanvasElement | null>(null);
  const onContextLost = useCallback((event: Event) => { event.preventDefault(); setContextLost(true); }, []);
  useEffect(() => () => canvasElement.current?.removeEventListener('webglcontextlost', onContextLost), [onContextLost]);
  const fallback = <span className={`cw-status-orb-fallback cw-status-orb-fallback-${state}`} />;
  return <div className={`cw-status-orb cw-status-orb-${state}`} aria-hidden="true">
    {webglAvailable && !contextLost ? <OrbErrorBoundary fallback={fallback}><Canvas fallback={fallback} camera={{ position: [0, 0, 3], fov: 42 }} dpr={[1, 1.5]} frameloop={reducedMotion ? 'demand' : 'always'} gl={{ alpha: true, antialias: true }} onCreated={({ gl }) => { canvasElement.current = gl.domElement; gl.domElement.addEventListener('webglcontextlost', onContextLost); }}><OrbModel state={state} reducedMotion={reducedMotion} /></Canvas></OrbErrorBoundary> : fallback}
    <HazardGlyph hazard={hazard} />
  </div>;
}
