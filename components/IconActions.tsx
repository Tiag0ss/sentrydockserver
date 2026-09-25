'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Tone = 'default' | 'primary' | 'danger' | 'warn';

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string;
  tone?: Tone;
  children: ReactNode;
};

export function IconButton({
  label,
  tone = 'default',
  className = '',
  type = 'button',
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      title={label}
      aria-label={label}
      data-tooltip={label}
      className={`sd-icon-btn sd-icon-btn-${tone} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function IconPlay() {
  return (
    <Svg>
      <polygon points="6 3 20 12 6 21 6 3" />
    </Svg>
  );
}

export function IconEdit() {
  return (
    <Svg>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  );
}

export function IconCopy() {
  return (
    <Svg>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Svg>
  );
}

export function IconTrash() {
  return (
    <Svg>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </Svg>
  );
}

export function IconOpen() {
  return (
    <Svg>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </Svg>
  );
}

export function IconRefresh() {
  return (
    <Svg>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </Svg>
  );
}

export function IconKey() {
  return (
    <Svg>
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777Zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </Svg>
  );
}

export function IconPower() {
  return (
    <Svg>
      <path d="M12 2v10" />
      <path d="M18.4 6.6a8 8 0 1 1-12.8 0" />
    </Svg>
  );
}

export function IconCheck() {
  return (
    <Svg>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  );
}

export function IconSave() {
  return (
    <Svg>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </Svg>
  );
}

export function IconDownload() {
  return (
    <Svg>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </Svg>
  );
}

export function IconUpload() {
  return (
    <Svg>
      <path d="M12 21V9" />
      <path d="m7 14 5-5 5 5" />
      <path d="M5 3h14" />
    </Svg>
  );
}

export function IconClose() {
  return (
    <Svg>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  );
}
