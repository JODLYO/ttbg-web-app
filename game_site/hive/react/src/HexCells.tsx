import React, { useRef } from "react";

const ICON_SIZE = 100;
const ICON_X = 200 - ICON_SIZE / 2;
const ICON_Y = 130 - ICON_SIZE / 2 - 5;

let _hexIdCounter = 0;
function useHexId() {
  const ref = useRef(`hex-${_hexIdCounter++}`);
  return ref.current;
}

interface HexCellProps {
  size?: string;
  fill?: string;
  label?: string;
  highlight?: boolean;
}

/* ---------------- 2D Hex ---------------- */
export const HexCell2D: React.FC<HexCellProps> = ({
  size = "40px",
  fill = "#d6e9ff",
  label,
  highlight = false,
}) => {
  const uid = useHexId();
  const glowId = `${uid}-glow`;

  return (
    <div
      className="hex-piece"
      draggable={false}
      style={{ width: size, height: size }}
    >
      <svg viewBox="142.74 64 114 142.26" style={{ width: "100%", height: "100%" }}>
        <defs>
          <filter id={glowId}>
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="4"
              floodColor="#4cff4c"
              floodOpacity="0.9"
            />
          </filter>
        </defs>

        <polygon
          points="
            200,65
            256.26,98
            256.26,162
            200,195
            143.74,162
            143.74,98
          "
          fill={highlight ? "#b8f5b8" : fill}
          stroke={highlight ? "#2ecc71" : "#253544"}
          strokeWidth={highlight ? 3 : 1.5}
          filter={highlight ? `url(#${glowId})` : undefined}
        />

        {label && (
          <text
            x="200"
            y="130"
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="45"
            fontWeight="bold"
            fill="#222"
          >
            {label}
          </text>
        )}
      </svg>
    </div>
  );
};


/* ---------------- 3D Hex ---------------- */
export const HexCell3D: React.FC<HexCellProps> = ({
  size = "40px",
  fill = "#d6e9ff",
  label,
  highlight = false,
}) => {
  const uid = useHexId();
  const glowId = `${uid}-glow`;
  const sideLight = `${uid}-sl`;
  const sideDark = `${uid}-sd`;

  return (
    <div className="hex-piece" style={{ width: size, height: size }}>
      <svg
        viewBox="142.74 64 114 142.26"
        style={{ width: "100%", height: "100%", pointerEvents: "none" }}
      >
        <defs>
          <filter id={glowId}>
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="4"
              floodColor="#4cff4c"
              floodOpacity="0.9"
            />
          </filter>

          <linearGradient id={sideLight} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#9ec7ff" />
            <stop offset="1" stopColor="#7fb8ff" />
          </linearGradient>
          <linearGradient id={sideDark} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#6b9fe6" />
            <stop offset="1" stopColor="#4b82c9" />
          </linearGradient>
        </defs>

        {/* top face */}
        <polygon
          points="
            200,65
            256.26,98
            256.26,162
            200,195
            143.74,162
            143.74,98
          "
          fill={highlight ? "#b8f5b8" : fill}
          stroke={highlight ? "#2ecc71" : "#253544"}
          strokeWidth={highlight ? 3 : 1.5}
          filter={highlight ? `url(#${glowId})` : undefined}
        />

        {/* right side */}
        <polygon
          points="256.26,152 200,185 200,205 256.26,172"
          fill={`url(#${sideLight})`}
          stroke="#253544"
          strokeWidth="2"
        />

        {/* left side */}
        <polygon
          points="200,185 143.74,152 143.74,172 200,205"
          fill={`url(#${sideDark})`}
          stroke="#253544"
          strokeWidth="2"
        />

        <image
          href={`/static/hive/images/${fill}_${label}.svg`}
          x={ICON_X}
          y={ICON_Y}
          width={ICON_SIZE}
          height={ICON_SIZE}
          preserveAspectRatio="xMidYMid meet"
        />
      </svg>
    </div>
  );
};
