import { Component, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
import { CanvasTexture, CatmullRomCurve3, Color, DataTexture, DoubleSide, Float32BufferAttribute, PlaneGeometry, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType, Vector3 } from 'three';
import type { Group, Mesh, PointLight, TubeGeometry } from 'three';
import type { SiteLandscape } from './data';

type Weather = 'storm' | 'overcast' | 'sunny';
type SceneProps = { active: boolean; strikeCount: number; strikeAnimationId: number; weather: Weather; landscape: SiteLandscape };

type StrikeLocation = { x: number; z: number; miles: number; cloud: [number, number, number] };
// Diagrammatic positions sit well beyond the facility footprint so the visual
// impact reads as an off-site strike; labels carry the demo distance.
const strikeLocations: StrikeLocation[] = [
  { x: 4.25, z: 4.15, miles: 8.4, cloud: [4.3, 3.0, 4.0] },
  { x: -4.7, z: 1.7, miles: 5.0, cloud: [-4.6, 3.1, 1.7] },
  { x: 4.65, z: 1.1, miles: 6.7, cloud: [4.6, 2.9, 1.3] },
  { x: -4.35, z: 4.0, miles: 9.1, cloud: [-4.3, 3.1, 3.8] },
];
const terrainNoise = new ImprovedNoise();

// A small procedural albedo map gives the heightfield grain without fetching map tiles or assets.
function surfaceTexture(kind: 'earth' | 'aggregate') {
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const broad = terrainNoise.noise(x / 46, y / 46, kind === 'earth' ? 6 : 19) * 17;
    const fine = terrainNoise.noise(x / 5, y / 5, 31) * 10;
    const grain = ((x * 37 + y * 67 + x * y * 13) % 23) - 11;
    const variation = broad + fine + grain;
    const offset = (y * size + x) * 4;
    const base = kind === 'earth' ? [216, 222, 207] : [205, 207, 199];
    pixels[offset] = Math.max(0, Math.min(255, base[0] + variation));
    pixels[offset + 1] = Math.max(0, Math.min(255, base[1] + variation));
    pixels[offset + 2] = Math.max(0, Math.min(255, base[2] + variation));
    pixels[offset + 3] = 255;
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(kind === 'earth' ? 7 : 3, kind === 'earth' ? 7 : 3);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function terrainHeight(x: number, z: number) {
  const radius = Math.hypot(x, z);
  const edge = Math.max(0, Math.min(1, (radius - 3.9) / 2.2));
  const blend = edge * edge * (3 - 2 * edge);
  const broad = terrainNoise.noise(x * 0.24, z * 0.24, 4.7) * 1.05;
  const detail = terrainNoise.noise(x * 0.72, z * 0.72, 12.3) * 0.12;
  const backRise = Math.max(0, -z - 3.5) * 0.2;
  const pondDistance = Math.hypot(x + 4.6, z - 3.2);
  const drainage = -0.6 * Math.exp(-(pondDistance * pondDistance) / 0.3);
  return -0.29 + blend * (0.16 + broad + detail + backRise + drainage);
}

function Terrain({ weather, landscape }: { weather: Weather; landscape: SiteLandscape }) {
  const texture = useMemo(() => surfaceTexture('earth'), []);
  const geometry = useMemo(() => {
    const ground = new PlaneGeometry(19, 19, 120, 120);
    ground.rotateX(-Math.PI / 2);
    const positions = ground.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const low = new Color(landscape === 'scrub' ? '#756f57' : weather === 'storm' ? '#536b5d' : '#657b5e');
    const grass = new Color(landscape === 'scrub' ? '#a49d76' : landscape === 'wetland' ? '#6f8d75' : weather === 'storm' ? '#7e977e' : '#879d76');
    const high = new Color(landscape === 'scrub' ? '#b2a489' : '#9e967c');
    const shade = new Color();
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      const height = terrainHeight(x, z);
      positions.setY(index, height);
      const elevation = Math.max(0, Math.min(1, (height + 0.45) / 1.15));
      shade.copy(low).lerp(grass, Math.min(1, elevation * 1.55));
      if (elevation > 0.58) shade.lerp(high, (elevation - 0.58) * 0.9);
      const mottling = terrainNoise.noise(x * 2.1, z * 2.1, 3.8) * 0.055;
      shade.offsetHSL(0, 0, mottling);
      shade.toArray(colors, index * 3);
    }
    positions.needsUpdate = true;
    ground.setAttribute('color', new Float32BufferAttribute(colors, 3));
    ground.computeVertexNormals();
    return ground;
  }, [weather, landscape]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <mesh geometry={geometry} receiveShadow castShadow><meshStandardMaterial map={texture} vertexColors roughness={1} side={DoubleSide} /></mesh>;
}

function TerrainRoad({ center, size }: { center: [number, number]; size: [number, number] }) {
  const texture = useMemo(() => surfaceTexture('aggregate'), []);
  const geometry = useMemo(() => {
    const road = new PlaneGeometry(size[0], size[1], Math.max(2, Math.ceil(size[0] * 7)), Math.max(2, Math.ceil(size[1] * 7)));
    road.rotateX(-Math.PI / 2);
    const positions = road.attributes.position;
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index) + center[0];
      const z = positions.getZ(index) + center[1];
      positions.setXYZ(index, x, terrainHeight(x, z) + 0.035, z);
    }
    positions.needsUpdate = true;
    road.computeVertexNormals();
    return road;
  }, [center[0], center[1], size[0], size[1]]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <mesh geometry={geometry} receiveShadow><meshStandardMaterial map={texture} color="#777a72" roughness={1} side={DoubleSide} /></mesh>;
}

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

class SceneErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function Block({ position, size, color, metalness = 0 }: {
  position: [number, number, number]; size: [number, number, number]; color: string; metalness?: number;
}) {
  return <mesh position={position} castShadow receiveShadow>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} metalness={metalness} roughness={0.65} />
  </mesh>;
}

function Tank({ position, height = 0.8, radius = 0.32 }: { position: [number, number, number]; height?: number; radius?: number }) {
  return <group position={position}>
    <mesh position={[0, height / 2, 0]} castShadow receiveShadow><cylinderGeometry args={[radius, radius, height, 32]} /><meshStandardMaterial color="#849392" metalness={0.35} roughness={0.75} /></mesh>
    {[0.12, height * 0.36, height * 0.68, height - 0.1].map((y) => <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[radius + 0.013, 0.014, 6, 32]} /><meshStandardMaterial color="#4c5c5e" metalness={0.6} roughness={0.48} /></mesh>)}
    <mesh position={[0, height + 0.025, 0]}><cylinderGeometry args={[radius + 0.025, radius + 0.025, 0.05, 32]} /><meshStandardMaterial color="#536b6e" metalness={0.4} /></mesh>
    <mesh position={[0, height + 0.062, 0]}><cylinderGeometry args={[radius * 0.35, radius * 0.35, 0.04, 20]} /><meshStandardMaterial color="#2e4144" metalness={0.6} /></mesh>
    <mesh position={[0, height + 0.1, 0]}><cylinderGeometry args={[radius * 0.13, radius * 0.13, 0.08, 12]} /><meshStandardMaterial color="#758a89" metalness={0.55} /></mesh>
    <Block position={[radius + 0.018, height / 2, 0]} size={[0.035, height - 0.13, 0.025]} color="#52686a" metalness={0.55} />
    {Array.from({ length: Math.max(3, Math.floor(height / 0.15)) }, (_, index) => <Block key={index} position={[radius + 0.05, 0.1 + index * 0.15, 0]} size={[0.12, 0.017, 0.03]} color="#c0ccca" metalness={0.5} />)}
    <mesh position={[radius + 0.05, height * 0.52, 0]} rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[0.055, 0.012, 6, 16]} /><meshStandardMaterial color="#cd533b" metalness={0.3} /></mesh>
  </group>;
}

function Pipe({ points, radius = 0.035, color = '#8d9c9a' }: { points: [number, number, number][]; radius?: number; color?: string }) {
  const curve = useMemo(() => new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x, y, z)), false, 'centripetal'), [points]);
  return <mesh castShadow><tubeGeometry args={[curve, Math.max(12, points.length * 8), radius, 8, false]} /><meshStandardMaterial color={color} metalness={0.55} roughness={0.48} /></mesh>;
}

const Plant = memo(function Plant() {
  return <group>
    <Block position={[0, -0.045, 0]} size={[5.9, 0.13, 4.75]} color="#777d77" />
    <Block position={[0, 0.07, 0]} size={[5.5, 0.16, 4.3]} color="#9aa7a3" />
    <Block position={[0, 0.7, 0]} size={[2.45, 1.16, 1.8]} color="#5e6d6b" />
    <Block position={[0, 0.19, 0.925]} size={[2.53, 0.1, 0.1]} color="#9ba9a5" />
    <Block position={[0, 1.12, 0.923]} size={[2.53, 0.055, 0.08]} color="#425657" metalness={0.3} />
    {[-1.18, -0.53, 0.04, 0.61, 1.18].map((x) => <Block key={`front-cladding-${x}`} position={[x, 0.68, 0.926]} size={[0.022, 0.87, 0.032]} color="#91a2a0" metalness={0.25} />)}
    <Block position={[0, 1.35, 0]} size={[2.65, 0.14, 2]} color="#a3aca8" metalness={0.25} />
    <Block position={[0, 1.44, 0]} size={[2.18, 0.05, 1.58]} color="#697b7b" />
    {[-0.95, -0.45, 0.05, 0.55, 1.05].map((x) => <Block key={`roof-seam-${x}`} position={[x, 1.479, 0]} size={[0.015, 0.012, 1.57]} color="#536565" />)}
    {[-1, 1].map((side) => <group key={`parapet-${side}`}>
      <Block position={[side * 1.3, 1.51, 0]} size={[0.045, 0.26, 2.04]} color="#a9b6b2" metalness={0.25} />
      <Block position={[0, 1.51, side * 0.98]} size={[2.63, 0.26, 0.045]} color="#a9b6b2" metalness={0.25} />
      <Block position={[side * 1.3, 1.65, 0]} size={[0.075, 0.03, 2.06]} color="#53696b" metalness={0.4} />
    </group>)}
    <Block position={[0, 0.42, 0.924]} size={[0.42, 0.62, 0.045]} color="#394e50" metalness={0.4} />
    <Block position={[0, 0.42, 0.951]} size={[0.025, 0.62, 0.01]} color="#8a9c9b" />
    <Block position={[0, 0.77, 1.025]} size={[0.64, 0.055, 0.3]} color="#516769" metalness={0.4} />
    <Block position={[0, 0.16, 1.17]} size={[0.62, 0.075, 0.45]} color="#aebbb6" />
    <mesh position={[0.24, 0.47, 0.978]}><sphereGeometry args={[0.023, 8, 6]} /><meshStandardMaterial color="#d5c39d" metalness={0.7} /></mesh>
    {[-0.25, 0.25].map((x) => <group key={`wall-light-${x}`} position={[x * 3.4, 1.18, 0.955]}>
      <Block position={[0, 0, 0]} size={[0.11, 0.055, 0.08]} color="#394e50" metalness={0.45} />
      <mesh position={[0, -0.055, 0.03]}><sphereGeometry args={[0.035, 8, 6]} /><meshStandardMaterial color="#e4dbba" emissive="#927f55" emissiveIntensity={0.25} /></mesh>
    </group>)}
    {[-0.82, -0.25, 0.32, 0.89].map((x) => <group key={`window-${x}`}>
      <Block position={[x, 0.84, 0.912]} size={[0.4, 0.45, 0.04]} color="#344c50" metalness={0.5} />
      <Block position={[x, 0.84, 0.936]} size={[0.32, 0.36, 0.012]} color="#779b9e" metalness={0.45} />
      <Block position={[x, 0.84, -0.936]} size={[0.4, 0.45, 0.04]} color="#344c50" metalness={0.5} />
    </group>)}
    {[-0.47, 0.1, 0.67].map((z) => <group key={`side-window-${z}`}><Block position={[1.246, 0.84, z]} size={[0.04, 0.45, 0.39]} color="#344c50" /><Block position={[1.273, 0.84, z]} size={[0.012, 0.35, 0.3]} color="#779b9e" metalness={0.45} /></group>)}
    {[-0.72, -0.48, -0.24, 0, 0.24, 0.48, 0.72].map((z) => <Block key={`wall-rib-${z}`} position={[-1.237, 0.7, z]} size={[0.025, 1.1, 0.018]} color="#83928f" />)}
    <Block position={[-0.68, 1.55, 0]} size={[0.58, 0.16, 0.54]} color="#52696b" />
    <Block position={[0.64, 1.55, 0.05]} size={[0.6, 0.16, 0.54]} color="#52696b" />
    {[-0.68, 0.64].map((x) => <group key={`hvac-${x}`}><Block position={[x, 1.67, 0]} size={[0.5, 0.08, 0.46]} color="#879796" />{[-0.16, 0, 0.16].map((z) => <Block key={z} position={[x + 0.26, 1.56, z]} size={[0.015, 0.12, 0.025]} color="#273d40" />)}
      <mesh position={[x, 1.718, 0]} rotation={[-Math.PI / 2, 0, 0]}><torusGeometry args={[0.17, 0.016, 6, 24]} /><meshStandardMaterial color="#3b5153" metalness={0.55} /></mesh>
      {[0, Math.PI / 2].map((angle) => <mesh key={angle} position={[x, 1.721, 0]} rotation={[0, angle, 0]}><boxGeometry args={[0.25, 0.012, 0.038]} /><meshStandardMaterial color="#4e6667" metalness={0.45} /></mesh>)}
      <mesh position={[x, 1.73, 0]}><cylinderGeometry args={[0.028, 0.028, 0.025, 10]} /><meshStandardMaterial color="#aebeb9" metalness={0.5} /></mesh>
    </group>)}
    {[-0.55, 0.52].map((x, index) => <group key={`stack-${x}`} position={[x, 1.45, -0.32]}>
      <mesh position={[0, index ? 0.65 : 0.83, 0]} castShadow><cylinderGeometry args={[0.15, 0.21, index ? 1.3 : 1.66, 20]} /><meshStandardMaterial color="#7f9798" metalness={0.3} roughness={0.5} /></mesh>
      <mesh position={[0, index ? 1.33 : 1.69, 0]}><torusGeometry args={[0.155, 0.034, 8, 24]} /><meshStandardMaterial color="#353531" /></mesh>
      <mesh position={[0, index ? 1.21 : 1.56, 0]}><cylinderGeometry args={[0.153, 0.153, 0.12, 20]} /><meshStandardMaterial color="#cd533b" /></mesh>
      {[0.26, 0.62, index ? 0.98 : 1.33].map((y) => <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.18 - y * 0.012, 0.018, 6, 24]} /><meshStandardMaterial color="#465b5c" metalness={0.6} /></mesh>)}
      <Block position={[0, 0.5, 0.21]} size={[0.055, 0.85, 0.03]} color="#cad3cc" metalness={0.5} />
      {[0.22, 0.42, 0.62, 0.82].map((y) => <Block key={y} position={[0, y, 0.23]} size={[0.23, 0.018, 0.025]} color="#bdcac7" metalness={0.5} />)}
    </group>)}
    <Pipe points={[[-0.85, 1.51, -0.55], [-0.8, 1.56, -0.55], [-0.8, 1.56, -0.3], [-0.55, 1.56, -0.3]]} radius={0.034} color="#a6b7b3" />
    <Pipe points={[[0.64, 1.51, 0.31], [0.62, 1.61, 0.31], [0.52, 1.61, 0.13], [0.52, 1.58, -0.18]]} radius={0.03} color="#aab9b5" />
    <Block position={[1.31, 0.72, -0.45]} size={[0.055, 1.06, 0.06]} color="#c3d0c9" metalness={0.45} />
    <Block position={[1.31, 0.72, -0.75]} size={[0.055, 1.06, 0.06]} color="#c3d0c9" metalness={0.45} />
    {[0.3, 0.48, 0.66, 0.84, 1.02, 1.2].map((y) => <Block key={`wall-ladder-${y}`} position={[1.36, y, -0.6]} size={[0.07, 0.018, 0.33]} color="#9eb3af" metalness={0.45} />)}
    <Block position={[-1.88, 0.45, 0.75]} size={[1.05, 0.68, 0.85]} color="#687d7c" />
    <Block position={[-1.88, 0.82, 0.75]} size={[1.16, 0.08, 0.96]} color="#aec3c3" />
    {[-2.22, -2.03, -1.84, -1.65].map((x) => <Block key={`louver-${x}`} position={[x, 0.54, 1.18]} size={[0.11, 0.24, 0.014]} color="#344d50" />)}
    <Tank position={[-2.04, 0.17, -1.22]} radius={0.34} />
    <Tank position={[-1.27, 0.17, -1.28]} height={0.65} radius={0.27} />
    {[1.72, 2.35].map((x) => <group key={`cooling-${x}`} position={[x, 0.17, -0.98]}>
      <mesh position={[0, 0.65, 0]} castShadow><cylinderGeometry args={[0.38, 0.26, 1.3, 48]} /><meshStandardMaterial color="#9ea9a4" roughness={0.95} /></mesh>
      <mesh position={[0, 1.31, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.375, 0.035, 8, 32]} /><meshStandardMaterial color="#657e80" /></mesh>
      <mesh position={[0, 1.32, 0]}><cylinderGeometry args={[0.32, 0.32, 0.012, 32]} /><meshStandardMaterial color="#334344" roughness={1} /></mesh>
      {[0.25, 0.55, 0.86, 1.13].map((y) => <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.26 + y * 0.09, 0.012, 5, 48]} /><meshStandardMaterial color="#788984" /></mesh>)}
      {Array.from({ length: 8 }, (_, index) => {
        const angle = index * Math.PI / 4;
        return <mesh key={`louver-${index}`} position={[Math.cos(angle) * 0.32, 0.6, Math.sin(angle) * 0.32]} rotation={[0, -angle, 0]} castShadow><boxGeometry args={[0.015, 0.58, 0.045]} /><meshStandardMaterial color="#6f8583" metalness={0.28} roughness={0.8} /></mesh>;
      })}
      {[0, Math.PI / 2].map((angle) => <mesh key={`fan-${angle}`} position={[0, 1.336, 0]} rotation={[0, angle, 0]}><boxGeometry args={[0.47, 0.017, 0.065]} /><meshStandardMaterial color="#7d9794" metalness={0.45} /></mesh>)}
      <mesh position={[0, 1.35, 0]}><cylinderGeometry args={[0.07, 0.07, 0.04, 12]} /><meshStandardMaterial color="#a2b5b1" metalness={0.45} /></mesh>
    </group>)}
    <Block position={[1.9, 0.46, 1.15]} size={[1.25, 0.55, 0.62]} color="#526d70" />
    {[1.48, 1.9, 2.32].map((x) => <Block key={`transformer-${x}`} position={[x, 0.82, 1.15]} size={[0.055, 0.25, 0.55]} color="#9ac2c9" />)}
    {[1.55, 1.78, 2.01, 2.24].map((x) => <Block key={`transformer-vent-${x}`} position={[x, 0.44, 1.475]} size={[0.1, 0.34, 0.02]} color="#304b4e" metalness={0.35} />)}
    {[1.62, 1.9, 2.18].map((x) => <group key={`insulator-${x}`} position={[x, 0.76, 1.1]}>
      <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.05, 0.05, 0.4, 12]} /><meshStandardMaterial color="#c4d2cf" roughness={0.34} /></mesh>
      {[0.13, 0.24, 0.34].map((y) => <mesh key={y} position={[0, y, 0]}><cylinderGeometry args={[0.09, 0.09, 0.025, 12]} /><meshStandardMaterial color="#8ba9aa" roughness={0.4} /></mesh>)}
    </group>)}
    {[-0.65, 0.65].map((z) => <mesh key={`pipe-${z}`}><tubeGeometry args={[new CatmullRomCurve3([new Vector3(-2.3, 0.58, z), new Vector3(-1.45, 0.58, z), new Vector3(-1.36, 0.45, z), new Vector3(-1.2, 0.45, z)]), 20, 0.055, 8, false]} /><meshStandardMaterial color="#8a9290" metalness={0.6} roughness={0.55} /></mesh>)}
    <Block position={[0, 0.18, 2.38]} size={[6.6, 0.02, 0.33]} color="#849b9a" />
    <Block position={[-3.18, 0.18, 0]} size={[0.35, 0.02, 4.8]} color="#849b9a" />
  </group>;
});

function Tree({ position, scale = 1, broadleaf = false }: { position: [number, number, number]; scale?: number; broadleaf?: boolean }) {
  return <group position={position} scale={scale}>
    <mesh position={[0, 0.47, 0]} castShadow><cylinderGeometry args={[0.065, 0.11, 0.94, 9]} /><meshStandardMaterial color="#635c4a" roughness={1} /></mesh>
    {broadleaf ? <>
      {[[-0.23, 0.99, 0, -0.42], [0.18, 1.03, -0.08, 0.45], [0.06, 1.19, 0.13, 0.12]].map(([x, y, z, tilt], index) => <mesh key={`branch-${index}`} position={[x, y, z]} rotation={[0, 0, tilt]}><cylinderGeometry args={[0.024, 0.045, 0.67, 7]} /><meshStandardMaterial color="#665e4e" roughness={1} /></mesh>)}
      {[[-0.34, 1.23, 0, 0.52], [0.27, 1.32, 0.04, 0.54], [0, 1.58, -0.16, 0.58], [0.06, 1.15, 0.35, 0.46], [-0.38, 1.5, 0.17, 0.24], [0.34, 1.66, -0.15, 0.22]].map(([x, y, z, size], index) => <mesh key={index} position={[x, y, z]} scale={[size, size * 0.8, size * 0.83]} castShadow><icosahedronGeometry args={[1, 2]} /><meshStandardMaterial color={['#526e55', '#607e5e', '#6b8560', '#506c56'][index % 4]} roughness={1} /></mesh>)}
    </> : <>
      <mesh position={[-0.08, 1.15, 0]} scale={[0.55, 0.78, 0.53]} castShadow><icosahedronGeometry args={[1, 2]} /><meshStandardMaterial color="#445d50" roughness={1} /></mesh>
      <mesh position={[0.12, 1.63, -0.04]} scale={[0.43, 0.73, 0.43]} castShadow><icosahedronGeometry args={[1, 2]} /><meshStandardMaterial color="#567363" roughness={1} /></mesh>
    </>}
  </group>;
}

function Shrub({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return <group position={position} scale={scale}>
    {[[-0.18, 0.17, 0, 0.26], [0.12, 0.22, -0.1, 0.3], [0.3, 0.14, 0.12, 0.2]].map(([x, y, z, size], index) => <mesh key={index} position={[x, y, z]} scale={[size, size * 0.7, size]} castShadow><icosahedronGeometry args={[1, 1]} /><meshStandardMaterial color={['#617e5d', '#71895f', '#4d705b'][index]} roughness={1} flatShading /></mesh>)}
  </group>;
}

function UtilityPole({ position }: { position: [number, number, number] }) {
  return <group position={position}>
    <mesh position={[0, 1.25, 0]} castShadow><cylinderGeometry args={[0.055, 0.08, 2.5, 10]} /><meshStandardMaterial color="#5c5147" roughness={0.9} /></mesh>
    <mesh position={[0, 2.32, 0]} castShadow><boxGeometry args={[0.72, 0.07, 0.08]} /><meshStandardMaterial color="#514840" roughness={0.8} /></mesh>
    {[-0.25, 0, 0.25].map((x) => <mesh key={x} position={[x, 2.4, 0]}><sphereGeometry args={[0.055, 10, 8]} /><meshStandardMaterial color="#9aa7a4" metalness={0.35} /></mesh>)}
  </group>;
}

function UtilityWires() {
  const start: [number, number] = [-5.25, 3.85];
  const end: [number, number] = [-3.6, 4.35];
  return <group>
    {[-0.25, 0, 0.25].map((offset) => {
      const from = new Vector3(start[0] + offset, terrainHeight(...start) + 2.4, start[1]);
      const to = new Vector3(end[0] + offset, terrainHeight(...end) + 2.4, end[1]);
      const middle = new Vector3((from.x + to.x) / 2, (from.y + to.y) / 2 - 0.12, (from.z + to.z) / 2);
      return <mesh key={offset}><tubeGeometry args={[new CatmullRomCurve3([from, middle, to]), 12, 0.012, 4, false]} /><meshStandardMaterial color="#5b6663" roughness={0.8} /></mesh>;
    })}
  </group>;
}

function Fence() {
  const posts: [number, number][] = [[-2.9, -2.05], [-1.45, -2.65], [0, -2.85], [1.45, -2.65], [2.9, -2.05], [-3.25, -0.7], [-3.3, 0.8], [3.25, -0.7], [3.3, 0.8]];
  return <group>
    {posts.map(([x, z], index) => <mesh key={index} position={[x, 0.45, z]} castShadow><cylinderGeometry args={[0.025, 0.035, 0.9, 8]} /><meshStandardMaterial color="#768783" metalness={0.55} roughness={0.45} /></mesh>)}
    <mesh position={[0, 0.68, -2.55]} rotation={[0, 0, 0]}><boxGeometry args={[5.8, 0.035, 0.035]} /><meshStandardMaterial color="#9aa9a5" metalness={0.45} /></mesh>
    <mesh position={[0, 0.28, -2.55]}><boxGeometry args={[5.8, 0.035, 0.035]} /><meshStandardMaterial color="#9aa9a5" metalness={0.45} /></mesh>
    <mesh position={[-3.25, 0.68, 0.05]}><boxGeometry args={[0.035, 0.035, 1.55]} /><meshStandardMaterial color="#9aa9a5" metalness={0.45} /></mesh>
    <mesh position={[3.25, 0.68, 0.05]}><boxGeometry args={[0.035, 0.035, 1.55]} /><meshStandardMaterial color="#9aa9a5" metalness={0.45} /></mesh>
  </group>;
}

function ChannelRibbon({ width, offset = 0, lift, color, opacity = 1 }: { width: number; offset?: number; lift: number; color: string; opacity?: number }) {
  const geometry = useMemo(() => {
    const ribbon = new PlaneGeometry(width, 19, 10, 96);
    ribbon.rotateX(-Math.PI / 2);
    const positions = ribbon.attributes.position;
    for (let index = 0; index < positions.count; index++) {
      const z = positions.getZ(index);
      const x = -5.9 + positions.getX(index) + offset + Math.sin(z * 0.55) * 0.46;
      positions.setXYZ(index, x, terrainHeight(x, z) + lift, z);
    }
    positions.needsUpdate = true;
    ribbon.computeVertexNormals();
    return ribbon;
  }, [width, offset, lift]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} receiveShadow><meshStandardMaterial color={color} metalness={opacity < 1 ? 0.25 : 0} roughness={opacity < 1 ? 0.35 : 1} transparent={opacity < 1} opacity={opacity} side={DoubleSide} /></mesh>;
}

function Waterway() {
  return <group>
    <ChannelRibbon width={3.15} lift={0.028} color="#8b9077" />
    <ChannelRibbon width={2.5} lift={0.052} color="#4b7780" opacity={0.96} />
    {Array.from({ length: 13 }, (_, index) => {
      const z = -8.5 + index * 1.35;
      const x = -5.9 + Math.sin(z * 0.55) * 0.46 + (index % 2 ? 0.38 : -0.35);
      return <mesh key={`ripple-${index}`} position={[x, terrainHeight(x, z) + 0.062, z]} rotation={[-Math.PI / 2, 0, index * 0.15]}>
        <planeGeometry args={[0.37 + (index % 3) * 0.13, 0.025]} />
        <meshBasicMaterial color="#bdd4d2" transparent opacity={0.48} depthWrite={false} side={DoubleSide} />
      </mesh>;
    })}
    {Array.from({ length: 18 }, (_, index) => {
      const z = -8.2 + index * 0.91;
      const x = -4.2 + Math.sin(z * 0.55) * 0.46 + (index % 3) * 0.08;
      return <mesh key={`reeds-${index}`} position={[x, terrainHeight(x, z) + 0.23, z]} rotation={[0, 0, index % 2 ? 0.18 : -0.13]} castShadow>
        <cylinderGeometry args={[0.008, 0.025, 0.46 + (index % 4) * 0.1, 5]} />
        <meshStandardMaterial color={index % 2 ? '#718d62' : '#8d9368'} roughness={1} />
      </mesh>;
    })}
  </group>;
}

function WetlandPools() {
  const pools = [[-4.6, 3.2, 0.84], [4.3, 3.55, 0.6], [-4.7, -3.85, 0.48]] as const;
  return <group>{pools.map(([x, z, radius], index) => <group key={index} position={[x, terrainHeight(x, z) + 0.04, z]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[1.4, 0.8, 1]}><circleGeometry args={[radius + 0.14, 48]} /><meshStandardMaterial color="#838a6f" roughness={1} side={DoubleSide} /></mesh>
    <mesh position={[0, 0.016, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.4, 0.8, 1]}><circleGeometry args={[radius, 48]} /><meshStandardMaterial color="#4f7777" metalness={0.15} roughness={0.34} side={DoubleSide} /></mesh>
    {[-1, 1].map((side) => <mesh key={side} position={[side * radius * 1.3, 0.21, radius * 0.18]} rotation={[0, 0, side * 0.13]}><cylinderGeometry args={[0.009, 0.024, 0.4, 5]} /><meshStandardMaterial color="#728b5d" roughness={1} /></mesh>)}
  </group>)}</group>;
}

function ScrubDetails() {
  return <group>{Array.from({ length: 18 }, (_, index) => {
    const x = Math.sin(index * 8.31) * 6.7;
    const z = Math.cos(index * 5.17) * 6.5;
    return Math.hypot(x, z) < 4.4 ? null : <mesh key={index} position={[x, terrainHeight(x, z) + 0.12, z]} rotation={[0.15, index * 1.7, 0.1]} scale={[0.23, 0.15, 0.19]} castShadow>
      <dodecahedronGeometry args={[1, 0]} /><meshStandardMaterial color={index % 2 ? '#a6a18c' : '#847f6e'} roughness={1} flatShading />
    </mesh>;
  })}</group>;
}

function Surroundings({ weather, landscape }: { weather: Weather; landscape: SiteLandscape }) {
  const trees = [[-5.3, -0.7, 1], [-4.9, 2.3, 0.78], [-3.6, -4.1, 0.9], [-1.2, -5.2, 0.7], [3.7, -4, 0.84], [5.1, -1.6, 0.95], [5.25, 2.3, 0.72], [3.8, 4.1, 0.85], [-3.5, 4.2, 0.8], [-6.3, -3.1, 0.7], [6.1, 3.4, 0.75]] as const;
  const shrubs = [[-6.1, 0.7], [-5.7, -2.3], [-4.8, -3.5], [-2.5, -4.7], [0.6, -5.5], [2.1, -4.8], [4.7, -3.5], [5.8, 0.4], [4.8, 3.3], [2.8, 4.6], [-2.2, 4.9], [-4.8, 3.5]] as const;
  return <group>
    <Terrain weather={weather} landscape={landscape} />
    <TerrainRoad center={[-0.2, 5.35]} size={[11.5, 0.72]} />
    <TerrainRoad center={[5.25, 0]} size={[0.65, 9.7]} />
    {landscape === 'river' && <Waterway />}
    {landscape === 'wetland' && <WetlandPools />}
    {landscape === 'scrub' && <ScrubDetails />}
    <Fence />
    <UtilityPole position={[-5.25, terrainHeight(-5.25, 3.85), 3.85]} />
    <UtilityPole position={[-3.6, terrainHeight(-3.6, 4.35), 4.35]} />
    <UtilityWires />
    {trees.map(([x, z, scale], index) => (landscape === 'river' && x < -3.8) || (landscape === 'scrub' && index % 3 !== 0) ? null : <Tree key={index} position={[x, terrainHeight(x, z), z]} scale={scale} broadleaf={index % 3 !== 0} />)}
    {shrubs.map(([x, z], index) => <Shrub key={index} position={[x, terrainHeight(x, z), z]} scale={index % 3 === 0 ? 1.25 : 0.9} />)}
    {Array.from({ length: 36 }, (_, index) => {
      const x = Math.sin(index * 14.51) * 7.5;
      const z = Math.cos(index * 9.73) * 7.1;
      return Math.hypot(x, z) < 4.8 ? null : <mesh key={index} position={[x, terrainHeight(x, z) + 0.05, z]} rotation={[0, index * 2.2, 0]} castShadow><coneGeometry args={[0.09, 0.2 + (index % 3) * 0.06, 5]} /><meshStandardMaterial color={index % 2 ? '#687f5e' : '#82906d'} roughness={1} /></mesh>;
    })}
  </group>;
}

const rainDrops = Array.from({ length: 24 }, (_, index) => ({
  x: -1.3 + ((index * 0.6180339887) % 1) * 2.6,
  z: -0.48 + ((index * 0.4142135624) % 1) * 0.96,
  phase: (index * 0.173) % 1,
  speed: 2.2 + (index % 5) * 0.24,
}));

function Rainfall({ reducedMotion }: { reducedMotion: boolean }) {
  const streaks = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (reducedMotion || !streaks.current) return;
    streaks.current.children.forEach((streak, index) => {
      const drop = rainDrops[index];
      const distance = (clock.elapsedTime * drop.speed + drop.phase * 2.65) % 2.65;
      streak.position.y = -0.48 - distance;
      streak.position.x = drop.x + distance * 0.11;
    });
  });
  return <group ref={streaks}>
    {rainDrops.map((drop, index) => <mesh key={index} position={[drop.x + drop.phase * 2.65 * 0.11, -0.48 - drop.phase * 2.65, drop.z]} rotation={[0, 0, -0.11]}>
      <cylinderGeometry args={[0.012, 0.012, 0.34, 4]} />
      <meshBasicMaterial color="#8db8c3" transparent opacity={0.74} depthWrite={false} />
    </mesh>)}
  </group>;
}

function Cloud({ position, scale, dark, reducedMotion, rain = false }: {
  position: [number, number, number]; scale: number; dark: boolean; reducedMotion: boolean; rain?: boolean;
}) {
  const cloud = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (cloud.current && !reducedMotion) cloud.current.position.x = position[0] + Math.sin(clock.elapsedTime * 0.28 + position[0]) * 0.24;
  });
  const color = dark ? '#69767b' : '#e2e9e7';
  return <group ref={cloud} position={position} scale={scale}>
    <mesh position={[0, -0.13, 0]} scale={[1.56, 0.3, 0.73]} castShadow><sphereGeometry args={[1, 24, 16]} /><meshStandardMaterial color={dark ? '#596971' : '#c7d4d3'} roughness={1} /></mesh>
    {[[-1.05, 0.13, 0.07, 0.73, 0.51, 0.61], [-0.48, 0.43, -0.15, 0.86, 0.69, 0.68], [0.32, 0.55, 0.04, 0.98, 0.82, 0.73], [1.08, 0.18, -0.12, 0.68, 0.55, 0.59], [0.03, 0.12, 0.45, 0.85, 0.41, 0.42]].map(([x, y, z, sx, sy, sz], index) => <mesh key={index} position={[x, y, z]} scale={[sx, sy, sz]} castShadow><sphereGeometry args={[1, 20, 14]} /><meshStandardMaterial color={index % 2 ? color : dark ? '#77848a' : '#eaf0ed'} roughness={1} /></mesh>)}
    {rain && <Rainfall reducedMotion={reducedMotion} />}
  </group>;
}

function Sky({ weather, reducedMotion }: { weather: Weather; reducedMotion: boolean }) {
  return <group>
    {weather === 'sunny' && <group position={[-5.2, 3.25, 0.8]}>
      <mesh><sphereGeometry args={[0.7, 24, 16]} /><meshBasicMaterial color="#ffd273" /></mesh>
      <mesh><sphereGeometry args={[1.12, 24, 16]} /><meshBasicMaterial color="#ffe2a0" transparent opacity={0.18} depthWrite={false} /></mesh>
      <pointLight color="#ffe8b6" intensity={18} distance={12} decay={2} />
    </group>}
    <Cloud position={[-4.4, 3.55, -2.7]} scale={weather === 'storm' ? 1.2 : 0.8} dark={weather !== 'sunny'} reducedMotion={reducedMotion} rain={weather === 'storm'} />
    <Cloud position={[2.4, 3.9, -4]} scale={weather === 'storm' ? 1.4 : 1.1} dark={weather !== 'sunny'} reducedMotion={reducedMotion} rain={weather === 'storm'} />
    {weather !== 'sunny' && <Cloud position={[3.5, 3.45, 2.2]} scale={0.9} dark reducedMotion={reducedMotion} rain={weather === 'storm'} />}
    {weather === 'storm' && <Cloud position={[-3.2, 3.7, 1.1]} scale={0.75} dark reducedMotion={reducedMotion} rain />}
  </group>;
}

function Perimeter({ active, reducedMotion }: { active: boolean; reducedMotion: boolean }) {
  const pulse = useRef<Mesh>(null);
  const perimeterColor = active ? '#cd533b' : '#397d66';
  useFrame(({ clock }) => {
    if (!pulse.current || reducedMotion) return;
    const scale = 1 + Math.sin(clock.elapsedTime * 2.2) * 0.035;
    pulse.current.scale.set(scale, scale, scale);
  });
  return <group>
    <mesh position={[0, -0.268, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[3.89, 96]} /><meshBasicMaterial color={perimeterColor} transparent opacity={0.07} depthWrite={false} /></mesh>
    <mesh ref={pulse} position={[0, -0.225, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[3.9, 0.047, 8, 96]} /><meshBasicMaterial color={perimeterColor} /></mesh>
    <mesh position={[0, -0.22, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[2.85, 0.012, 5, 96]} /><meshBasicMaterial color="#9ac2c9" transparent opacity={0.65} /></mesh>
    {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((angle) => <mesh key={angle} position={[Math.cos(angle) * 3.9, -0.1, Math.sin(angle) * 3.9]} castShadow>
      <cylinderGeometry args={[0.11, 0.14, 0.2, 12]} /><meshStandardMaterial color={perimeterColor} emissive={perimeterColor} emissiveIntensity={0.25} />
    </mesh>)}
  </group>;
}

function CloudToGroundBolt({ position, source }: { position: [number, number]; source: [number, number, number] }) {
  const path = useMemo(() => {
    const impactHeight = terrainHeight(position[0], position[1]) + 0.06;
    const points = Array.from({ length: 10 }, (_, index) => {
      const progress = index / 9;
      const jitter = index === 0 || index === 9 ? 0 : (index % 2 === 0 ? 1 : -1) * (0.16 + (index % 3) * 0.07);
      return new Vector3(
        source[0] + (position[0] - source[0]) * progress + jitter,
        source[1] + (impactHeight - source[1]) * progress,
        source[2] + (position[1] - source[2]) * progress - jitter * 0.55,
      );
    });
    return new CatmullRomCurve3(points, false, 'centripetal');
  }, [position, source]);
  const core = useRef<TubeGeometry>(null);
  const glow = useRef<TubeGeometry>(null);
  const flash = useRef<PointLight>(null);
  const bolt = useRef<Group>(null);
  const started = useRef(performance.now());
  useFrame(() => {
    const elapsed = performance.now() - started.current;
    const segments = Math.min(48, Math.floor((elapsed / 500) * 48));
    const indices = segments * 6 * 6;
    core.current?.setDrawRange(0, indices);
    glow.current?.setDrawRange(0, indices);
    if (flash.current) flash.current.intensity = elapsed >= 460 && elapsed < 850 ? 10 * (1 - (elapsed - 460) / 390) : 0;
    if (bolt.current) bolt.current.visible = elapsed < 1200;
  });
  return <group ref={bolt}>
    <mesh renderOrder={20}><tubeGeometry ref={glow} args={[path, 48, 0.17, 6, false]} /><meshBasicMaterial color="#55bfe7" transparent opacity={0.48} depthWrite={false} toneMapped={false} /></mesh>
    <mesh renderOrder={21}><tubeGeometry ref={core} args={[path, 48, 0.055, 6, false]} /><meshBasicMaterial color="#fff2af" toneMapped={false} /></mesh>
    <pointLight ref={flash} position={[position[0], terrainHeight(position[0], position[1]) + 0.6, position[1]]} color="#d9f4ff" intensity={0} distance={5} decay={2} />
  </group>;
}

function distanceLabelTexture(miles: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#26393b';
    context.beginPath();
    context.roundRect(12, 11, 232, 74, 18);
    context.fill();
    context.strokeStyle = '#d8e8e4';
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = '#ffffff';
    context.font = '700 34px Open Sans, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(`${miles.toFixed(1)} mi`, 128, 49);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function Strike({ location, newest, reducedMotion, delayImpact }: { location: StrikeLocation; newest: boolean; reducedMotion: boolean; delayImpact: boolean }) {
  const marker = useRef<Group>(null);
  const impact = useRef<Group>(null);
  const started = useRef(performance.now());
  const label = useMemo(() => distanceLabelTexture(location.miles), [location.miles]);
  useEffect(() => () => label.dispose(), [label]);
  useEffect(() => { started.current = performance.now(); }, [newest]);
  useFrame(() => {
    if (impact.current && delayImpact && !reducedMotion) impact.current.visible = performance.now() - started.current >= 460;
    if (!marker.current || reducedMotion || !newest) return;
    const progress = Math.min(1, Math.max(0, (performance.now() - started.current - (delayImpact ? 460 : 0)) / 650));
    const scale = 1 + (1 - progress) * 0.75;
    marker.current.scale.set(scale, 1, scale);
  });
  return <group ref={impact} visible={!delayImpact || reducedMotion} position={[location.x, terrainHeight(location.x, location.z) + 0.055, location.z]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.23, 32]} /><meshBasicMaterial color="#cd533b" transparent opacity={0.32} depthWrite={false} /></mesh>
    <group ref={marker} position={[0, 0.035, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.28, 0.035, 8, 32]} /><meshBasicMaterial color="#cd533b" /></mesh>
      <mesh position={[0, 0.08, 0]}><sphereGeometry args={[0.09, 12, 8]} /><meshStandardMaterial color="#cd533b" emissive="#cd533b" emissiveIntensity={0.45} /></mesh>
    </group>
    <sprite position={[0, 0.73, 0]} scale={[1.15, 0.43, 1]}><spriteMaterial map={label} transparent depthWrite={false} /></sprite>
    {newest && !reducedMotion && <pointLight position={[0, 0.25, 0]} color="#cd533b" intensity={1.5} distance={2} />}
  </group>;
}

function CameraControls({ reducedMotion }: { reducedMotion: boolean }) {
  const { camera, gl, invalidate } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement);
    orbit.enablePan = false;
    orbit.enableZoom = true;
    orbit.zoomSpeed = 0.7;
    orbit.minDistance = 8;
    orbit.maxDistance = 18;
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.07;
    orbit.minPolarAngle = Math.PI / 5;
    orbit.maxPolarAngle = Math.PI / 2.35;
    orbit.autoRotate = !reducedMotion;
    orbit.autoRotateSpeed = 0.45;
    orbit.target.set(0, 0.45, 0);
    const onChange = () => invalidate();
    orbit.addEventListener('change', onChange);
    controls.current = orbit;
    return () => { orbit.removeEventListener('change', onChange); orbit.dispose(); controls.current = null; };
  }, [camera, gl, invalidate, reducedMotion]);
  useFrame(() => controls.current?.update());
  return null;
}

function Scene({ active, strikeCount, strikeAnimationId, weather, landscape, reducedMotion }: SceneProps & { reducedMotion: boolean }) {
  const newestIndex = strikeCount > 0 ? (strikeCount - 1) % strikeLocations.length : -1;
  return <>
    <color attach="background" args={[weather === 'storm' ? '#b6c8d0' : weather === 'overcast' ? '#d5e2e4' : '#d9eff4']} />
    <fog attach="fog" args={[weather === 'storm' ? '#b6c8d0' : weather === 'overcast' ? '#d5e2e4' : '#d9eff4', 12, 26]} />
    <ambientLight intensity={0.48} />
    <hemisphereLight args={['#dce9e6', '#5e7067', 0.95]} />
    <directionalLight position={[5, 9, 6]} intensity={weather === 'storm' ? 1.65 : 2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={9} shadow-camera-bottom={-9} shadow-bias={-0.0002} />
    <Surroundings weather={weather} landscape={landscape} />
    <Perimeter active={active} reducedMotion={reducedMotion} />
    <Plant />
    <Sky weather={weather} reducedMotion={reducedMotion} />
    {strikeLocations.slice(0, Math.min(strikeCount, strikeLocations.length)).map((location, index) => <Strike key={index} location={location} newest={index === newestIndex} reducedMotion={reducedMotion} delayImpact={strikeAnimationId > 0 && index === newestIndex} />)}
    {strikeAnimationId > 0 && newestIndex >= 0 && !reducedMotion && <CloudToGroundBolt key={strikeAnimationId} position={[strikeLocations[newestIndex].x, strikeLocations[newestIndex].z]} source={strikeLocations[newestIndex].cloud} />}
    <CameraControls reducedMotion={reducedMotion} />
  </>;
}

function FallbackScene({ active, strikeCount, weather, landscape }: Pick<SceneProps, 'active' | 'strikeCount' | 'weather' | 'landscape'>) {
  return <div className="cw-beacon-fallback" role="img" aria-label={`Illustrated ${landscape} setting with plant in ${weather} conditions within a 10-mile perimeter; ${active ? 'demo stop-work' : 'demo all-clear'}; ${strikeCount} simulated ${strikeCount === 1 ? 'strike' : 'strikes'}`}>
    <svg viewBox="0 0 740 390" aria-hidden="true">
      <rect width="740" height="390" fill={weather === 'storm' ? '#b6c8d0' : weather === 'overcast' ? '#d5e2e4' : '#d9eff4'} />
      {weather === 'sunny' ? <circle cx="97" cy="78" r="38" fill="#ffd273" /> : <><ellipse cx="147" cy="70" rx="96" ry="24" fill="#849aa1" /><ellipse cx="221" cy="95" rx="92" ry="27" fill="#849aa1" />{weather === 'storm' && <path d="m135 97-11 35m31-35-11 35m70-11-11 35m31-35-11 35" stroke="#7faeba" strokeWidth="3" />}</>}
      <ellipse cx="370" cy="226" rx="305" ry="123" fill="#d9e8e9" />
      <ellipse cx="370" cy="226" rx="285" ry="107" fill={active ? '#f6e6e1' : '#e4f1e9'} stroke={active ? '#cd533b' : '#397d66'} strokeWidth="3" strokeDasharray="10 8" />
      {landscape === 'river' && <path d="M85 205 C135 180 130 276 198 300 L170 344 C102 302 102 235 62 237Z" fill="#5c8991" stroke="#8ca89b" strokeWidth="7" />}
      {landscape === 'wetland' && <><ellipse cx="148" cy="272" rx="48" ry="15" fill="#5c8991" /><ellipse cx="572" cy="260" rx="38" ry="12" fill="#5c8991" /></>}
      {landscape === 'scrub' && <><ellipse cx="167" cy="286" rx="42" ry="12" fill="#b4a98a" /><ellipse cx="565" cy="248" rx="52" ry="15" fill="#b4a98a" /></>}
      <path d="M241 234 352 181 501 233 388 284Z" fill="#b4c8c5" stroke="#779b9b" strokeWidth="2" />
      <path d="M292 186 357 158 449 190 383 220Z" fill="#b5c8c8" stroke="#687e80" strokeWidth="2" />
      <path d="M292 186 383 220 383 277 292 243Z" fill="#667c7c" /><path d="M383 220 449 190 449 247 383 277Z" fill="#4d6364" />
      <path d="M340 166 340 112 353 106 366 112 366 170M381 170 381 128 391 123 401 128 401 179" fill="#788e8e" stroke="#526969" strokeWidth="2" />
      {strikeLocations.slice(0, Math.min(strikeCount, 4)).map((location, index) => <g key={index}><circle cx={[145, 550, 565, 190][index]} cy={[205, 170, 265, 270][index]} r="8" fill="#cd533b" /><text x={[145, 550, 565, 190][index]} y={[188, 153, 248, 253][index]} textAnchor="middle" fill="#353531" fontSize="13" fontWeight="700">{location.miles.toFixed(1)} mi</text></g>)}
      <rect x="268" y="321" width="204" height="32" rx="16" fill="#353531" /><text x="370" y="342" textAnchor="middle" fill="white" fontSize="13" fontWeight="700">10-MILE SAFETY PERIMETER</text>
    </svg>
    <span className="cw-beacon-fallback-note">Illustrated view · 3D unavailable</span>
  </div>;
}

export function SiteBeaconScene({ active, strikeCount, strikeAnimationId, weather, landscape }: SceneProps) {
  const reducedMotion = useReducedMotion();
  const [webglAvailable] = useState(canUseWebGL);
  const [contextLost, setContextLost] = useState(false);
  const canvasElement = useRef<HTMLCanvasElement | null>(null);
  const onContextLost = useCallback((event: Event) => { event.preventDefault(); setContextLost(true); }, []);
  useEffect(() => () => canvasElement.current?.removeEventListener('webglcontextlost', onContextLost), [onContextLost]);
  const fallback = <FallbackScene active={active} strikeCount={strikeCount} weather={weather} landscape={landscape} />;
  if (!webglAvailable || contextLost) return fallback;
  return <SceneErrorBoundary fallback={fallback}>
    <Canvas fallback={fallback} camera={{ position: [9, 7, 11], fov: 35, near: 0.1, far: 100 }} dpr={[1, 1.5]} shadows frameloop={reducedMotion ? 'demand' : 'always'} gl={{ antialias: true, alpha: false }} onCreated={({ gl }) => { canvasElement.current = gl.domElement; gl.domElement.addEventListener('webglcontextlost', onContextLost); }}>
      <Scene active={active} strikeCount={strikeCount} strikeAnimationId={strikeAnimationId} weather={weather} landscape={landscape} reducedMotion={reducedMotion} />
    </Canvas>
  </SceneErrorBoundary>;
}
