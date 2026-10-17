import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`cw-badge cw-badge-${tone}`}>{children}</span>;
}

export function Button({ variant = 'primary', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' }) {
  return <button className={`cw-button cw-button-${variant}`} {...props}>{children}</button>;
}

export function Card({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <section className={`cw-card ${className}`} style={style}>{children}</section>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="cw-page-header"><div>{eyebrow && <p className="cw-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="cw-page-description">{description}</p>}</div>{actions && <div className="cw-page-actions">{actions}</div>}</header>;
}
